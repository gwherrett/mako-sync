/**
 * Helpers for reading caught values, which TypeScript types as `unknown`: anything can be
 * thrown, and library errors (Supabase, Spotify, fetch) are not all `Error` instances.
 */

/** The fields error handling reads from a caught value. Any of them can be missing. */
export interface ErrorFields {
  message?: string;
  name?: string;
  code?: string | number;
  status?: number;
  stack?: string;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Read the common error fields from a caught value, keeping only values of the expected type. */
export function errorFields(error: unknown): ErrorFields {
  if (typeof error !== 'object' || error === null) return {};
  const fields = error as Record<string, unknown>;
  const { code, status } = fields;
  return {
    message: stringField(fields.message),
    name: stringField(fields.name),
    code: typeof code === 'string' || typeof code === 'number' ? code : undefined,
    status: typeof status === 'number' ? status : undefined,
    stack: stringField(fields.stack),
  };
}

/**
 * The message of a caught value: the `message` of an Error or error-like object (Supabase
 * errors are plain objects in some versions), otherwise the value as a string.
 */
export function getErrorMessage(error: unknown): string {
  return errorFields(error).message ?? String(error);
}
