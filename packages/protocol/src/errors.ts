export const ERROR_CODES = [
  'unauthenticated',
  'forbidden',
  'not_found',
  'invalid_request',
  'invalid_protocol',
  'version_conflict',
  'duplicate_command',
  'unavailable',
  'external_unconfirmed',
  'external_failure',
  'rate_limited',
  'migration_required',
  'asset_missing',
  'scene_not_published',
  'scene_not_active',
  'unconfirmed',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  invalid_protocol: 400,
  version_conflict: 409,
  duplicate_command: 409,
  unavailable: 503,
  external_unconfirmed: 202,
  external_failure: 502,
  rate_limited: 429,
  migration_required: 503,
  asset_missing: 404,
  scene_not_published: 409,
  scene_not_active: 409,
  unconfirmed: 202,
};

export interface ProtocolErrorBody {
  error: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class ProtocolError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
    this.details = details;
  }

  toJSON(): ProtocolErrorBody {
    return this.details ? { error: this.code, message: this.message, details: this.details } : { error: this.code, message: this.message };
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

export function protocolErrorBody(error: unknown): ProtocolErrorBody {
  if (error instanceof ProtocolError) return error.toJSON();
  if (error instanceof Error) return { error: 'invalid_request', message: error.message };
  return { error: 'invalid_request', message: 'Request failed.' };
}
