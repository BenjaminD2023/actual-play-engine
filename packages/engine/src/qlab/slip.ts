/** Double-end SLIP framing (RFC 1055) as required by OSC 1.1 over TCP. */

export const SLIP_END = 0xc0;
export const SLIP_ESC = 0xdb;
export const SLIP_ESC_END = 0xdc;
export const SLIP_ESC_ESC = 0xdd;

export function slipEncode(data: Buffer): Buffer {
  const chunks: Buffer[] = [Buffer.from([SLIP_END])];

  for (let i = 0; i < data.length; i++) {
    const byte = data[i]!;
    if (byte === SLIP_END) {
      chunks.push(Buffer.from([SLIP_ESC, SLIP_ESC_END]));
    } else if (byte === SLIP_ESC) {
      chunks.push(Buffer.from([SLIP_ESC, SLIP_ESC_ESC]));
    } else {
      chunks.push(Buffer.from([byte]));
    }
  }

  chunks.push(Buffer.from([SLIP_END]));
  return Buffer.concat(chunks);
}

export function decodeSlipEscapes(data: Buffer): Buffer {
  const result: number[] = [];
  let i = 0;

  while (i < data.length) {
    if (data[i] === SLIP_ESC && i + 1 < data.length) {
      if (data[i + 1] === SLIP_ESC_END) {
        result.push(SLIP_END);
      } else if (data[i + 1] === SLIP_ESC_ESC) {
        result.push(SLIP_ESC);
      } else {
        result.push(data[i]!, data[i + 1]!);
      }
      i += 2;
    } else {
      result.push(data[i]!);
      i += 1;
    }
  }

  return Buffer.from(result);
}

export function extractSlipFrames(data: Buffer): { frames: Buffer[]; remaining: Buffer } {
  const frames: Buffer[] = [];
  let start = 0;

  for (let i = 0; i < data.length; i++) {
    if (data[i] === SLIP_END) {
      if (i > start) {
        frames.push(decodeSlipEscapes(data.subarray(start, i)));
      }
      start = i + 1;
    }
  }

  return {
    frames,
    remaining: start < data.length ? data.subarray(start) : Buffer.alloc(0),
  };
}
