import { unzip } from 'fflate';
import { LIMITS, cleanPath, type Entry, type Skipped } from './zip';

/** Same behaviour as the original: fflate's async unzip, with path-safety and size/count limits. */
export function parseZip(buf: Uint8Array): Promise<{ entries: Entry[]; skipped: Skipped[] }> {
  return new Promise((resolve, reject) => {
    try {
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
    } catch (e) { reject(e); }
  });
}
