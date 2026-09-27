import type { ApiErrorResponse } from '@libra/shared/search';

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(path, { signal });
}

export function sendJson<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  return requestJson<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError('NETWORK_ERROR', 'Cannot reach Libra. Check that the server is running and try again.');
  }
  const data = await response.json().catch(() => null) as T | ApiErrorResponse | null;
  if (!response.ok || data === null) {
    const error = data && typeof data === 'object' && 'error' in data ? (data as ApiErrorResponse).error : null;
    throw new ApiError(error?.code ?? 'SERVER_ERROR', error?.message ?? 'The server could not complete your request. Please try again.');
  }
  return data as T;
}
