import type { OscMessage } from './osc.js';
import type { QLabAckStatus, QLabReplyEnvelope } from './types.js';

export function normalizeReplyStatus(value: unknown): QLabAckStatus {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'ok';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'ok' || normalized === 'error' || normalized === 'denied' || normalized === 'badpass') {
    return normalized;
  }
  if (normalized.includes('badpass')) return 'badpass';
  if (normalized.includes('denied')) return 'denied';
  if (normalized.includes('error')) return 'error';
  return 'ok';
}

export function parseQLabReply<T = unknown>(message: OscMessage): {
  status: QLabAckStatus;
  data: T | null;
  workspaceId: string | null;
  address: string | null;
} {
  const rawArg = message.args[0];

  if (typeof rawArg === 'string') {
    try {
      const parsed = JSON.parse(rawArg) as QLabReplyEnvelope<T>;
      if (parsed && typeof parsed === 'object') {
        return {
          status: normalizeReplyStatus(parsed.status),
          data: (parsed.data ?? null) as T | null,
          workspaceId: typeof parsed.workspace_id === 'string' ? parsed.workspace_id : null,
          address: typeof parsed.address === 'string' ? parsed.address : null,
        };
      }
    } catch {
      return {
        status: normalizeReplyStatus(rawArg),
        data: rawArg as T,
        workspaceId: null,
        address: null,
      };
    }
  }

  return {
    status: 'ok',
    data: (rawArg ?? null) as T | null,
    workspaceId: null,
    address: null,
  };
}

export function qlabReplyJson(
  address: string,
  status: QLabAckStatus,
  data: unknown = null,
  workspaceId?: string
): string {
  return JSON.stringify({
    workspace_id: workspaceId ?? 'mock-workspace',
    address,
    status,
    data,
  });
}
