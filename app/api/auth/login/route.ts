import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { STATE, cookieOpts } from '@/lib/session';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const id = process.env.GITHUB_CLIENT_ID;
  if (!id) return NextResponse.json({ error: 'OAuth is not configured on the server.' }, { status: 500 });
  const state = crypto.randomBytes(16).toString('hex');
  const base = process.env.APP_URL || new URL(req.url).origin;
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', id);
  u.searchParams.set('scope', 'repo');
  u.searchParams.set('state', state);
  u.searchParams.set('redirect_uri', `${base}/api/auth/callback`);
  const res = NextResponse.redirect(u);
  res.cookies.set(STATE, state, { ...cookieOpts, maxAge: 600 });
  return res;
}
