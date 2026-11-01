import { unzip } from 'fflate';

export const LIMITS = {
  maxZip: 100 * 1024 * 1024,   // compressed upload
  maxTotal: 150 * 1024 * 1024, // total extracted
  maxFiles: 3000,
  maxFile: 3 * 1024 * 1024,    // per file (server proxy body limit ~4.5MB incl. base64)
};
export type Entry = { path: string; data: Uint8Array };
export type Skipped = { path: string; reason: string };

/** Returns a safe relative path, or null if the name is dangerous. */
export function cleanPath(raw: string): string | null {
  if (raw.includes('\0')) return null;
  const p = raw.replace(/\\/g, '/');
  if (/^([a-zA-Z]:|\/)/.test(p)) return null;
  const parts = p.split('/').filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..')) return null;
  if (parts.some((s) => s.toLowerCase() === '.git')) return null;
  return parts.length ? parts.join('/') : null;
}

export function readZip(buf: Uint8Array): Promise<{ entries: Entry[]; skipped: Skipped[] }> {
  return new Promise((resolve, reject) => { try { parse(buf, resolve, reject); } catch (e) { reject(e); } });
}

function parse(buf: Uint8Array, resolve: (v: { entries: Entry[]; skipped: Skipped[] }) => void, reject: (e: Error) => void) {
  const skipped: Skipped[] = [];
  const clean = new Map<string, string>();
  let count = 0, total = 0, unsafe: string | null = null;
  unzip(buf, {
    filter: (f) => {
      if (f.name.endsWith('/')) return false;
      if (/(^|\/)(__MACOSX\/|\.DS_Store$)/.test(f.name)) return false;
      const p = cleanPath(f.name);
      if (!p) { unsafe = unsafe || f.name; return false; }
      if (f.originalSize > LIMITS.maxFile) { skipped.push({ path: p, reason: 'Larger than 3 MB' }); return false; }
      if (++count > LIMITS.maxFiles) throw new Error(`Too many files (limit ${LIMITS.maxFiles}).`);
      total += f.originalSize;
      if (total > LIMITS.maxTotal) throw new Error('Archive expands beyond the size limit.');
      clean.set(f.name, p);
      return true;
    },
  }, (err, out) => {
  if (err) return reject(err);
  if (unsafe) return reject(new Error(`Unsafe path in zip ("${unsafe}"). Upload rejected.`));
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const [name, data] of Object.entries(out)) {
    const path = clean.get(name)!;
    if (data.length > LIMITS.maxFile) { skipped.push({ path, reason: 'Larger than 3 MB' }); continue; }
    if (seen.has(path)) { skipped.push({ path, reason: 'Duplicate path' }); continue; }
    seen.add(path);
    entries.push({ path, data });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  resolve({ entries, skipped });
  });
}

/** Shared top-level folder name if every file lives under it. */
export function commonRoot(entries: Entry[]): string | null {
  if (entries.length < 2) return null;
  const first = entries[0].path.split('/');
  if (first.length < 2) return null;
  return entries.every((e) => e.path.startsWith(first[0] + '/')) ? first[0] : null;
}
