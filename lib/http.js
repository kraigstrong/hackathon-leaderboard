import { createHash, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

// Wraps a handler so thrown HttpErrors become JSON error responses.
export function handle(fn) {
  return async (request) => {
    try {
      return await fn(request, new URL(request.url));
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Internal server error' }, 500);
    }
  };
}

const sha256 = (s) => createHash('sha256').update(s).digest();

export function requireAdmin(request) {
  const expected = process.env.ADMIN_CODE;
  if (!expected) throw new HttpError(503, 'ADMIN_CODE is not configured on the server');
  const given = request.headers.get('x-admin-code') ?? '';
  // Hashing first makes both sides equal length, so the compare is constant-time.
  if (!timingSafeEqual(sha256(given), sha256(expected))) {
    throw new HttpError(401, 'Invalid admin code');
  }
}
