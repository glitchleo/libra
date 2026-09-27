import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import express, { Router, type Request } from 'express';
import { HttpError } from './errors.js';

export interface AccessOptions { password?: string; secure?: boolean; backupMaxBytes?: number }
const maxAge = 30 * 24 * 60 * 60;
const cookieName = 'libra_session';
const digest = (value: string) => createHash('sha256').update(value).digest();

export function createAccess(options: AccessOptions) {
  const password = options.password ?? '';
  const sign = (value: string) => createHmac('sha256', password).update('libra-session-v1:' + value).digest('base64url');
  const authenticated = (req: Request) => {
    if (!password) return true;
    const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!cookie || cookie.length > 200) return false;
    const [expires, signature, extra] = cookie.split('.');
    const time = Number(expires);
    return !extra && !!signature && /^\d+$/.test(expires) && time > Date.now() && time <= Date.now() + maxAge * 1000 && timingSafeEqual(digest(signature), digest(sign(expires)));
  };
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/', (req, res) => res.json({ required: !!password, authenticated: authenticated(req), backupMaxBytes: options.backupMaxBytes }));
  router.use((req, _res, next) => {
    if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `${options.secure ? 'https' : req.protocol}://${req.get('host')}`)) {
      throw new HttpError(403, 'CROSS_SITE_WRITE', 'Open Libra directly to sign in.');
    }
    if (!req.is('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'Send sign-in data as JSON.');
    next();
  }, express.json({ limit: '2kb' }));
  // Bound password attempts per warm instance; the long passphrase is the single-user credential.
  let failures = 0; let resetAt = Date.now() + 60_000;
  router.post('/login', (req, res) => {
    if (Date.now() > resetAt) { failures = 0; resetAt = Date.now() + 60_000; }
    if (failures >= 10) { res.setHeader('Retry-After', '60'); throw new HttpError(429, 'LOGIN_LIMIT', 'Wait a minute before trying again.'); }
    if (password && (typeof req.body?.password !== 'string' || !timingSafeEqual(digest(req.body.password), digest(password)))) {
      failures++; throw new HttpError(401, 'INVALID_PASSWORD', 'That password is incorrect.');
    }
    const expires = String(Date.now() + maxAge * 1000);
    res.cookie(cookieName, expires + '.' + sign(expires), { httpOnly: true, secure: !!options.secure, sameSite: 'strict', path: '/', maxAge: maxAge * 1000 });
    res.json({ authenticated: true });
  });
  router.post('/logout', (_req, res) => {
    res.clearCookie(cookieName, { httpOnly: true, secure: !!options.secure, sameSite: 'strict', path: '/' });
    res.json({ authenticated: false });
  });
  return { router, authenticated };
}
