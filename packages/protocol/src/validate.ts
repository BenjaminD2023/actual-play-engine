import { ProtocolError } from './errors.js';
import { isCompatibleProtocolVersion } from './version.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ProtocolError('invalid_request', `${label} must be an object.`);
  return value;
}

export function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ProtocolError('invalid_request', 'Expected a string.');
  return value;
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProtocolError('invalid_request', `${label} must be a non-empty string.`);
  }
  return value;
}

export function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProtocolError('invalid_request', `${label} must be a finite number.`);
  }
  return value;
}

export function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireFiniteNumber(value, label);
}

export function requireInteger(value: unknown, label: string): number {
  const n = requireFiniteNumber(value, label);
  if (!Number.isInteger(n)) throw new ProtocolError('invalid_request', `${label} must be an integer.`);
  return n;
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new ProtocolError('invalid_request', `${label} must be a boolean.`);
  return value;
}

export function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return requireBoolean(value, label);
}

export function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ProtocolError('invalid_request', `${label} must be an array of strings.`);
  }
  return value;
}

export function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ProtocolError('invalid_request', `${label} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function requireProtocolVersion(value: unknown): number {
  if (!isCompatibleProtocolVersion(value)) {
    throw new ProtocolError('invalid_protocol', `Unsupported protocol version: ${String(value)}`);
  }
  return value;
}

export function shaLike(value: string): boolean {
  return /^[a-f0-9]{32,128}$/i.test(value);
}
