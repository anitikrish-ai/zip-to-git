import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { COOKIE, STATE, cookieOpts, seal } from '@/lib/session';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = process.env.APP_URL || url.origin;
  const fail = (e: string) => NextResponse.redirect(`${base}/?error=${e}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const saved = cookies().get(STATE)?.value;
  if (!code || !state || !saved) return fail('state');
  const a = Buffer.from(state), b = Buffer.from(saved);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail('state');

  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${base}/api/auth/callback`,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) return fail('token');
  const res = NextResponse.redirect(`${base}/`);
  res.cookies.set(COOKIE, seal(j.access_token), { ...cookieOpts, maxAge: 60 * 60 * 8 });
  res.cookies.delete(STATE);
  return res;
}
