import type { OscArg } from './osc.js';

export interface QLabNetworkConfig {
  host: string;
  port: number;
  workspaceId?: string | null;
  passcode?: string | null;
  connectTimeoutMs?: number;
  replyTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}

export interface QLabWorkspaceInfo {
  uniqueID: string;
  displayName: string;
  port: number;
  udpReplyPort?: number;
  version?: string;
}

export interface QLabCueInfo {
  uniqueID?: string;
  number: string;
  name: string;
  type?: string;
  listName?: string;
}

export type QLabAckStatus = 'ok' | 'error' | 'denied' | 'badpass' | 'unconfirmed';

export interface QLabCommandResult {
  address: string;
  status: QLabAckStatus;
  data: unknown;
  confirmed: boolean;
  durationMs: number;
  error?: string;
}

export interface QLabHealth {
  connected: boolean;
  reachable: boolean;
  authenticating: boolean;
  authenticated: boolean;
  host: string;
  port: number;
  workspaceId: string | null;
  version: string | null;
  lastAckAt: string | null;
  lastError: string | null;
  queueDepth: number;
  reconnectAttempt: number;
}

export interface QLabDriver {
  readonly kind: 'tcp' | 'dry-run';
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): QLabHealth;
  startCue(cueNumber: string): Promise<QLabCommandResult>;
  stopCue(cueNumber: string): Promise<QLabCommandResult>;
  workspaceGo(): Promise<QLabCommandResult>;
  workspaceStop(): Promise<QLabCommandResult>;
  panic(): Promise<QLabCommandResult>;
  reset(): Promise<QLabCommandResult>;
  send(address: string, args?: OscArg[]): Promise<QLabCommandResult>;
  listWorkspaces(): Promise<QLabWorkspaceInfo[]>;
  listCues(): Promise<QLabCueInfo[]>;
}

export interface QLabReplyEnvelope<T = unknown> {
  workspace_id?: string;
  address?: string;
  status?: string;
  data?: T;
}
