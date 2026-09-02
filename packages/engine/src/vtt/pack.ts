import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { ProtocolError, PROTOCOL_VERSION, type SceneDocument } from '@actualplay/protocol';

export interface ScenePackage {
  protocolVersion: number;
  manifest: { title: string; exportedAt: string; checksum: string };
  scene: { title: string; document: SceneDocument };
  assets: Array<{ hash: string; mime: string; data: string }>;
}

export function exportScenePackage(title: string, document: SceneDocument, assets: Array<{ hash: string; mime: string; data: Buffer }>): ScenePackage {
  const pack: ScenePackage = {
    protocolVersion: PROTOCOL_VERSION,
    manifest: { title, exportedAt: new Date().toISOString(), checksum: '' },
    scene: { title, document },
    assets: assets.map((asset) => ({ hash: asset.hash, mime: asset.mime, data: asset.data.toString('base64') })),
  };
  pack.manifest.checksum = checksumPackage(pack);
  return pack;
}

export function importScenePackage(raw: unknown): ScenePackage {
  if (!raw || typeof raw !== 'object') throw new ProtocolError('invalid_request', 'Scene package must be an object.');
  const pack = raw as ScenePackage;
  if (pack.protocolVersion !== PROTOCOL_VERSION) {
    throw new ProtocolError('invalid_protocol', 'Unsupported scene package protocol.');
  }
  const expected = checksumPackage({ ...pack, manifest: { ...pack.manifest, checksum: '' } });
  if (pack.manifest?.checksum !== expected) {
    throw new ProtocolError('invalid_request', 'Scene package checksum mismatch.');
  }
  for (const asset of pack.assets ?? []) {
    const buf = Buffer.from(asset.data, 'base64');
    const hash = createHash('sha256').update(buf).digest('hex');
    if (hash !== asset.hash) throw new ProtocolError('invalid_request', 'Asset hash mismatch.');
  }
  return pack;
}

function checksumPackage(pack: ScenePackage): string {
  const copy = { ...pack, manifest: { ...pack.manifest, checksum: '' } };
  return createHash('sha256').update(JSON.stringify(copy)).digest('hex');
}

export function assertSafeZipPath(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.includes('..') || normalized.includes(':')) {
    throw new ProtocolError('invalid_request', `Unsafe archive path: ${name}`);
  }
  return normalized;
}

export function extractZipEntries(buffer: Buffer): Array<{ name: string; data: Buffer }> {
  const entries: Array<{ name: string; data: Buffer }> = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compact = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLen);
    assertSafeZipPath(name);
    const start = offset + 30 + nameLen + extraLen;
    const stored = buffer.subarray(start, start + compact);
    const data = method === 0 ? Buffer.from(stored) : inflateSync(stored);
    entries.push({ name, data });
    offset = start + compact;
  }
  return entries;
}
