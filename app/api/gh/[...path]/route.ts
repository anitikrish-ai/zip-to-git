import { NextResponse } from 'next/server';
import { getToken, sameOrigin } from '@/lib/session';
export const dynamic = 'force-dynamic';

// The token never leaves the server. Only these GitHub endpoints are reachable.
const S = '[A-Za-z0-9_.-]+';
const REF = '[A-Za-z0-9_./-]+';
const RULES: Record<string, RegExp[]> = {
  GET: [
    /^user$/, /^user\/repos$/,
    new RegExp(`^repos/${S}/${S}/branches$`),
    new RegExp(`^repos/${S}/${S}/git/ref/heads/${REF}$`),
    new RegExp(`^repos/${S}/${S}/git/(commits|trees)/[0-9a-f]{40}$`),
    new RegExp(`^repos/${S}/${S}/git/trees/${REF}$`),
  ],
  POST: [
    /^user\/repos$/,
    new RegExp(`^repos/${S}/${S}/git/(blobs|trees|commits|refs)$`),
  ],
  PATCH: [new RegExp(`^repos/${S}/${S}/git/refs/heads/${REF}$`)],
};

async function handle(req: Request, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/');
  const allowed = (RULES[req.method] || []).some((r) => r.test(path)) && !path.includes('..');
  if (!allowed) return NextResponse.json({ message: 'Not allowed' }, { status: 403 });
  if (req.method !== 'GET' && !sameOrigin(req)) return NextResponse.json({ message: 'Bad origin' }, { status: 403 });
  let token: string | null = null;
  try { token = getToken(); } catch { return NextResponse.json({ message: 'Server is not configured' }, { status: 500 }); }
  if (!token) return NextResponse.json({ message: 'Not signed in' }, { status: 401 });

  const q = new URL(req.url).search;
  const body = req.method === 'GET' ? undefined : await req.text();
  const r = await fetch(`https://api.github.com/${path}${q}`, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'zip2gh',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
  });
  const out = new NextResponse(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  for (const h of ['retry-after', 'x-ratelimit-remaining', 'x-ratelimit-reset'])
    { const v = r.headers.get(h); if (v) out.headers.set(h, v); }
  return out;
}
export { handle as GET, handle as POST, handle as PATCH };
