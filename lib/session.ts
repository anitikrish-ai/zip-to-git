import crypto from 'crypto';
import { cookies } from 'next/headers';

export const COOKIE = 'zg_session';
export const STATE = 'zg_state';
export const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

function key(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters)');
  return crypto.createHash('sha256').update(s).digest();
}
export function seal(v: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}
export function unseal(s: string): string | null {
  try {
    const b = Buffer.from(s, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return null; }
}
export function getToken(): string | null {
  const c = cookies().get(COOKIE)?.value;
  return c ? unseal(c) : null;
}
export function sameOrigin(req: Request): boolean {
  const o = req.headers.get('origin');
  if (!o) return true;
  const base = process.env.APP_URL || new URL(req.url).origin;
  return o === base || o === new URL(req.url).origin;
}
