import { describe, expect, it } from 'vitest';
import {
  parseCommandEnvelope,
  ProtocolError,
  PROTOCOL_VERSION,
  isCompatibleProtocolVersion,
} from '../src/index.js';

describe('protocol', () => {
  it('rejects unknown command types instead of succeeding', () => {
    expect(() =>
      parseCommandEnvelope({
        id: 'cmd-1',
        protocolVersion: PROTOCOL_VERSION,
        type: 'token.explode',
        sessionId: 's1',
        payload: {},
      })
    ).toThrow(ProtocolError);
  });

  it('parses a token.move envelope', () => {
    const envelope = parseCommandEnvelope({
      id: 'cmd-2',
      protocolVersion: PROTOCOL_VERSION,
      type: 'token.move',
      sessionId: 's1',
      sceneInstanceId: 'i1',
      expectedVersion: 4,
      payload: { tokenId: 't1', x: 10, y: 20 },
    });
    expect(envelope.type).toBe('token.move');
    expect(envelope.payload.tokenId).toBe('t1');
  });

  it('rejects incompatible protocol versions', () => {
    expect(isCompatibleProtocolVersion(PROTOCOL_VERSION)).toBe(true);
    expect(isCompatibleProtocolVersion(0)).toBe(false);
    expect(isCompatibleProtocolVersion(99)).toBe(false);
  });
});
