import { describe, expect, it } from 'vitest';
import { SLIP_END, SLIP_ESC, decodeSlipEscapes, extractSlipFrames, slipEncode } from '../src/qlab/slip.js';

describe('SLIP', () => {
  it('round-trips ordinary bytes with double END markers', () => {
    const payload = Buffer.from([1, 2, 3, 4]);
    const framed = slipEncode(payload);
    expect(framed[0]).toBe(SLIP_END);
    expect(framed[framed.length - 1]).toBe(SLIP_END);
    const { frames } = extractSlipFrames(framed);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.equals(payload)).toBe(true);
  });

  it('escapes END and ESC bytes', () => {
    const payload = Buffer.from([SLIP_END, SLIP_ESC, 9]);
    const framed = slipEncode(payload);
    const interior = [...framed.subarray(1, framed.length - 1)];
    expect(interior).not.toContain(SLIP_END);
    expect(framed[0]).toBe(SLIP_END);
    expect(framed[framed.length - 1]).toBe(SLIP_END);
    const { frames } = extractSlipFrames(framed);
    expect(frames[0]!.equals(payload)).toBe(true);
  });

  it('reassembles frames split across TCP chunks', () => {
    const first = slipEncode(Buffer.from('hello'));
    const second = slipEncode(Buffer.from('world'));
    const combined = Buffer.concat([first, second]);
    const mid = Math.floor(combined.length / 2);
    const part1 = extractSlipFrames(combined.subarray(0, mid));
    const part2 = extractSlipFrames(Buffer.concat([part1.remaining, combined.subarray(mid)]));
    const frames = [...part1.frames, ...part2.frames];
    expect(frames.map((frame) => frame.toString())).toEqual(['hello', 'world']);
  });

  it('decodes escape sequences that are not END/ESC as literal pairs', () => {
    expect(decodeSlipEscapes(Buffer.from([SLIP_ESC, 0x01, 7]))).toEqual(Buffer.from([SLIP_ESC, 0x01, 7]));
  });
});
