import net from 'node:net';
import { QLabError } from '../errors.js';
import { extractSlipFrames, slipEncode } from './slip.js';
import { decodeOscMessage, oscEncode, type OscArg, type OscMessage } from './osc.js';
import { isReplyFor } from './addresses.js';

type MessageHandler = (message: OscMessage) => void;

export class QLabTcpConnection {
  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private messageHandlers: MessageHandler[] = [];
  private connectedFlag = false;

  constructor(private readonly config: { host: string; port: number }) {}

  get connected(): boolean {
    return this.connectedFlag && this.socket !== null && !this.socket.destroyed;
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((candidate) => candidate !== handler);
    };
  }

  async connect(timeoutMs = 5000): Promise<void> {
    if (this.connected) return;

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({
        host: this.config.host,
        port: this.config.port,
      });

      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          socket.destroy();
          reject(error);
          return;
        }
        this.connectedFlag = true;
        this.socket = socket;
        resolve();
      };

      const timer = setTimeout(() => {
        finish(
          new QLabError(
            'connect_timeout',
            `Connection to QLab at ${this.config.host}:${this.config.port} timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);

      socket.on('connect', () => finish());
      socket.on('error', (err) => {
        if (!settled) {
          finish(
            new QLabError(
              'connect_failed',
              `Cannot connect to QLab at ${this.config.host}:${this.config.port}: ${err.message}`
            )
          );
          return;
        }
        this.connectedFlag = false;
        this.socket = null;
      });
      socket.on('data', (data: Buffer) => this.handleData(data));
      socket.on('close', () => {
        this.connectedFlag = false;
        this.socket = null;
        this.buffer = Buffer.alloc(0);
      });
    });
  }

  async send(address: string, args: OscArg[] = []): Promise<void> {
    if (!this.socket || !this.connected) {
      throw new QLabError('not_connected', 'Not connected to QLab');
    }

    const framed = slipEncode(oscEncode(address, args));
    const socket = this.socket;

    await new Promise<void>((resolve, reject) => {
      socket.write(framed, (error) => {
        if (error) {
          reject(new QLabError('write_failed', error.message));
          return;
        }
        resolve();
      });
    });
  }

  waitForReply(requestAddress: string, timeoutMs = 5000): Promise<OscMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new QLabError(
            'reply_timeout',
            `Timeout waiting for QLab reply on ${requestAddress}`
          )
        );
      }, timeoutMs);

      const unsubscribe = this.onMessage((message) => {
        if (isReplyFor(message.address, requestAddress)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(message);
        }
      });
    });
  }

  async sendAndWait(address: string, args: OscArg[] = [], timeoutMs = 5000): Promise<OscMessage> {
    const replyPromise = this.waitForReply(address, timeoutMs);
    await this.send(address, args);
    return replyPromise;
  }

  async close(): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      this.connectedFlag = false;
      this.socket = null;
      return;
    }

    try {
      if (this.connected) {
        await this.send('/disconnect');
      }
    } catch {
      // Best-effort disconnect.
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        socket.destroy();
        resolve();
      }, 500);

      socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.end();
    });

    this.connectedFlag = false;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.messageHandlers = [];
  }

  private handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    const { frames, remaining } = extractSlipFrames(this.buffer);
    this.buffer = remaining;

    for (const frame of frames) {
      if (frame.length === 0) continue;
      const message = decodeOscMessage(frame);
      if (!message) continue;
      for (const handler of [...this.messageHandlers]) {
        try {
          handler(message);
        } catch {
          // Handler errors must not break the socket pump.
        }
      }
    }
  }
}
