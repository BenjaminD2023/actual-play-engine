export const PACK_FORMAT_ID = 'actualplay.production-pack';
export const PACK_FORMAT_VERSION = 1;
export const ACTION_FORMAT_VERSION = 1;
export const MIN_COMPATIBLE_ENGINE = '0.1.0';
export const MAX_TESTED_ENGINE = '0.1.0';
export const PACK_EXTENSION = '.actualplay-pack';

export function isSupportedPackVersion(version: unknown): version is number {
  return typeof version === 'number' && Number.isInteger(version) && version === PACK_FORMAT_VERSION;
}
