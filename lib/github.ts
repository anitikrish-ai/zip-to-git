import type { Entry } from './zip';

export class GhError extends Error {
  constructor(m: string, public status: number) { super(m); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function gh<T = any>(path: string, init: RequestInit = {}, tries = 3): Promise<T> {
  for (let a = 0; ; a++) {
    const r = await fetch('/api/gh/' + path, { ...init, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' });
    if (r.ok) return (await r.json()) as T;
    const limited = r.status === 429 || (r.status === 403 && (r.headers.get('retry-after') || r.headers.get('x-ratelimit-remaining') === '0'));
    if (limited && a < tries) {
      let w = Number(r.headers.get('retry-after')) * 1000;
      if (!w) { const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000; w = reset ? reset - Date.now() + 1000 : 30000; }
      if (w > 90000) throw new GhError(`GitHub rate limit reached. Try again in about ${Math.ceil(w / 60000)} min.`, r.status);
      await sleep(Math.max(w, 1000));
      continue;
    }
    if (r.status >= 500 && a < tries) { await sleep(1000 * 2 ** a); continue; }
    let m = r.statusText;
    try { m = (await r.json()).message || m; } catch {}
    throw new GhError(m, r.status);
  }
}

export async function gitSha(d: Uint8Array): Promise<string> {
  const h = new TextEncoder().encode(`blob ${d.length}\0`);
  const b = new Uint8Array(h.length + d.length);
  b.set(h); b.set(d, h.length);
  const x = await crypto.subtle.digest('SHA-1', b);
  return [...new Uint8Array(x)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function b64(d: Uint8Array) {
  let s = '';
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return btoa(s);
}

export type Plan = { added: Entry[]; changed: Entry[]; same: number; truncated: boolean };

/** Compares files against the tree of `source` branch so overwrites are shown before committing. */
export async function makePlan(owner: string, repo: string, source: string, files: Entry[]): Promise<Plan> {
  const R = `repos/${owner}/${repo}`;
  const ref = await gh<any>(`${R}/git/ref/heads/${source}`);
  const commit = await gh<any>(`${R}/git/commits/${ref.object.sha}`);
  const tree = await gh<any>(`${R}/git/trees/${commit.tree.sha}?recursive=1`);
  const map = new Map<string, string>();
  for (const t of tree.tree) if (t.type === 'blob') map.set(t.path, t.sha);
  const p: Plan = { added: [], changed: [], same: 0, truncated: !!tree.truncated };
  for (const f of files) {
    const old = map.get(f.path);
    if (!old) p.added.push(f);
    else if (old === (await gitSha(f.data))) p.same++;
    else p.changed.push(f);
  }
  return p;
}

export async function createRepo(name: string, priv: boolean) {
  return gh<any>('user/repos', { method: 'POST', body: JSON.stringify({ name, private: priv, auto_init: true, description: 'Uploaded with zip2gh' }) });
}

export async function commitFiles(o: {
  owner: string; repo: string; branch: string; baseBranch: string; files: Entry[]; message: string;
  onProgress: (done: number, total: number, label: string) => void;
}): Promise<{ commitUrl: string }> {
  const R = `repos/${o.owner}/${o.repo}`;
  let parent: string, create = false;
  try { parent = (await gh<any>(`${R}/git/ref/heads/${o.branch}`)).object.sha; }
  catch (e) {
    if (!(e instanceof GhError && e.status === 404)) throw e;
    parent = (await gh<any>(`${R}/git/ref/heads/${o.baseBranch}`)).object.sha; create = true;
  }
  const base = (await gh<any>(`${R}/git/commits/${parent}`)).tree.sha;

  const entries: { path: string; mode: string; type: string; sha: string }[] = [];
  let done = 0, i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < o.files.length) {
      const f = o.files[i++];
      const r = await gh<any>(`${R}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: b64(f.data), encoding: 'base64' }) });
      entries.push({ path: f.path, mode: '100644', type: 'blob', sha: r.sha });
      o.onProgress(++done, o.files.length, f.path);
    }
  }));
  o.onProgress(done, o.files.length, 'Creating commit…');
  const tree = await gh<any>(`${R}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: base, tree: entries }) });
  const c = await gh<any>(`${R}/git/commits`, { method: 'POST', body: JSON.stringify({ message: o.message, tree: tree.sha, parents: [parent] }) });
  try {
    if (create) await gh(`${R}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${o.branch}`, sha: c.sha }) });
    else await gh(`${R}/git/refs/heads/${o.branch}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha, force: false }) });
  } catch (e) {
    if (e instanceof GhError && e.status === 422)
      throw new GhError('The branch changed on GitHub while uploading (conflict). Nothing was overwritten. Review again and retry.', 422);
    throw e;
  }
  return { commitUrl: c.html_url };
}
