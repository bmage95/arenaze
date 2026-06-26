// Zod parse helper that throws a `validation` ApiError (400) with flattened details.
import { z } from 'zod';
import { Err } from './errors.js';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw Err.validation('Request validation failed', result.error.flatten());
  }
  return result.data;
}
