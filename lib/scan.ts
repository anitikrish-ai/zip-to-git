import type { Entry } from './zip';

export type Finding = { path: string; reason: string };
const SAFE = /(^|\/)\.env\.(example|sample|template|dist)$/i;
const NAMES: [RegExp, string][] = [
  [/(^|\/)\.env(\.|$)/i, 'Environment file'],
  [/(^|\/)(id_rsa|id_ed25519|id_ecdsa)$/, 'SSH private key'],
  [/\.(pem|p12|pfx|key|keystore|jks)$/i, 'Key or certificate file'],
  [/(^|\/)(\.npmrc|\.netrc|credentials\.json|service-account[^/]*\.json)$/i, 'Credentials file'],
];
const BODY: [RegExp, string][] = [
  [/-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----/, 'Private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/\bsk-[A-Za-z0-9_-]{32,}\b/, 'API secret key'],
  [/(api[_-]?key|secret|token|passw(or)?d)["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i, 'Hard-coded secret'],
];

/** Flags likely secrets by filename and content. Text files up to 200 KB; yields to the UI as it goes. */
export async function scan(files: Entry[]): Promise<Finding[]> {
  const out: Finding[] = [];
  const dec = new TextDecoder();
  let t0 = performance.now();
  for (let i = 0; i < files.length && out.length < 100; i++) {
    const f = files[i];
    if (performance.now() - t0 > 12) { await new Promise((r) => setTimeout(r)); t0 = performance.now(); } // keep the UI responsive
    if (SAFE.test(f.path)) continue;
    const n = NAMES.find(([re]) => re.test(f.path));
    if (n) { out.push({ path: f.path, reason: n[1] }); continue; }
    if (f.data.length > 200_000 || f.data.subarray(0, 1000).includes(0)) continue;
    const text = dec.decode(f.data);
    const b = BODY.find(([re]) => re.test(text));
    if (b) out.push({ path: f.path, reason: b[1] });
  }
  return out;
}

export const groupOf = (p: string) => (p.split('/').includes('node_modules') ? 'node_modules' : p.includes('/') ? p.split('/')[0] : '(root files)');

export function groups(files: Entry[]) {
  const m = new Map<string, number>();
  for (const f of files) { const k = groupOf(f.path); m.set(k, (m.get(k) || 0) + 1); }
  return [...m].map(([key, count]) => ({ key, count }))
    .sort((a, b) => (a.key === 'node_modules' ? -1 : b.key === 'node_modules' ? 1 : b.count - a.count));
}

const LANG: Record<string, string> = { ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', py: 'Python', java: 'Java', kt: 'Kotlin', go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP', swift: 'Swift', c: 'C', cpp: 'C++', cs: 'C#', html: 'HTML', css: 'CSS', scss: 'CSS', md: 'Markdown', json: 'JSON', dart: 'Dart' };
export function topLangs(files: Entry[], n = 3): string[] {
  const m = new Map<string, number>();
  for (const f of files) { const e = f.path.split('.').pop()?.toLowerCase() || ''; const l = LANG[e]; if (l && !['Markdown', 'JSON'].includes(l)) m.set(l, (m.get(l) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([l]) => l);
}
