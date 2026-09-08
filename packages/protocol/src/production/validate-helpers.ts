import { PackError } from './errors.js';
import { isRecord } from './canonical.js';

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new PackError('invalid_request', `${label} must be an object.`);
  return value;
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PackError('invalid_request', `${label} must be a non-empty string.`);
  }
  return value;
}

export function optionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, label);
}

export function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PackError('invalid_request', `${label} must be a finite number.`);
  }
  return value;
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new PackError('invalid_request', `${label} must be a boolean.`);
  return value;
}

export function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new PackError('invalid_request', `${label} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new PackError('invalid_request', `${label} must be an array.`);
  return value;
}

export function requireStringArray(value: unknown, label: string): string[] {
  const items = requireArray(value, label);
  return items.map((item, index) => requireString(item, `${label}[${index}]`));
}

export function shaLike(value: string): boolean {
  return /^[a-f0-9]{32,128}$/i.test(value);
}
