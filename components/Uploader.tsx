'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GlassButton, GlassCard, GlassInput, GlassMenu, GlassSegmented, GlassSheet, GlassSwitch } from '@zakisheriff/liquid-glass';
import { GhError, createRepo, commitFiles, gh, makePlan, type Plan } from '@/lib/github';
import { LIMITS, commonRoot, readZip, type Entry, type Skipped } from '@/lib/zip';

type Repo = { name: string; full_name: string; owner: { login: string }; default_branch: string; private: boolean };
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^(?!\/|.*(\.\.|\/\/|@\{|\\))[A-Za-z0-9._\/-]{1,200}(?<![\/.])$/;
const mb = (n: number) => (n / 1048576).toFixed(1) + ' MB';

export default function Uploader() {
  const [user, setUser] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [authErr, setAuthErr] = useState('');
  const [raw, setRaw] = useState<Entry[]>([]);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [zipName, setZipName] = useState('');
  const [strip, setStrip] = useState(true);
  const [mode, setMode] = useState(0); // 0 = new repo, 1 = existing
  const [repos, setRepos] = useState<Repo[]>([]);
  const [filter, setFilter] = useState('');
  const [repo, setRepo] = useState<Repo | null>(null);
  const [newName, setNewName] = useState('');
  const [priv, setPriv] = useState(true);
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState('main');
  const [message, setMessage] = useState('Upload project from zip');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sheet, setSheet] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState('');
  const [prog, setProg] = useState({ done: 0, total: 0, label: '' });
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ repoUrl: string; commitUrl: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('error');
    if (q) setAuthErr('Sign-in failed. Please try again.');
    gh<{ login: string }>('user', {}, 0).then((u) => setUser(u.login)).catch(() => {}).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    gh<Repo[]>('user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member')
      .then(setRepos).catch((e) => setError(e.message));
  }, [user]);

  useEffect(() => {
    if (mode !== 1 || !repo) return;
    setBranches([]); setBranch(repo.default_branch);
    gh<{ name: string }[]>(`repos/${repo.owner.login}/${repo.name}/branches?per_page=100`)
      .then((b) => setBranches(b.map((x) => x.name))).catch((e) => setError(e.message));
  }, [mode, repo]);

  const root = useMemo(() => commonRoot(raw), [raw]);
  const files = useMemo<Entry[]>(
    () => (strip && root ? raw.map((e) => ({ path: e.path.slice(root.length + 1), data: e.data })) : raw),
    [raw, strip, root],
  );
  const total = files.reduce((n, f) => n + f.data.length, 0);
  const shown = repos.filter((r) => r.full_name.toLowerCase().includes(filter.toLowerCase())).slice(0, 8);

  async function onZip(f?: File) {
    if (!f) return;
    setError(''); setResult(null); setPlan(null); setRaw([]); setSkipped([]);
    if (!/\.zip$/i.test(f.name)) return setError('Please choose a .zip file.');
    if (f.size > LIMITS.maxZip) return setError(`Zip is larger than ${mb(LIMITS.maxZip)}.`);
    setBusy('Reading zip…');
    try {
      const r = readZip(new Uint8Array(await f.arrayBuffer()));
      if (!r.entries.length) throw new Error('No usable files found in the zip.');
      setRaw(r.entries); setSkipped(r.skipped); setZipName(f.name);
      if (!newName) setNewName(f.name.replace(/\.zip$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100));
    } catch (e: any) { setError(e.message || 'Could not read the zip.'); }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  }

  function validate(): string {
    if (!files.length) return 'Choose a zip first.';
    if (mode === 0 && !REPO_RE.test(newName)) return 'Repository name may use letters, numbers, ".", "-" and "_".';
    if (mode === 1 && !repo) return 'Select a repository.';
    if (!BRANCH_RE.test(branch)) return 'Branch name is not valid.';
    if (!message.trim()) return 'Enter a commit message.';
    return '';
  }

  async function review() {
    const v = validate(); if (v) return setError(v);
    setError(''); setOverwrite(false); setResult(null);
    if (mode === 0) { setPlan({ added: files, changed: [], same: 0, truncated: false }); return setSheet(true); }
    setBusy('Comparing with the repository…');
    try {
      const source = branches.includes(branch) ? branch : repo!.default_branch;
      setPlan(await makePlan(repo!.owner.login, repo!.name, source, files));
      setSheet(true);
    } catch (e: any) {
      setError(e instanceof GhError && e.status === 409 ? 'This repository is empty. Add a README on GitHub first, then retry.' : e.message);
    } finally { setBusy(''); }
  }

  async function upload() {
    if (!plan) return;
    setError(''); setBusy('Uploading…'); setProg({ done: 0, total: 0, label: '' });
    try {
      let owner = repo?.owner.login || '', name = repo?.name || '', base = repo?.default_branch || 'main', repoUrl = '';
      if (mode === 0) {
        setProg({ done: 0, total: 0, label: 'Creating repository…' });
        const r = await createRepo(newName, priv);
        owner = r.owner.login; name = r.name; base = r.default_branch; repoUrl = r.html_url;
      } else repoUrl = `https://github.com/${owner}/${name}`;
      const todo = [...plan.added, ...plan.changed];
      if (!todo.length) { setSheet(false); return setError('Nothing to commit: every file already matches the repository.'); }
      const { commitUrl } = await commitFiles({
        owner, repo: name, branch, baseBranch: base, files: todo, message: message.trim(),
        onProgress: (done, total, label) => setProg({ done, total, label }),
      });
      setSheet(false);
      setResult({ repoUrl: `${repoUrl}/tree/${branch}`, commitUrl });
    } catch (e: any) { setError(e.message || 'Upload failed.'); setSheet(false); }
    finally { setBusy(''); }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null); setRepos([]); setRepo(null); setRaw([]); setResult(null);
  }

  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  if (checking) return <main><p>Loading…</p></main>;
  if (!user) {
    return (
      <main>
        <h1>Zip to GitHub</h1>
        <GlassCard>
          <div className="stack">
            <h2>Sign in</h2>
            <p>Sign in with GitHub to upload a project zip to a repository. Your token stays on the server.</p>
            {authErr && <div className="err" role="alert">{authErr}</div>}
            <GlassButton variant="filled" size="lg" onClick={() => (location.href = '/api/auth/login')}>Sign in with GitHub</GlassButton>
          </div>
        </GlassCard>
      </main>
    );
  }

  return (
    <main>
      <div className="row">
        <h1>Zip to GitHub</h1>
        <GlassButton size="sm" variant="clear" onClick={logout} aria-label={`Sign out ${user}`}>Sign out ({user})</GlassButton>
      </div>

      <GlassCard>
        <div className="stack">
          <h2>1. Project zip</h2>
          <input ref={fileRef} type="file" accept=".zip,application/zip" onChange={(e) => onZip(e.target.files?.[0])} aria-label="Choose zip file" />
          <GlassButton variant="filled" onClick={() => fileRef.current?.click()} disabled={!!busy}>{raw.length ? 'Choose a different zip' : 'Choose zip'}</GlassButton>
          {raw.length > 0 && (
            <>
              <p>{zipName}: {files.length} files, {mb(total)}{skipped.length ? `, ${skipped.length} skipped` : ''}</p>
              {root && (
                <div className="row"><span>Remove top folder “{root}”</span><GlassSwitch checked={strip} onChange={setStrip} aria-label={`Remove top folder ${root}`} /></div>
              )}
              {skipped.length > 0 && <p className="err">Skipped: {skipped.slice(0, 3).map((s) => `${s.path} (${s.reason})`).join(', ')}{skipped.length > 3 ? '…' : ''}</p>}
            </>
          )}
        </div>
      </GlassCard>

      <GlassCard>
        <div className="stack">
          <h2>2. Destination</h2>
          <GlassSegmented options={['New repo', 'Existing repo']} value={mode} onChange={setMode} aria-label="Repository mode" />
          {mode === 0 ? (
            <>
              <GlassInput label="Repository name" value={newName} onChange={(e) => setNewName(e.target.value)} autoCapitalize="none" autoCorrect="off" />
              <div className="row"><span>Private repository</span><GlassSwitch checked={priv} onChange={setPriv} aria-label="Private repository" /></div>
            </>
          ) : (
            <>
              <GlassInput type="search" placeholder="Search your repositories" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search repositories" />
              <div className="pick">
                {shown.map((r) => (
                  <GlassButton key={r.full_name} size="sm" variant={repo?.full_name === r.full_name ? 'filled' : 'clear'} onClick={() => setRepo(r)}>
                    {r.full_name}{r.private ? ' 🔒' : ''}
                  </GlassButton>
                ))}
                {!shown.length && <p>No repositories found.</p>}
              </div>
            </>
          )}
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <div style={{ flex: 1 }}><GlassInput label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} autoCapitalize="none" autoCorrect="off" /></div>
            {mode === 1 && branches.length > 0 && (
              <GlassMenu icon={<span aria-hidden>▾</span>} aria-label="Pick an existing branch"
                items={branches.slice(0, 30).map((b) => ({ label: b, checked: b === branch, onSelect: () => setBranch(b) }))} />
            )}
          </div>
          {mode === 1 && repo && branch && !branches.includes(branch) && branches.length > 0 && <p>“{branch}” doesn’t exist yet and will be created from {repo.default_branch}.</p>}
        </div>
      </GlassCard>

      <GlassCard>
        <div className="stack">
          <h2>3. Commit</h2>
          <GlassInput label="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} />
          <GlassButton variant="filled" size="lg" onClick={review} disabled={!!busy}>{busy || 'Preview files'}</GlassButton>
          {busy && prog.label && (
            <div role="status" aria-live="polite">
              <div className="bar"><i style={{ width: `${pct}%` }} /></div>
              <p>{prog.total ? `${prog.done}/${prog.total} · ` : ''}{prog.label}</p>
            </div>
          )}
          {error && <div className="err" role="alert">{error}</div>}
          {result && (
            <div className="stack" role="status">
              <span className="ok">Committed successfully.</span>
              <a href={result.repoUrl} target="_blank" rel="noopener noreferrer">{result.repoUrl}</a>
              <a href={result.commitUrl} target="_blank" rel="noopener noreferrer">View commit</a>
            </div>
          )}
        </div>
      </GlassCard>

      <GlassSheet open={sheet} onClose={() => !busy && setSheet(false)} aria-label="Review files before uploading" detents={['medium', 'large']}>
        <div className="sheet">
          <h2>Review</h2>
          {plan && (
            <>
              <p>
                {mode === 0 ? `New repo “${newName}”` : repo?.full_name} · branch {branch}<br />
                {plan.added.length} new · {plan.changed.length} overwritten · {plan.same} unchanged (skipped)
              </p>
              {plan.truncated && <p className="err">The repository is very large; overwrite detection may be incomplete.</p>}
              <div className="list" tabIndex={0} aria-label="Files to upload">
                {plan.added.slice(0, 300).map((f) => <span key={f.path}>+ {f.path}</span>)}
                {plan.changed.slice(0, 300).map((f) => <span key={f.path} className="err">~ {f.path}</span>)}
                {plan.added.length + plan.changed.length > 600 && <span>…and more</span>}
              </div>
              {plan.changed.length > 0 && (
                <div className="row"><span>Overwrite {plan.changed.length} existing file(s)</span><GlassSwitch checked={overwrite} onChange={setOverwrite} aria-label="Allow overwriting existing files" /></div>
              )}
              {busy && (
                <div role="status"><div className="bar"><i style={{ width: `${pct}%` }} /></div><p>{prog.label}</p></div>
              )}
              <div className="row">
                <GlassButton variant="clear" onClick={() => setSheet(false)} disabled={!!busy}>Cancel</GlassButton>
                <GlassButton variant="filled" onClick={upload} disabled={!!busy || (plan.changed.length > 0 && !overwrite)}>
                  {busy ? 'Uploading…' : `Commit ${plan.added.length + plan.changed.length} files`}
                </GlassButton>
              </div>
            </>
          )}
        </div>
      </GlassSheet>
    </main>
  );
}
