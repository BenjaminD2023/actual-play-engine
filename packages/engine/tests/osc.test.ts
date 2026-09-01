import { describe, expect, it } from 'vitest';
import { decodeOscMessage, oscEncode } from '../src/qlab/osc.js';
import { canonicalizeCueMethod, cueAddress, replyAddress } from '../src/qlab/addresses.js';

describe('OSC', () => {
  it('round-trips address-only messages', () => {
    const encoded = oscEncode('/version');
    expect(decodeOscMessage(encoded)).toEqual({ address: '/version', args: [] });
  });

  it('round-trips string, int, and float arguments', () => {
    const encoded = oscEncode('/connect', ['secret', 42, 1.5]);
    const decoded = decodeOscMessage(encoded);
    expect(decoded?.address).toBe('/connect');
    expect(decoded?.args[0]).toBe('secret');
    expect(decoded?.args[1]).toBe(42);
    expect(decoded?.args[2]).toBeCloseTo(1.5);
  });

  it('round-trips boolean tags', () => {
    const encoded = oscEncode('/flag', [true, false]);
    expect(decodeOscMessage(encoded)).toEqual({ address: '/flag', args: [true, false] });
  });

  it('returns null for truncated packets', () => {
    expect(decodeOscMessage(Buffer.from([1, 2]))).toBeNull();
  });

  it('maps legacy cue /go to official /start', () => {
    expect(canonicalizeCueMethod('go')).toBe('start');
    expect(cueAddress(null, '1.1', 'go')).toBe('/cue/1.1/start');
    expect(cueAddress('abc', '10', 'start')).toBe('/workspace/abc/cue/10/start');
    expect(replyAddress('/cue/1.1/start')).toBe('/reply/cue/1.1/start');
  });

  it('rejects cue numbers with spaces', () => {
    expect(() => cueAddress(null, 'cue 1', 'start')).toThrow(/spaces/);
  });
});
