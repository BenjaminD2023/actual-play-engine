import { QLabError } from '../errors.js';
import { nowIso } from '../ids.js';
import { cueAddress, qlabAddress } from './addresses.js';
import { flattenQLabCues } from './cues.js';
import { QLabTcpConnection } from './connection.js';
import { parseQLabReply } from './reply.js';
import type { OscArg } from './osc.js';
import type {
  QLabAckStatus,
  QLabCommandResult,
  QLabDriver,
  QLabHealth,
  QLabNetworkConfig,
  QLabCueInfo,
  QLabWorkspaceInfo,
} from './types.js';

type Priority = 'normal' | 'urgent';

interface QueuedCommand {
  address: string;
  args: OscArg[];
  priority: Priority;
  expectReply: boolean;
  resolve: (result: QLabCommandResult) => void;
  reject: (error: Error) => void;
}

const DEFAULTS = {
  connectTimeoutMs: 5000,
  replyTimeoutMs: 4000,
  heartbeatIntervalMs: 10000,
  reconnectMinMs: 250,
  reconnectMaxMs: 5000,
};

export class QLabSession implements QLabDriver {
  readonly kind = 'tcp' as const;
  private connection: QLabTcpConnection | null = null;
  private queue: QueuedCommand[] = [];
  private draining = false;
  private started = false;
  private authenticating = false;
  private authenticated = false;
  private version: string | null = null;
  private lastAckAt: string | null = null;
  private lastError: string | null = null;
  private reconnectAttempt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectLock: Promise<void> | null = null;
  private workspaceId: string | null;

  constructor(private readonly config: QLabNetworkConfig) {
    this.workspaceId = config.workspaceId ?? null;
  }

