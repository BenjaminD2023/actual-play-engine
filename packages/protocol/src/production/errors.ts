export const PACK_ERROR_CODES = [
  'invalid_request',
  'invalid_pack',
  'invalid_protocol',
  'checksum_mismatch',
  'unsafe_archive',
  'duplicate_id',
  'circular_reference',
  'unknown_step',
  'unknown_capability',
  'forbidden',
  'not_found',
  'not_ready',
  'unavailable',
  'unconfirmed',
  'publication_blocked',
] as const;

export type PackErrorCode = (typeof PACK_ERROR_CODES)[number];

export const PACK_ERROR_HTTP: Record<PackErrorCode, number> = {
  invalid_request: 400,
  invalid_pack: 400,
  invalid_protocol: 400,
  checksum_mismatch: 400,
  unsafe_archive: 400,
  duplicate_id: 400,
  circular_reference: 400,
  unknown_step: 400,
  unknown_capability: 400,
  forbidden: 403,
  not_found: 404,
  not_ready: 409,
  unavailable: 503,
  unconfirmed: 202,
  publication_blocked: 409,
};

export class PackError extends Error {
  readonly code: PackErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: PackErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PackError';
    this.code = code;
    this.httpStatus = PACK_ERROR_HTTP[code];
    this.details = details;
  }

  toJSON() {
    return this.details
      ? { error: this.code, message: this.message, details: this.details }
      : { error: this.code, message: this.message };
  }
}
