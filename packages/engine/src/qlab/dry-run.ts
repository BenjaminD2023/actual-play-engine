import { nowIso } from '../ids.js';
import { cueAddress, qlabAddress } from './addresses.js';
import type { OscArg } from './osc.js';
import type { QLabCommandResult, QLabCueInfo, QLabDriver, QLabHealth, QLabNetworkConfig, QLabWorkspaceInfo } from './types.js';

export interface DryRunFire {
  address: string;
  args: OscArg[];
  at: string;
}

export class DryRunQLab implements QLabDriver {
  readonly kind = 'dry-run' as const;
  readonly fires: DryRunFire[] = [];
  private started = false;
  private lastAckAt: string | null = null;

  constructor(private readonly config: Pick<QLabNetworkConfig, 'host' | 'port' | 'workspaceId'> = {
    host: '127.0.0.1',
    port: 53000,
    workspaceId: 'dry-run',
  }) {}

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  health(): QLabHealth {
    return {
      connected: this.started,
      reachable: true,
      authenticating: false,
      authenticated: true,
      host: this.config.host,
      port: this.config.port,
      workspaceId: this.config.workspaceId ?? 'dry-run',
      version: 'dry-run',
      lastAckAt: this.lastAckAt,
      lastError: null,
      queueDepth: 0,
      reconnectAttempt: 0,
    };
  }

  async startCue(cueNumber: string): Promise<QLabCommandResult> {
    return this.record(cueAddress(this.config.workspaceId ?? null, cueNumber, 'start'));
  }

  async stopCue(cueNumber: string): Promise<QLabCommandResult> {
    return this.record(cueAddress(this.config.workspaceId ?? null, cueNumber, 'stop'));
  }

  async workspaceGo(): Promise<QLabCommandResult> {
    return this.record(qlabAddress(this.config.workspaceId ?? null, '/go'));
  }

  async workspaceStop(): Promise<QLabCommandResult> {
    return this.record(qlabAddress(this.config.workspaceId ?? null, '/stop'));
  }

  async panic(): Promise<QLabCommandResult> {
    return this.record(qlabAddress(this.config.workspaceId ?? null, '/panic'));
  }

  async reset(): Promise<QLabCommandResult> {
    return this.record(qlabAddress(this.config.workspaceId ?? null, '/reset'));
  }

  async send(address: string, args: OscArg[] = []): Promise<QLabCommandResult> {
    return this.record(address, args);
  }

  async listWorkspaces(): Promise<QLabWorkspaceInfo[]> {
    return [
      {
        uniqueID: this.config.workspaceId ?? 'dry-run',
        displayName: 'Dry Run Workspace',
        port: this.config.port,
        version: 'dry-run',
      },
    ];
  }

  async listCues(): Promise<QLabCueInfo[]> {
    return [];
  }

  private record(address: string, args: OscArg[] = []): QLabCommandResult {
    const at = nowIso();
    this.fires.push({ address, args, at });
    this.lastAckAt = at;
    return {
      address,
      status: 'ok',
      data: null,
      confirmed: true,
      durationMs: 0,
    };
  }
}
