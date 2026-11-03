// Zip handling. The parser (and fflate) live in a lazily loaded chunk.
export const LIMITS = {
  maxZip: 100 * 1024 * 1024,   // compressed upload
  maxTotal: 150 * 1024 * 1024, // total extracted
  maxFiles: 3000,
  maxFile: 3 * 1024 * 1024,    // per file (server proxy body limit ~4.5MB incl. base64)
};
export type Entry = { path: string; data: Uint8Array };
export type Skipped = { path: string; reason: string };
type Result = { entries: Entry[]; skipped: Skipped[] };

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

// fflate is loaded on demand (not in the initial bundle) and prefetched at idle time.
const load = () => import('./zip-parse');
export function prefetchZip() { load().catch(() => {}); }
export function readZip(buf: Uint8Array): Promise<Result> { return load().then((m) => m.parseZip(buf)); }

/** Shared top-level folder name if every file lives under it. */
export function commonRoot(entries: Entry[]): string | null {
  if (entries.length < 2) return null;
  const first = entries[0].path.split('/');
  if (first.length < 2) return null;
  return entries.every((e) => e.path.startsWith(first[0] + '/')) ? first[0] : null;
}
