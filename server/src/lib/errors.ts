// Error envelope + helpers. Routes throw `ApiError`; the global Fastify error
// handler renders it as the shared `ApiErrorBody` with the right HTTP status.
import type { ApiErrorBody, ErrorCode } from '@arenaze/shared';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation: 400,
  conflict: 409,
  slot_taken: 409,
  invalid_transition: 409,
  idempotency_replay: 200,
  internal: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = STATUS_BY_CODE[code];
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.details !== undefined ? { details: this.details } : {}) } };
  }
}

export const statusForCode = (code: ErrorCode): number => STATUS_BY_CODE[code];

// Convenience constructors for the common cases.
export const Err = {
  unauthorized: (m = 'Authentication required') => new ApiError('unauthorized', m),
  forbidden: (m = 'You do not have access to this resource') => new ApiError('forbidden', m),
  notFound: (m = 'Not found') => new ApiError('not_found', m),
  validation: (m = 'Invalid request', details?: unknown) => new ApiError('validation', m, details),
  conflict: (m = 'Conflict') => new ApiError('conflict', m),
  slotTaken: (m = 'slot just taken') => new ApiError('slot_taken', m),
  invalidTransition: (m = 'Invalid state transition') => new ApiError('invalid_transition', m),
  internal: (m = 'Internal server error') => new ApiError('internal', m),
};
