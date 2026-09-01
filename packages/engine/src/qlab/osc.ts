export type OscArg = string | number | boolean;

export interface OscMessage {
  address: string;
  args: OscArg[];
}

function pad4(length: number): number {
  return (4 - (length % 4)) % 4;
}

export function encodeOscString(value: string): Buffer {
  const buf = Buffer.from(value, 'utf8');
  const nullTerminated = Buffer.concat([buf, Buffer.alloc(1, 0)]);
  return Buffer.concat([nullTerminated, Buffer.alloc(pad4(nullTerminated.length), 0)]);
}

function encodeOscArg(arg: OscArg): { tag: string; data: Buffer } {
  if (typeof arg === 'string') {
    return { tag: 's', data: encodeOscString(arg) };
  }
  if (typeof arg === 'boolean') {
    return { tag: arg ? 'T' : 'F', data: Buffer.alloc(0) };
  }
  if (Number.isInteger(arg)) {
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(arg, 0);
    return { tag: 'i', data: buf };
  }
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(arg, 0);
  return { tag: 'f', data: buf };
}

export function oscEncode(address: string, args: OscArg[] = []): Buffer {
  const parts: Buffer[] = [encodeOscString(address)];

  if (args.length === 0) {
    return Buffer.concat(parts);
  }

  const encoded = args.map(encodeOscArg);
  parts.push(encodeOscString(',' + encoded.map((item) => item.tag).join('')));
  for (const item of encoded) {
    if (item.data.length > 0) {
      parts.push(item.data);
    }
  }

  return Buffer.concat(parts);
}

export function decodeOscString(
  data: Buffer,
  offset: number
): { value: string; nextOffset: number } | null {
  if (offset >= data.length) return null;

  let end = offset;
  while (end < data.length && data[end] !== 0) end += 1;
  if (end >= data.length) return null;

  const value = data.subarray(offset, end).toString('utf8');
  const nextOffset = Math.ceil((end + 1) / 4) * 4;
  return { value, nextOffset };
}

export function decodeOscMessage(data: Buffer): OscMessage | null {
  if (data.length < 4) return null;

  const addressResult = decodeOscString(data, 0);
  if (!addressResult) return null;

  const address = addressResult.value;
  if (address === '#bundle') return null;

  let offset = addressResult.nextOffset;
  if (offset >= data.length) {
    return { address, args: [] };
  }

  const tagsResult = decodeOscString(data, offset);
  if (!tagsResult || !tagsResult.value.startsWith(',')) {
    return { address, args: [] };
  }

  const typeTags = tagsResult.value.slice(1);
  offset = tagsResult.nextOffset;
  const args: OscArg[] = [];

  for (const tag of typeTags) {
    switch (tag) {
      case 's': {
        const strResult = decodeOscString(data, offset);
        if (!strResult) return { address, args };
        args.push(strResult.value);
        offset = strResult.nextOffset;
        break;
      }
      case 'i': {
        if (offset + 4 > data.length) return { address, args };
        args.push(data.readInt32BE(offset));
        offset += 4;
        break;
      }
      case 'f': {
        if (offset + 4 > data.length) return { address, args };
        args.push(data.readFloatBE(offset));
        offset += 4;
        break;
      }
      case 'T':
        args.push(true);
        break;
      case 'F':
        args.push(false);
        break;
      case 'b': {
        if (offset + 4 > data.length) return { address, args };
        const blobSize = data.readInt32BE(offset);
        offset += 4 + Math.ceil(blobSize / 4) * 4;
        break;
      }
      default:
        return { address, args };
    }
  }

  return { address, args };
}
