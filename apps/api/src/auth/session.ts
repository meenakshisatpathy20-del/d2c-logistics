import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';

export const SESSION_COOKIE = 'd2c_session';
export const SESSION_HOURS = 12;

let warned = false;
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.REQUIRE_SESSION_SECRET === 'true') throw new Error('SESSION_SECRET must be set (16+ characters)');
  if (!warned) {
    new Logger('Session').warn('SESSION_SECRET is not set; using a development secret. Set it in production.');
    warned = true;
  }
  return 'dev-only-session-secret-change-me';
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

/** A signed, expiring session token: <payload>.<signature>. */
export function createSessionToken(userId: string, now = new Date()): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, iat: now.getTime(), exp: now.getTime() + SESSION_HOURS * 3600_000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** The signed-in user and when the session started, or null if it is not valid. */
export function readSession(token: string | undefined, now = new Date()): { uid: string; iat: number } | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { uid, iat, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { uid: string; iat?: number; exp: number };
    return exp > now.getTime() && typeof uid === 'string' ? { uid, iat: iat ?? exp - SESSION_HOURS * 3600_000 } : null;
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function sessionCookie(token: string | null): string {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  const age = token ? SESSION_HOURS * 3600 : 0;
  return `${SESSION_COOKIE}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`;
}

export function readSessionToken(token: string | undefined, now = new Date()): string | null {
  return readSession(token, now)?.uid ?? null;
}
