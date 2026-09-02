import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ProtocolError, type AssetMetadata } from '@actualplay/protocol';
import { createId, nowIso } from '../ids.js';
import type { VttTables } from './tables.js';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const MAGIC: Array<{ mime: string; test: (buf: Buffer) => boolean }> = [
  { mime: 'image/png', test: (buf) => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 },
  { mime: 'image/jpeg', test: (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff },
  { mime: 'image/webp', test: (buf) => buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP' },
  { mime: 'video/webm', test: (buf) => buf.length > 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3 },
  { mime: 'video/mp4', test: (buf) => buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp' },
  { mime: 'application/pdf', test: (buf) => buf.toString('ascii', 0, 5) === '%PDF-' },
  { mime: 'text/markdown', test: (buf) => buf.length > 0 && !buf.includes(0) },
  { mime: 'text/plain', test: (buf) => buf.length > 0 && !buf.includes(0) },
];

export function detectMime(buffer: Buffer, claimed?: string): string {
  const matched = MAGIC.find((entry) => entry.test(buffer));
  if (!matched) throw new ProtocolError('invalid_request', 'Unsupported or unrecognized file signature.');
  if (claimed && claimed !== matched.mime && !(claimed.startsWith('text/') && matched.mime.startsWith('text/'))) {
    throw new ProtocolError('invalid_request', `MIME mismatch: claimed ${claimed}, detected ${matched.mime}.`);
  }
  if (matched.mime === 'image/svg+xml' || claimed === 'image/svg+xml') {
    throw new ProtocolError('invalid_request', 'SVG uploads are rejected.');
  }
  return matched.mime;
}

export class AssetService {
  constructor(
    private readonly tables: VttTables,
    private readonly root: string
  ) {
    fs.mkdirSync(this.root, { recursive: true });
  }

  store(buffer: Buffer, originalName: string, createdBy: string | null, claimedMime?: string): AssetMetadata {
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new ProtocolError('invalid_request', 'File exceeds upload limit.');
    }
    const safeName = path.basename(originalName).replace(/[^\w.\-]+/g, '_');
    if (safeName.includes('..')) throw new ProtocolError('invalid_request', 'Invalid file name.');
    const mime = detectMime(buffer, claimedMime);
    const hash = createHash('sha256').update(buffer).digest('hex');
    const existing = this.tables.getAssetByHash(hash);
    if (existing) return existing;
    const dir = path.join(this.root, hash);
    fs.mkdirSync(dir, { recursive: true });
    const originalPath = path.join(dir, 'original');
    fs.writeFileSync(originalPath, buffer);
    const displayPath = path.join(dir, 'display');
    const thumbPath = path.join(dir, 'thumb');
    fs.copyFileSync(originalPath, displayPath);
    fs.copyFileSync(originalPath, thumbPath);
    const asset: AssetMetadata = {
      id: createId(),
      hash,
      mime,
      byteSize: buffer.byteLength,
      originalName: safeName,
      width: null,
      height: null,
      durationMs: mime.startsWith('video/') ? 0 : null,
      variants: [
        { name: 'original', path: originalPath, width: null, height: null, byteSize: buffer.byteLength },
        { name: 'display', path: displayPath, width: null, height: null, byteSize: buffer.byteLength },
        { name: 'thumb', path: thumbPath, width: null, height: null, byteSize: buffer.byteLength },
      ],
      createdAt: nowIso(),
      createdBy,
    };
    return this.tables.putAsset(asset);
  }

  read(hash: string, variant: 'original' | 'display' | 'thumb' = 'original'): Buffer {
    const asset = this.tables.getAssetByHash(hash);
    if (!asset) throw new ProtocolError('asset_missing', 'Asset was not found.');
    const file = asset.variants.find((item) => item.name === variant)?.path;
    if (!file || !fs.existsSync(file)) throw new ProtocolError('asset_missing', 'Asset variant missing on disk.');
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(this.root))) {
      throw new ProtocolError('forbidden', 'Asset path escaped storage root.');
    }
    return fs.readFileSync(resolved);
  }

  readById(id: string, variant: 'original' | 'display' | 'thumb' = 'display'): { buffer: Buffer; mime: string } {
    const asset = this.tables.getAsset(id);
    if (!asset) throw new ProtocolError('asset_missing', 'Asset was not found.');
    return { buffer: this.read(asset.hash, variant), mime: asset.mime };
  }
}
