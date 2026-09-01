export const PROTOCOL_VERSION = 1;
export const PROTOCOL_NAME = 'actualplay.vtt';
export const MIN_COMPATIBLE_PROTOCOL_VERSION = 1;

export function isCompatibleProtocolVersion(version: unknown): version is number {
  return typeof version === 'number' && Number.isInteger(version) && version >= MIN_COMPATIBLE_PROTOCOL_VERSION && version <= PROTOCOL_VERSION;
}
