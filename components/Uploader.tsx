'use client';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { GlassButton, GlassCard, GlassInput, GlassMenu, GlassNav, GlassSegmented, GlassSheet, GlassSwitch, haptic } from '@zakisheriff/liquid-glass';
import { SettingsSheet, Wallpaper, useAppearance } from './Settings';
import { CheckIcon, ChevronIcon, CommitIcon, FolderIcon, GearIcon, GitHubIcon, ShieldIcon, UploadIcon } from './icons';
import { GhError, createPR, createRepo, commitFiles, gh, makePlan, type Plan } from '@/lib/github';
import { LIMITS, cleanPath, commonRoot, readZip, prefetchZip, type Entry, type Skipped } from '@/lib/zip';
import { groupOf, groups, scan, topLangs, type Finding } from '@/lib/scan';

type Hist = { at: number; repo: string; branch: string; count: number; message: string; repoUrl: string; commitUrl: string; prUrl?: string };
type Preset = { repo: string; branch: string; message: string };
type Repo = { name: string; full_name: string; owner: { login: string }; default_branch: string; private: boolean };
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^(?!\/|.*(\.\.|\/\/|@\{|\\))[A-Za-z0-9._\/-]{1,200}(?<![\/.])$/;
const mb = (n: number) => (n / 1048576).toFixed(1) + ' MB';


const NAV = [
  { label: 'Zip', icon: <UploadIcon /> },
  { label: 'Repo', icon: <FolderIcon /> },
  { label: 'Commit', icon: <CommitIcon /> },
];
const Steps = memo(function Steps({ tab, onChange }: { tab: number; onChange: (n: number) => void }) {
  return <div className="navwrap"><GlassNav items={NAV} activeIndex={tab} onChange={onChange} aria-label="Steps" /></div>;
});
const Header = memo(function Header({ avatar, user, onSettings }: { avatar: string; user: string | null; onSettings: () => void }) {
  return (
    <GlassCard padding="10px 14px" radius="24px">
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <div className="brand">
          {avatar ? <img className="avatar" decoding="async" src={avatar} alt="" width={30} height={30} /> : <GitHubIcon size={28} />}
          <div><h1>Zip to GitHub</h1>{user && <small>@{user}</small>}</div>
        </div>
        <GlassButton variant="clear" size="md" icon={<GearIcon />} onClick={onSettings} aria-label="Settings" />
      </div>
    </GlassCard>
  );
});
const FileList = memo(function FileList({ files }: { files: Entry[] }) {
  return <div className="list" tabIndex={0} aria-label="First files in the zip">{files.slice(0, 8).map((f) => <span key={f.path}>{f.path}</span>)}{files.length > 8 && <span>…and {files.length - 8} more</span>}</div>;
});
const PlanList = memo(function PlanList({ plan }: { plan: Plan }) {
  return (
    <div className="list" tabIndex={0} aria-label="Files to upload">
      {plan.added.slice(0, 300).map((f) => <span key={f.path}>+ {f.path}</span>)}
      {plan.changed.slice(0, 300).map((f) => <span key={f.path} className="err">~ {f.path}</span>)}
      {plan.added.length + plan.changed.length > 600 && <span>…and more</span>}
    </div>
  );
});

export default function Uploader() {
  const [user, setUser] = useState<string | null>(null);
  const [avatar, setAvatar] = useState('');
  const [tab, setTab] = useState(0);
  const [settings, setSettings] = useState(false);
  const [over, setOver] = useState(false);
  const ap = useAppearance();
  const [, startT] = useTransition();
  const tabRef = useRef(0), dir = useRef(1);
  const goTab = useCallback((n: number) => {
    dir.current = n >= tabRef.current ? 1 : -1; tabRef.current = n;
    startT(() => setTab(n));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    haptic();
  }, []);
  const openSettings = useCallback(() => setSettings(true), []);
  const closeSettings = useCallback(() => setSettings(false), []);
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
  const [result, setResult] = useState<{ repoUrl: string; commitUrl: string; prUrl?: string; dry?: boolean; count?: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const pendingBranch = useRef('');
  const [off, setOff] = useState<Set<string>>(new Set());
  const [exFiles, setExFiles] = useState<Set<string>>(new Set());
  const [findings, setFindings] = useState<Finding[]>([]);
  const [ack, setAck] = useState(false);
  const [pr, setPr] = useState(false);
  const [dry, setDry] = useState(false);
  const [ownerSel, setOwnerSel] = useState('');
  const [history, setHistory] = useState<Hist[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [histSheet, setHistSheet] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const notify = useCallback((msg: string, err = false) => setToast({ msg, err }), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3800); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem('zg_history') || '[]')); setPresets(JSON.parse(localStorage.getItem('zg_presets') || '[]')); } catch {}
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('error');
    if (q) setAuthErr('Sign-in failed. Please try again.');
    try { const c = sessionStorage.getItem('zg_repos'); if (c) setRepos(JSON.parse(c)); } catch {}
    gh<Repo[]>('user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', {}, 0)
      .then((r) => { setRepos(r); try { sessionStorage.setItem('zg_repos', JSON.stringify(r.map((x) => ({ name: x.name, full_name: x.full_name, owner: { login: x.owner.login }, default_branch: x.default_branch, private: x.private })))); } catch {} })
      .catch((e) => { if (!(e instanceof GhError && e.status === 401)) setError(e.message); });
    gh<{ login: string; avatar_url: string }>('user', {}, 0).then((u) => { setUser(u.login); setAvatar(u.avatar_url + (u.avatar_url.includes('?') ? '&' : '?') + 's=90'); (window.requestIdleCallback || setTimeout)(prefetchZip); }).catch(() => { try { sessionStorage.removeItem('zg_repos'); } catch {} setRepos([]); }).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (mode !== 1 || !repo) return;
    setBranches([]); setBranch(pendingBranch.current || repo.default_branch); pendingBranch.current = '';
    gh<{ name: string }[]>(`repos/${repo.owner.login}/${repo.name}/branches?per_page=100`)
      .then((b) => setBranches(b.map((x) => x.name))).catch((e) => setError(e.message));
  }, [mode, repo]);

  const root = useMemo(() => commonRoot(raw), [raw]);
  const stripped = useMemo<Entry[]>(
    () => (strip && root ? raw.map((e) => ({ path: e.path.slice(root.length + 1), data: e.data })) : raw),
    [raw, strip, root],
  );
  const groupsList = useMemo(() => groups(stripped), [stripped]);
  const files = useMemo(() => stripped.filter((f) => !off.has(groupOf(f.path)) && !exFiles.has(f.path)), [stripped, off, exFiles]);
  const langs = useMemo(() => topLangs(files), [files]);
  const owners = useMemo(() => [...new Set(repos.map((r) => r.owner.login))], [repos]);
  const total = useMemo(() => files.reduce((n, f) => n + f.data.length, 0), [files]);
  const dFilter = useDeferredValue(filter);
  const shown = useMemo(() => repos.filter((r) => (!ownerSel || r.owner.login === ownerSel) && r.full_name.toLowerCase().includes(dFilter.toLowerCase())).slice(0, 8), [repos, dFilter, ownerSel]);

  async function onFiles(list: FileList | File[] | null, folder = false) {
    const items = Array.from(list || []); if (!items.length) return;
    setError(''); setResult(null); setPlan(null); setRaw([]); setSkipped([]); setBusy(folder ? 'Reading folder…' : 'Reading zip…');
    try {
      const map = new Map<string, Entry>(); const sk: Skipped[] = []; let total = 0;
      if (folder) {
        for (const f of items) {
          const p = cleanPath((f as any).webkitRelativePath || f.name);
          if (!p) { sk.push({ path: f.name, reason: 'Unsafe or .git path' }); continue; }
          if (f.size > LIMITS.maxFile) { sk.push({ path: p, reason: 'Larger than 3 MB' }); continue; }
          if (map.size >= LIMITS.maxFiles || (total += f.size) > LIMITS.maxTotal) throw new Error('Folder is too large.');
          map.set(p, { path: p, data: new Uint8Array(await f.arrayBuffer()) });
        }
      } else {
        for (const f of items) {
          if (!/\.zip$/i.test(f.name)) throw new Error('Please choose .zip files only.');
          if (f.size > LIMITS.maxZip) throw new Error(`${f.name} is larger than ${mb(LIMITS.maxZip)}.`);
          const r = await readZip(new Uint8Array(await f.arrayBuffer()));
          r.entries.forEach((e) => map.set(e.path, e)); sk.push(...r.skipped);
        }
      }
      const entries = [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
      if (!entries.length) throw new Error('No usable files found.');
      const name = folder ? (((items[0] as any).webkitRelativePath || '').split('/')[0] || 'folder') : items.length > 1 ? `${items.length} zips merged` : items[0].name;
      setRaw(entries); setSkipped(sk); setZipName(name); setExFiles(new Set());
      setOff(new Set(entries.some((e) => e.path.split('/').includes('node_modules')) ? ['node_modules'] : []));
      if (!newName) setNewName(name.replace(/\.zip$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100));
    } catch (e: any) { setError(e.message || 'Could not read the files.'); notify(e.message || 'Could not read the files.', true); }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; if (dirRef.current) dirRef.current.value = ''; }
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
    setError(''); setOverwrite(false); setAck(false); setResult(null); setBusy('Scanning for secrets…');
    try {
      setFindings(await scan(files));
      if (mode === 0) setPlan({ added: files, changed: [], same: 0, truncated: false });
      else {
        setBusy('Comparing with the repository…');
        const source = branches.includes(branch) ? branch : repo!.default_branch;
        setPlan(await makePlan(repo!.owner.login, repo!.name, source, files));
      }
      setSheet(true);
    } catch (e: any) {
      const m = e instanceof GhError && e.status === 409 ? 'This repository is empty. Add a README on GitHub first, then retry.' : e.message;
      setError(m); notify(m, true);
    } finally { setBusy(''); }
  }

  async function upload() {
    if (!plan) return;
    const todo = [...plan.added, ...plan.changed];
    if (!todo.length) { setSheet(false); return setError('Nothing to commit: every file already matches the repository.'); }
    cancelRef.current = false; setError(''); setBusy(dry ? 'Dry run…' : 'Uploading…'); setProg({ done: 0, total: todo.length, label: '' });
    try {
      if (dry) {
        const steps = Math.min(todo.length, 20);
        for (let i = 1; i <= steps; i++) {
          if (cancelRef.current) throw new Error('Cancelled.');
          setProg({ done: Math.round((i * todo.length) / steps), total: todo.length, label: 'Dry run: nothing is written' });
          await new Promise((r) => setTimeout(r, 60));
        }
        setSheet(false); setResult({ repoUrl: '', commitUrl: '', dry: true, count: todo.length });
        return notify(`Dry run passed: ${todo.length} files would be committed.`);
      }
      let owner = repo?.owner.login || '', name = repo?.name || '', base = repo?.default_branch || 'main', repoUrl = '';
      if (mode === 0) {
        setProg({ done: 0, total: 0, label: 'Creating repository…' });
        const r = await createRepo(newName, priv);
        owner = r.owner.login; name = r.name; base = r.default_branch; repoUrl = r.html_url;
      } else repoUrl = `https://github.com/${owner}/${name}`;
      const usePr = pr && mode === 1;
      const from = usePr && branches.includes(branch) ? branch : base;
      const head = usePr ? `zip2gh/${Date.now().toString(36)}` : branch;
      let raf = 0, last = { done: 0, total: 0, label: '' };
      const { commitUrl } = await commitFiles({
        owner, repo: name, branch: head, baseBranch: from, files: todo, message: message.trim(),
        shouldCancel: () => cancelRef.current,
        onProgress: (done, total, label) => {
          last = { done, total, label };
          if (!raf) raf = requestAnimationFrame(() => { raf = 0; setProg(last); });
        },
      });
      let prUrl: string | undefined;
      if (usePr) prUrl = (await createPR(owner, name, { title: message.trim().split('\n')[0].slice(0, 200), head, base: from, body: 'Uploaded with zip2gh' })).html_url;
      const res = { repoUrl: `${repoUrl}/tree/${head}`, commitUrl, prUrl };
      setSheet(false); haptic(); setResult(res); notify(usePr ? 'Pull request opened.' : 'Committed to GitHub.');
      const h: Hist = { at: Date.now(), repo: `${owner}/${name}`, branch: head, count: todo.length, message: message.trim().slice(0, 120), ...res };
      setHistory((x) => { const n = [h, ...x].slice(0, 30); try { localStorage.setItem('zg_history', JSON.stringify(n)); } catch {} return n; });
    } catch (e: any) { setError(e.message || 'Upload failed.'); notify(e.message || 'Upload failed.', true); setSheet(false); }
    finally { setBusy(''); }
  }

  const excludeFlagged = () => {
    setExFiles(new Set(findings.map((f) => f.path))); setSheet(false);
    notify(`${findings.length} flagged file(s) excluded. Tap Preview again.`);
  };
  const savePreset = () => {
    if (mode !== 1 || !repo) return notify('Pick an existing repository first.', true);
    const p: Preset = { repo: repo.full_name, branch, message };
    setPresets((x) => { const n = [p, ...x.filter((y) => !(y.repo === p.repo && y.branch === p.branch))].slice(0, 5); try { localStorage.setItem('zg_presets', JSON.stringify(n)); } catch {} return n; });
    notify('Preset saved.');
  };
  const applyPreset = (p: Preset) => {
    const r = repos.find((x) => x.full_name === p.repo); if (!r) return notify('That repository is not in your list.', true);
    pendingBranch.current = p.branch; setMode(1); setRepo(r); setBranch(p.branch); setMessage(p.message); goTab(2); notify('Preset applied.');
  };
  const suggest = `Add ${zipName.replace(/\.zip$/i, '') || 'project'} (${files.length} files${langs[0] ? ', mostly ' + langs[0] : ''})`;
  const exportHistory = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' }));
    a.download = 'zip2gh-history.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setSettings(false); setUser(null); setRepos([]); tabRef.current = 0; setTab(0);
    try { sessionStorage.removeItem('zg_repos'); } catch {} setRepo(null); setRaw([]); setResult(null);
  }, []);

  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const dest = mode === 0 ? (newName || '—') : (repo?.full_name || '—');
  const header = <Header avatar={avatar} user={user} onSettings={openSettings} />;
  const shell = (body: React.ReactNode) => (
    <>
      <Wallpaper a={ap.a} img={ap.img} />
      <main>{header}{body}</main>
      <SettingsSheet open={settings} onClose={closeSettings} ap={ap} user={user} onSignOut={logout} />
    </>
  );

  if (checking) return shell(<GlassCard><div className="stack" role="status" aria-busy="true" aria-label="Loading"><div className="skel" style={{ width: '55%' }} /><div className="skel" /><div className="skel" style={{ width: '80%' }} /></div></GlassCard>);
  if (!user) {
    return shell(
      <GlassCard padding="28px 22px">
        <div className="hero">
          <GitHubIcon size={56} />
          <h2>Ship a zip to GitHub</h2>
          <p>Upload a project zip, preview every file, and commit the full folder structure in one go.</p>
          <div className="feat">
            <span><UploadIcon size={18} /> Works from phone or desktop</span>
            <span><FolderIcon /> Keeps nested folders and filenames</span>
            <span><ShieldIcon /> Your token stays on the server</span>
          </div>
          {authErr && <div className="err" role="alert">{authErr}</div>}
          <GlassButton variant="filled" size="lg" onClick={() => (location.href = '/api/auth/login')}>
            <span className="btn"><GitHubIcon size={18} /> Sign in with GitHub</span>
          </GlassButton>
        </div>
      </GlassCard>,
    );
  }

  return (
    <>
      <Wallpaper a={ap.a} img={ap.img} />
      <main>
        {header}

        <div key={tab} className={'step ' + (dir.current > 0 ? 'fwd' : 'back')}>
        {tab === 0 && (
          <GlassCard>
            <div className="stack">
              <h2>Project zip</h2>
              <input ref={fileRef} type="file" accept=".zip,application/zip" multiple hidden onChange={(e) => onFiles(e.target.files)} aria-label="Choose zip files" />
              <input ref={dirRef} type="file" multiple hidden {...({ webkitdirectory: '' } as any)} onChange={(e) => onFiles(e.target.files, true)} aria-label="Choose a folder" />
              <div className={'drop' + (over ? ' over' : '')} role="button" tabIndex={0} aria-label="Choose or drop a zip file"
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}>
                <UploadIcon size={30} />
                <strong>{busy || (raw.length ? zipName : 'Choose or drop a .zip')}</strong>
                <p>{raw.length ? 'Tap to pick a different zip' : `Up to ${mb(LIMITS.maxZip)}, files up to 3 MB each`}</p>
              </div>
              <GlassButton variant="clear" onClick={() => dirRef.current?.click()} disabled={!!busy}><span className="btn"><FolderIcon /> Choose a folder instead</span></GlassButton>
              {error && tab === 0 && <div className="err" role="alert">{error}</div>}
              {raw.length > 0 && (
                <>
                  <div className="chips"><span className="chip">{files.length} files</span><span className="chip">{mb(total)}</span>{langs.map((l) => <span className="chip" key={l}>{l}</span>)}{skipped.length > 0 && <span className="chip">{skipped.length} skipped</span>}</div>
                  {root && <div className="row"><span>Remove top folder “{root}”</span><GlassSwitch checked={strip} onChange={setStrip} aria-label={`Remove top folder ${root}`} /></div>}
                  {skipped.length > 0 && <p className="err">Skipped: {skipped.slice(0, 3).map((s) => `${s.path} (${s.reason})`).join(', ')}{skipped.length > 3 ? '…' : ''}</p>}
                  {groupsList.length > 1 && (
                    <div className="stack" role="group" aria-label="Folders to include">
                      <h3>Include folders</h3>
                      {groupsList.slice(0, 10).map((g) => (
                        <div className="row" key={g.key}>
                          <span>{g.key} <small>· {g.count} files</small></span>
                          <GlassSwitch checked={!off.has(g.key)} onChange={(on) => setOff((s) => { const n = new Set(s); if (on) n.delete(g.key); else n.add(g.key); return n; })} aria-label={`Include ${g.key}`} />
                        </div>
                      ))}
                      {groupsList.length > 10 && <p>…and {groupsList.length - 10} smaller folders (always included).</p>}
                    </div>
                  )}
                  <FileList files={files} />
                  <GlassButton variant="filled" size="lg" onClick={() => goTab(1)}>Next: choose repository</GlassButton>
                </>
              )}
            </div>
          </GlassCard>
        )}

        {tab === 1 && (
          <GlassCard>
            <div className="stack">
              <h2>Destination</h2>
              {presets.length > 0 && <div className="chips" role="group" aria-label="Saved presets">{presets.map((p) => <button key={p.repo + p.branch} className="chip chipbtn" onClick={() => applyPreset(p)}>{p.repo} · {p.branch}</button>)}</div>}
              <GlassSegmented options={['New repo', 'Existing repo']} value={mode} onChange={setMode} aria-label="Repository mode" />
              {mode === 0 ? (
                <>
                  <GlassInput label="Repository name" value={newName} onChange={(e) => setNewName(e.target.value)} autoCapitalize="none" autoCorrect="off" />
                  <div className="row"><span>Private repository</span><GlassSwitch checked={priv} onChange={setPriv} aria-label="Private repository" /></div>
                </>
              ) : (
                <>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <div style={{ flex: 1 }}><GlassInput type="search" placeholder={`Search ${ownerSel || 'all owners'}`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search repositories" /></div>
                    {owners.length > 1 && <GlassMenu icon={<ChevronIcon />} aria-label="Filter by owner or organization"
                      items={[{ label: 'All owners', checked: !ownerSel, onSelect: () => setOwnerSel('') }, ...owners.slice(0, 20).map((o) => ({ label: o, checked: o === ownerSel, onSelect: () => setOwnerSel(o) }))]} />}
                  </div>
                  <div className="pick">
                    {shown.map((r) => (
                      <GlassButton key={r.full_name} size="sm" variant={repo?.full_name === r.full_name ? 'filled' : 'clear'} onClick={() => setRepo(r)}>
                        <span className="btn"><GitHubIcon size={14} /> {r.full_name}{r.private ? ' 🔒' : ''}</span>
                      </GlassButton>
                    ))}
                    {!shown.length && <p>No repositories found.</p>}
                  </div>
                </>
              )}
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <div style={{ flex: 1 }}><GlassInput label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} autoCapitalize="none" autoCorrect="off" /></div>
                {mode === 1 && branches.length > 0 && (
                  <GlassMenu icon={<ChevronIcon />} aria-label="Pick an existing branch"
                    items={branches.slice(0, 30).map((b) => ({ label: b, checked: b === branch, onSelect: () => setBranch(b) }))} />
                )}
              </div>
              {mode === 1 && repo && branch && branches.length > 0 && !branches.includes(branch) && <p>“{branch}” doesn’t exist yet and will be created from {repo.default_branch}.</p>}
              <GlassButton variant="filled" size="lg" onClick={() => goTab(2)}>Next: commit</GlassButton>
            </div>
          </GlassCard>
        )}

        {tab === 2 && (
          <GlassCard>
            <div className="stack">
              <h2>Commit</h2>
              <dl className="kv">
                <dt>Files</dt><dd>{files.length ? `${files.length} (${mb(total)})` : '—'}</dd>
                <dt>Repository</dt><dd>{dest}</dd>
                <dt>Branch</dt><dd>{branch}</dd>
              </dl>
              <GlassInput label="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} />
              <div className="chips">
                <button className="chip chipbtn" onClick={() => setMessage(suggest)}>Suggest message</button>
                <button className="chip chipbtn" onClick={savePreset}>Save preset</button>
                <button className="chip chipbtn" onClick={() => setHistSheet(true)}>History ({history.length})</button>
              </div>
              {mode === 1 && <div className="row"><span>Open a pull request instead</span><GlassSwitch checked={pr} onChange={setPr} aria-label="Open a pull request instead of committing directly" /></div>}
              <div className="row"><span>Dry run (write nothing)</span><GlassSwitch checked={dry} onChange={setDry} aria-label="Dry run" /></div>
              <GlassButton variant="filled" size="lg" onClick={review} disabled={!!busy}>
                <span className="btn"><CommitIcon /> {busy || 'Preview and commit'}</span>
              </GlassButton>
              {busy && prog.label && (
                <div role="status" aria-live="polite">
                  <div className="bar"><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
                  <p>{prog.total ? `${prog.done}/${prog.total} · ` : ''}{prog.label}</p>
                </div>
              )}
              {error && <div className="err" role="alert">{error}</div>}
              {result && (
                <div className="stack" role="status">
                  {result.dry ? <span className="ok"><CheckIcon /> Dry run passed: {result.count} files would be committed</span> : (
                    <>
                      <span className="ok"><CheckIcon /> {result.prUrl ? 'Pull request opened' : 'Committed successfully'}</span>
                      {result.prUrl && <a href={result.prUrl} target="_blank" rel="noopener noreferrer">Open pull request</a>}
                      <a href={result.repoUrl} target="_blank" rel="noopener noreferrer">{result.repoUrl}</a>
                      <a href={result.commitUrl} target="_blank" rel="noopener noreferrer">View commit</a>
                    </>
                  )}
                </div>
              )}
            </div>
          </GlassCard>
        )}
        </div>
      </main>

      <Steps tab={tab} onChange={goTab} />

      <GlassSheet open={sheet} onClose={() => !busy && setSheet(false)} aria-label="Review files before uploading" detents={['medium', 'large']}>
        <div className="sheet">
          <h2>Review</h2>
          {plan && (
            <>
              <p>{mode === 0 ? `New repo “${newName}”` : repo?.full_name} · branch {branch}</p>
              <div className="chips"><span className="chip">{plan.added.length} new</span><span className="chip">{plan.changed.length} overwritten</span><span className="chip">{plan.same} unchanged</span></div>
              {plan.truncated && <p className="err">The repository is very large; overwrite detection may be incomplete.</p>}
              <PlanList plan={plan} />
              {findings.length > 0 && (
                <div className="stack warn" role="alert">
                  <strong>{findings.length} possible secret{findings.length > 1 ? 's' : ''} found</strong>
                  <div className="list">{findings.slice(0, 6).map((f) => <span key={f.path + f.reason}>{f.reason}: {f.path}</span>)}{findings.length > 6 && <span>…and {findings.length - 6} more</span>}</div>
                  <div className="row">
                    <GlassButton size="sm" variant="clear" onClick={excludeFlagged}>Exclude flagged files</GlassButton>
                    <span className="btn">Upload anyway <GlassSwitch checked={ack} onChange={setAck} aria-label="Upload flagged files anyway" /></span>
                  </div>
                </div>
              )}
              {plan.changed.length > 0 && (
                <div className="row"><span>Overwrite {plan.changed.length} existing file(s)</span><GlassSwitch checked={overwrite} onChange={setOverwrite} aria-label="Allow overwriting existing files" /></div>
              )}
              {busy && <div role="status"><div className="bar"><i style={{ transform: `scaleX(${pct / 100})` }} /></div><p>{prog.label}</p></div>}
              <div className="row">
                <GlassButton variant="clear" onClick={() => { if (busy) cancelRef.current = true; else setSheet(false); }}>{busy ? 'Cancel upload' : 'Cancel'}</GlassButton>
                <GlassButton variant="filled" onClick={upload} disabled={!!busy || (plan.changed.length > 0 && !overwrite) || (findings.length > 0 && !ack)}>
                  {busy ? (dry ? 'Dry run…' : 'Uploading…') : `${dry ? 'Dry run' : 'Commit'} ${plan.added.length + plan.changed.length} files`}
                </GlassButton>
              </div>
            </>
          )}
        </div>
      </GlassSheet>
      <GlassSheet open={histSheet} onClose={() => setHistSheet(false)} aria-label="Upload history" detents={['medium', 'large']}>
        <div className="sheet">
          <h2>History</h2>
          {!history.length && <p>No uploads yet.</p>}
          <div className="stack">{history.map((h) => (
            <div key={h.at} className="stack hist">
              <a href={h.prUrl || h.repoUrl} target="_blank" rel="noopener noreferrer">{h.repo} @ {h.branch}</a>
              <p>{new Date(h.at).toLocaleString()} · {h.count} files · {h.message}</p>
            </div>
          ))}</div>
          <div className="row">
            <GlassButton variant="clear" onClick={exportHistory} disabled={!history.length}>Export JSON</GlassButton>
            <GlassButton variant="clear" onClick={() => { setHistory([]); try { localStorage.removeItem('zg_history'); } catch {} }} disabled={!history.length}>Clear</GlassButton>
          </div>
        </div>
      </GlassSheet>
      {toast && <div className="toastwrap" key={toast.msg}><GlassCard padding="12px 16px" radius="20px"><span role="status" className={toast.err ? 'err' : ''}>{toast.msg}</span></GlassCard></div>}
      <SettingsSheet open={settings} onClose={closeSettings} ap={ap} user={user} onSignOut={logout} />
    </>
  );
}
