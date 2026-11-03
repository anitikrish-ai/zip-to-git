export type DiffLine = { t: ' ' | '+' | '-' | '…'; s: string };

/** Line diff (LCS) with common prefix/suffix trimmed. Returns null when a file is too long to diff inline. */
export function lineDiff(a: string, b: string, max = 1500): DiffLine[] | null {
  const A = a.split('\n'), B = b.split('\n');
  if (A.length > max || B.length > max) return null;
  let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0; while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const x = A.slice(s, A.length - e), y = B.slice(s, B.length - e), n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = A.slice(0, s).map((l) => ({ t: ' ', s: l }));
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ t: ' ', s: x[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: '-', s: x[i++] });
    else out.push({ t: '+', s: y[j++] });
  }
  while (i < n) out.push({ t: '-', s: x[i++] });
  while (j < m) out.push({ t: '+', s: y[j++] });
  return out.concat(A.slice(A.length - e).map((l) => ({ t: ' ' as const, s: l })));
}

/** Collapses long unchanged runs, keeping `ctx` lines of context around changes. */
export function compact(lines: DiffLine[], ctx = 2): DiffLine[] {
  const keep = lines.map((l) => l.t !== ' ');
  const near = keep.map((_, i) => { for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) if (keep[k]) return true; return false; });
  const out: DiffLine[] = []; let skipped = 0;
  lines.forEach((l, i) => {
    if (near[i]) { if (skipped) { out.push({ t: '…', s: `${skipped} unchanged line${skipped > 1 ? 's' : ''}` }); skipped = 0; } out.push(l); }
    else skipped++;
  });
  if (skipped) out.push({ t: '…', s: `${skipped} unchanged line${skipped > 1 ? 's' : ''}` });
  return out;
}
