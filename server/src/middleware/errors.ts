import type { ErrorRequestHandler } from 'express';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error && typeof error === 'object' && 'type' in error && ['entity.parse.failed', 'entity.too.large'].includes(String(error.type))) {
    const tooLarge = error.type === 'entity.too.large';
    res.status(tooLarge ? 413 : 400).json({ error: { code: tooLarge ? 'ENTRY_TOO_LARGE' : 'INVALID_JSON', message: tooLarge ? 'This entry is too large to save.' : 'Entry data must be valid JSON.' } });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  // Never forward raw upstream errors, URLs, headers, or credentials to the browser.
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
  });
};
