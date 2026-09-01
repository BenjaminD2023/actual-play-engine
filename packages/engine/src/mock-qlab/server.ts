import net from 'node:net';
import { extractSlipFrames, slipEncode } from '../qlab/slip.js';
import { decodeOscMessage, oscEncode, type OscMessage } from '../qlab/osc.js';
import { qlabReplyJson } from '../qlab/reply.js';
import type { QLabAckStatus, QLabWorkspaceInfo } from '../qlab/types.js';

export interface MockQLabOptions {
  host?: string;
  port?: number;
  passcode?: string | null;
  version?: string;
  workspaces?: QLabWorkspaceInfo[];
  delayMs?: number;
  dropNext?: number;
  refusePasscode?: boolean;
}

export interface MockQLabReceived {
  address: string;
  args: OscMessage['args'];
}

export class MockQLabServer {
  readonly received: MockQLabReceived[] = [];
  private server: net.Server | null = null;
  private sockets = new Set<net.Socket>();
  private dropRemaining: number;
  delayMs: number;
  refusePasscode: boolean;
  passcode: string | null;
  version: string;
  workspaces: QLabWorkspaceInfo[];

  constructor(private readonly options: MockQLabOptions = {}) {
    this.dropRemaining = options.dropNext ?? 0;
    this.delayMs = options.delayMs ?? 0;
    this.refusePasscode = options.refusePasscode ?? false;
    this.passcode = options.passcode ?? null;
    this.version = options.version ?? '5.4.8';
    this.workspaces = options.workspaces ?? [
      {
        uniqueID: 'mock-workspace',
        displayName: 'Mock Workspace',
        port: options.port ?? 53000,
        version: this.version,
      },
    ];
  }

  get port(): number {
    const address = this.server?.address();
    if (address && typeof address === 'object') return address.port;
    return this.options.port ?? 0;
  }

  async start(): Promise<{ host: string; port: number }> {
    const host = this.options.host ?? '127.0.0.1';
    const requestedPort = this.options.port ?? 0;

    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => this.handleSocket(socket));
      this.server = server;
      server.on('error', reject);
      server.listen(requestedPort, host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    return { host, port: this.port };
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = null;
  }

  dropNext(count = 1): void {
    this.dropRemaining += count;
  }

  private handleSocket(socket: net.Socket): void {
    this.sockets.add(socket);
    let buffer: Buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const extracted = extractSlipFrames(buffer);
      buffer = extracted.remaining;

      for (const frame of extracted.frames) {
        if (frame.length === 0) continue;
        const message = decodeOscMessage(frame);
        if (!message) continue;
        void this.handleMessage(socket, message);
      }
    });

    socket.on('close', () => {
      this.sockets.delete(socket);
    });
  }

  private async handleMessage(socket: net.Socket, message: OscMessage): Promise<void> {
    this.received.push({ address: message.address, args: message.args });

    if (this.dropRemaining > 0) {
      this.dropRemaining -= 1;
      return;
    }

    if (message.address === '/disconnect') {
      socket.end();
      return;
    }

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    const reply = this.buildReply(message);
    if (!reply) return;

    const payload = slipEncode(oscEncode(`/reply${message.address}`, [reply.json]));
    socket.write(payload);
  }

  private buildReply(message: OscMessage): { json: string } | null {
    const address = message.address;

    if (address.endsWith('/connect') || address === '/connect') {
      const status: QLabAckStatus = this.refusePasscode
        ? 'badpass'
        : this.passcode && message.args[0] !== this.passcode
          ? 'badpass'
          : 'ok';
      return { json: qlabReplyJson(address, status, null, this.workspaces[0]?.uniqueID) };
    }

    if (address === '/version') {
      return { json: qlabReplyJson(address, 'ok', this.version, this.workspaces[0]?.uniqueID) };
    }

    if (address === '/workspaces') {
      return { json: qlabReplyJson(address, 'ok', this.workspaces, this.workspaces[0]?.uniqueID) };
    }

    if (address.endsWith('/cueLists') || address === '/cueLists') {
      return {
        json: qlabReplyJson(
          address,
          'ok',
          [
            {
              uniqueID: 'list-1',
              number: '',
              name: 'Main Cue List',
              type: 'Cue List',
              cues: [
                { uniqueID: 'c1', number: '1', name: 'Welcome', type: 'Audio' },
                { uniqueID: 'c10', number: '10', name: 'Battle', type: 'Audio' },
              ],
            },
          ],
          this.workspaces[0]?.uniqueID
        ),
      };
    }

    if (
      address.endsWith('/start') ||
      address.endsWith('/stop') ||
      address.endsWith('/pause') ||
      address.endsWith('/load') ||
      address.endsWith('/reset') ||
      address.endsWith('/go') ||
      address.endsWith('/panic')
    ) {
      return { json: qlabReplyJson(address, 'ok', null, this.workspaces[0]?.uniqueID) };
    }

    return { json: qlabReplyJson(address, 'ok', null, this.workspaces[0]?.uniqueID) };
  }
}