  health(): QLabHealth {
    return {
      connected: this.connection?.connected ?? false,
      reachable: this.connection?.connected ?? false,
      authenticating: this.authenticating,
      authenticated: this.authenticated,
      host: this.config.host,
      port: this.config.port,
      workspaceId: this.workspaceId,
      version: this.version,
      lastAckAt: this.lastAckAt,
      lastError: this.lastError,
      queueDepth: this.queue.length,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  async start(): Promise<void> {
    this.started = true;
    this.startHeartbeat();
    try {
      await this.ensureConnected();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.scheduleReconnect();
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const leftover = this.queue.splice(0);
    for (const item of leftover) {
      item.reject(new QLabError('stopped', 'QLab session was stopped before the command was sent.'));
    }
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
    this.authenticated = false;
  }

  async startCue(cueNumber: string): Promise<QLabCommandResult> {
    return this.enqueue(cueAddress(this.workspaceId, cueNumber, 'start'), [], 'normal');
  }

  async stopCue(cueNumber: string): Promise<QLabCommandResult> {
    return this.enqueue(cueAddress(this.workspaceId, cueNumber, 'stop'), [], 'normal');
  }

  async workspaceGo(): Promise<QLabCommandResult> {
    return this.enqueue(qlabAddress(this.workspaceId, '/go'), [], 'normal');
  }

  async workspaceStop(): Promise<QLabCommandResult> {
    return this.enqueue(qlabAddress(this.workspaceId, '/stop'), [], 'urgent');
  }

  async panic(): Promise<QLabCommandResult> {
    return this.enqueue(qlabAddress(this.workspaceId, '/panic'), [], 'urgent');
  }

  async reset(): Promise<QLabCommandResult> {
    return this.enqueue(qlabAddress(this.workspaceId, '/reset'), [], 'urgent');
  }

  async send(address: string, args: OscArg[] = []): Promise<QLabCommandResult> {
    return this.enqueue(address, args, 'normal');
  }

  async listWorkspaces(): Promise<QLabWorkspaceInfo[]> {
    const result = await this.enqueue('/workspaces', [], 'normal');
    if (!Array.isArray(result.data)) {
      return [];
    }
    return result.data.filter((workspace): workspace is QLabWorkspaceInfo => {
      if (!workspace || typeof workspace !== 'object') return false;
      const candidate = workspace as Partial<QLabWorkspaceInfo>;
      return (
        typeof candidate.uniqueID === 'string' &&
        typeof candidate.displayName === 'string' &&
        typeof candidate.port === 'number'
      );
    });
  }

  async listCues(): Promise<QLabCueInfo[]> {
    const result = await this.enqueue(qlabAddress(this.workspaceId, '/cueLists'), [], 'normal');
    return flattenQLabCues(result.data);
  }

  private enqueue(address: string, args: OscArg[], priority: Priority): Promise<QLabCommandResult> {
    return new Promise((resolve, reject) => {
      const item: QueuedCommand = {
        address,
        args,
        priority,
        expectReply: true,
        resolve,
        reject,
      };
      if (priority === 'urgent') {
        this.queue.unshift(item);
      } else {
        this.queue.push(item);
      }
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.queue.length > 0 && this.started) {
        try {
          await this.ensureConnected();
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
          const pending = this.queue.splice(0);
          for (const waiting of pending) {
            waiting.resolve({
              address: waiting.address,
              status: 'unconfirmed',
              data: null,
              confirmed: false,
              durationMs: 0,
              error: this.lastError,
            });
          }
          this.scheduleReconnect();
          return;
        }
        const item = this.queue.shift();
        if (!item) break;
        try {
          const result = await this.dispatch(item);
          item.resolve(result);
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
          if (error instanceof QLabError && error.code === 'reply_timeout') {
            item.resolve({
              address: item.address,
              status: 'unconfirmed',
              data: null,
              confirmed: false,
              durationMs: this.config.replyTimeoutMs ?? DEFAULTS.replyTimeoutMs,
              error: error.message,
            });
            this.scheduleReconnect();
            break;
          }
          item.reject(error instanceof Error ? error : new Error(String(error)));
          this.scheduleReconnect();
          break;
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length > 0 && this.started && this.connection?.connected && this.authenticated) {
        void this.drain();
      }
    }
  }

  private async dispatch(item: QueuedCommand): Promise<QLabCommandResult> {
    if (!this.connection) {
      throw new QLabError('not_connected', 'Not connected to QLab');
    }

    const startedAt = Date.now();
    const timeout = this.config.replyTimeoutMs ?? DEFAULTS.replyTimeoutMs;

    try {
      const message = await this.connection.sendAndWait(item.address, item.args, timeout);
      const parsed = parseQLabReply(message);
      this.lastAckAt = nowIso();
      this.lastError = parsed.status === 'ok' ? null : parsed.status;

      if (parsed.status === 'badpass') {
        throw new QLabError('badpass', 'QLab authentication failed: incorrect passcode');
      }
      if (parsed.status === 'denied') {
        throw new QLabError('denied', 'QLab authentication failed: access denied');
      }

      return {
        address: item.address,
        status: parsed.status,
        data: parsed.data,
        confirmed: parsed.status === 'ok',
        durationMs: Date.now() - startedAt,
        error: parsed.status === 'ok' ? undefined : `QLab returned "${parsed.status}"`,
      };
    } catch (error) {
      if (error instanceof QLabError && error.code === 'reply_timeout') {
        this.lastError = error.message;
        throw error;
      }
      throw error;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connection?.connected && this.authenticated) {
      return;
    }
    if (this.connectLock) {
      await this.connectLock;
      if (this.connection?.connected && this.authenticated) {
        return;
      }
    }

    this.connectLock = this.connectInternal();
    try {
      await this.connectLock;
    } finally {
      this.connectLock = null;
    }
  }

  private async connectInternal(): Promise<void> {
    if (this.connection?.connected && this.authenticated) {
      return;
    }

    if (this.connection) {
      await this.connection.close().catch(() => undefined);
      this.connection = null;
    }

    const connection = new QLabTcpConnection({
      host: this.config.host,
      port: this.config.port,
    });
    this.connection = connection;
    this.authenticating = true;

    try {
      await connection.connect(this.config.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs);

      if (!this.workspaceId) {
        await this.autoResolveWorkspace(connection);
      }

      if (this.config.passcode) {
        const address = qlabAddress(this.workspaceId, '/connect');
        const message = await connection.sendAndWait(
          address,
          [this.config.passcode],
          this.config.replyTimeoutMs ?? DEFAULTS.replyTimeoutMs
        );
        const parsed = parseQLabReply(message);
        if (parsed.status !== 'ok') {
          throw new QLabError(parsed.status, `QLab authentication failed: ${parsed.status}`);
        }
      }

      const versionMessage = await connection.sendAndWait(
        '/version',
        [],
        this.config.replyTimeoutMs ?? DEFAULTS.replyTimeoutMs
      );
      const versionReply = parseQLabReply<string>(versionMessage);
      this.version = typeof versionReply.data === 'string' ? versionReply.data : 'unknown';
      this.authenticated = true;
      this.reconnectAttempt = 0;
      this.lastAckAt = nowIso();
      this.lastError = null;
    } catch (error) {
      this.authenticated = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      await connection.close().catch(() => undefined);
      this.connection = null;
      throw error;
    } finally {
      this.authenticating = false;
    }
  }

  private async autoResolveWorkspace(connection: QLabTcpConnection): Promise<void> {
    try {
      const message = await connection.sendAndWait(
        '/workspaces',
        [],
        this.config.replyTimeoutMs ?? DEFAULTS.replyTimeoutMs
      );
      const parsed = parseQLabReply<QLabWorkspaceInfo[]>(message);
      const workspaces = Array.isArray(parsed.data) ? parsed.data : [];
      const matchingPort = workspaces.filter((workspace) => workspace.port === this.config.port);
      const candidates = matchingPort.length > 0 ? matchingPort : workspaces;
      if (candidates.length === 1) {
        this.workspaceId = candidates[0]!.uniqueID;
      }
    } catch {
      // Workspace list is optional; commands can still be broadcast.
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.config.heartbeatIntervalMs ?? DEFAULTS.heartbeatIntervalMs;
    this.heartbeatTimer = setInterval(() => {
      if (!this.started || this.queue.length > 0) return;
      void this.enqueue('/version', [], 'normal').catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.scheduleReconnect();
      });
    }, interval);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) return;
    const min = this.config.reconnectMinMs ?? DEFAULTS.reconnectMinMs;
    const max = this.config.reconnectMaxMs ?? DEFAULTS.reconnectMaxMs;
    const delay = Math.min(max, min * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.authenticated = false;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected()
        .then(() => {
          void this.drain();
        })
        .catch((error: unknown) => {
          this.lastError = error instanceof Error ? error.message : String(error);
          this.scheduleReconnect();
        });
    }, delay);
    this.reconnectTimer.unref?.();
  }
}

export function createQLabSession(config: QLabNetworkConfig): QLabSession {
  return new QLabSession(config);
}
