import { inflateRawSync } from 'node:zlib';
import { PackError } from '@actualplay/protocol/production';

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

export function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function assertSafeZipPath(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.includes('..') || normalized.includes(':')) {
    throw new PackError('unsafe_archive', `Unsafe archive path: ${name}`);
  }
  return normalized;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function extractZipEntries(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  let total = 0;
  const names = new Set<string>();
  while (offset + 30 <= buffer.length) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    if ((flags & 9) || (method !== 0 && method !== 8)) throw new PackError('invalid_pack', 'Unsupported ZIP encryption, descriptor or compression.');
    const compact = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = assertSafeZipPath(buffer.toString('utf8', offset + 30, offset + 30 + nameLen));
    const start = offset + 30 + nameLen + extraLen;
    if (compact > MAX_FILE_BYTES) {
      throw new PackError('invalid_pack', `Archive entry ${name} exceeds the 25MB file limit.`);
    }
    if (start + compact > buffer.length || start > buffer.length) throw new PackError('invalid_pack', 'Truncated ZIP entry.');
    if (names.has(name)) throw new PackError('invalid_pack', `Duplicate archive path ${name}.`);
    names.add(name);
    const stored = buffer.subarray(start, start + compact);
    let data: Buffer;
    try { data = method === 0 ? Buffer.from(stored) : inflateRawSync(stored, { maxOutputLength: MAX_FILE_BYTES }); }
    catch { throw new PackError('invalid_pack', 'Invalid or oversized compressed entry.'); }
    if (data.length !== buffer.readUInt32LE(offset + 22) || crc32(data) !== buffer.readUInt32LE(offset + 14)) throw new PackError('checksum_mismatch', `ZIP checksum mismatch for ${name}.`);
    if (data.byteLength > MAX_FILE_BYTES) {
      throw new PackError('invalid_pack', `Archive entry ${name} exceeds the 25MB file limit.`);
    }
    total += data.byteLength;
    if (total > MAX_TOTAL_BYTES) {
      throw new PackError('invalid_pack', 'Archive exceeds the 80MB unpacked limit.');
    }
    if (!name.endsWith('/')) entries.push({ name, data });
    offset = start + compact;
  }
  if (entries.length === 0) {
    throw new PackError('invalid_pack', 'Archive contains no files.');
  }
  return entries;
}

export function createZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(assertSafeZipPath(entry.name), 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length + entry.data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    entry.data.copy(local, 30 + name.length);
    locals.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }

  const centralStart = offset;
  const centralSize = centrals.reduce((sum, buf) => sum + buf.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, eocd]);
}
