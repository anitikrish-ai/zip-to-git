import { NextResponse } from 'next/server';
import { COOKIE, sameOrigin } from '@/lib/session';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Bad origin' }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE);
  return res;
}
