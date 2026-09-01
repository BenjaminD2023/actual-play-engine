import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function generateBridgeToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashBridgeToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function verifyBridgeToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashBridgeToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
