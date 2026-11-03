'use client';
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { GlassButton, GlassSegmented, GlassSheet, GlassSlider, setGlassQuality, type GlassQuality } from '@zakisheriff/liquid-glass';
import { DEFAULT_WALLPAPER, WALLPAPERS } from '@/lib/wallpapers';
import { UploadIcon } from './icons';

export type Appearance = { wall: string; dim: number; theme: number; quality: number }; // theme: 0 auto, 1 light, 2 dark
const KEY = 'zg_appearance', IMG = 'zg_wallpaper_img';
const DEFAULTS: Appearance = { wall: DEFAULT_WALLPAPER, dim: 0, theme: 0, quality: 0 };

export function useAppearance() {
  const [a, setA] = useState<Appearance>(DEFAULTS);
  const [img, setImg] = useState<string | null>(null);
  const [warn, setWarn] = useState('');
  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY); if (s) setA({ ...DEFAULTS, ...JSON.parse(s) });
      setImg(localStorage.getItem(IMG));
    } catch {}
  }, []);
  useEffect(() => {
    const r = document.documentElement;
    if (a.theme === 0) r.removeAttribute('data-theme'); else r.setAttribute('data-theme', a.theme === 1 ? 'light' : 'dark');
  }, [a.theme]);
  useEffect(() => { setGlassQuality((['auto', 'high', 'low'] as GlassQuality[])[a.quality] ?? 'auto'); }, [a.quality]);
  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch {} }, 250);
    return () => clearTimeout(t);
  }, [a]);
  return useMemo(() => {
    const set = (p: Partial<Appearance>) => setA((x) => ({ ...x, ...p }));
    const saveImg = (d: string | null) => {
      setWarn(''); setImg(d);
      try { d ? localStorage.setItem(IMG, d) : localStorage.removeItem(IMG); }
      catch { setWarn('Photo is too large to remember; it will reset on reload.'); }
    };
    return { a, set, img, saveImg, warn, reset: () => { setA(DEFAULTS); saveImg(null); } };
  }, [a, img, warn]);
}

const autoId = () => { const h = new Date().getHours(); return h < 6 || h >= 21 ? 'graphite' : h < 11 ? 'sky' : h < 17 ? 'ocean' : 'dune'; };
type Layer = { key: string; style: CSSProperties };
export const Wallpaper = memo(function Wallpaper({ a, img }: { a: Appearance; img: string | null }) {
  const custom = a.wall === 'custom' && img;
  const wid = a.wall === 'auto' ? autoId() : a.wall;
  const css = WALLPAPERS.find((w) => w.id === wid)?.css ?? WALLPAPERS[0].css;
  const key = custom ? 'img:' + img!.length : wid;
  const style: CSSProperties = custom ? { backgroundImage: `url(${img})` } : { background: css };
  const [layers, setLayers] = useState<Layer[]>(() => [{ key, style }]);
  useEffect(() => {
    let dead = false, t: ReturnType<typeof setTimeout>;
    const apply = () => {
      if (dead) return;
      setLayers((l) => (l[l.length - 1].key === key ? l : [...l.slice(-1), { key, style }]));
      t = setTimeout(() => setLayers((l) => l.slice(-1)), 800); // crossfade, then drop the old layer
    };
    if (custom) { const im = new Image(); im.src = img!; im.decode().then(apply, apply); } // decode first: no jank mid-fade
    else apply();
    return () => { dead = true; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="wall" aria-hidden="true">
      {layers.map((l) => <div key={l.key} className="wall-img" style={l.style} />)}
      <div className="wall-dim" style={{ opacity: a.dim / 100 }} />
    </div>
  );
});

function downscale(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1600 / Math.max(im.width, im.height));
      const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.82));
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image.')); };
    im.src = url;
  });
}

export const SettingsSheet = memo(function SettingsSheet(p: {
  open: boolean; onClose: () => void; ap: ReturnType<typeof useAppearance>; user: string | null; onSignOut: () => void;
}) {
  const { a, set, img, saveImg, warn, reset } = p.ap;
  const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);
  async function pick(f?: File) {
    if (!f) return; setErr('');
    if (!f.type.startsWith('image/')) return setErr('Please choose an image file.');
    try { saveImg(await downscale(f)); set({ wall: 'custom' }); } catch (e: any) { setErr(e.message); }
    if (file.current) file.current.value = '';
  }
  return (
    <GlassSheet open={p.open} onClose={p.onClose} aria-label="Settings">
      <div className="sheet">
        <h2>Settings</h2>
        <section className="stack" aria-label="Appearance">
          <h3>Appearance</h3>
          <GlassSegmented options={['Auto', 'Light', 'Dark']} value={a.theme} onChange={(theme) => set({ theme })} aria-label="Theme" />
        </section>
        <section className="stack" aria-label="Glass effects">
          <h3>Glass effects</h3>
          <GlassSegmented options={['Auto', 'High', 'Low']} value={a.quality} onChange={(quality) => set({ quality })} aria-label="Glass quality" />
          <p>Auto adapts to your device. Low keeps blur and edges but only refracts while pressed, which is smoother on older phones.</p>
        </section>
        <section className="stack" aria-label="Wallpaper">
          <h3>Wallpaper</h3>
          <div className="swatches" role="radiogroup" aria-label="Wallpaper">
            <button role="radio" aria-checked={a.wall === 'auto'} aria-label="Auto, changes with the time of day"
              className={'swatch' + (a.wall === 'auto' ? ' on' : '')} style={{ background: 'linear-gradient(135deg,#d9ecff,#0a84ff 50%,#3b1d0e)' }} onClick={() => set({ wall: 'auto' })}>
              <span>Auto</span>
            </button>
            {WALLPAPERS.map((w) => (
              <button key={w.id} role="radio" aria-checked={a.wall === w.id} aria-label={w.name}
                className={'swatch' + (a.wall === w.id ? ' on' : '')} style={{ background: w.css }} onClick={() => set({ wall: w.id })}>
                <span>{w.name}</span>
              </button>
            ))}
            {img && (
              <button role="radio" aria-checked={a.wall === 'custom'} aria-label="Your photo"
                className={'swatch' + (a.wall === 'custom' ? ' on' : '')} style={{ backgroundImage: `url(${img})`, backgroundSize: 'cover' }} onClick={() => set({ wall: 'custom' })}>
                <span>Your photo</span>
              </button>
            )}
          </div>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} aria-label="Choose wallpaper photo" />
          <GlassButton variant="clear" onClick={() => file.current?.click()}><span className="btn"><UploadIcon size={18} /> Use my own photo</span></GlassButton>
          <GlassSlider value={a.dim} onChange={(dim) => set({ dim })} min={0} max={60} step={1} aria-label="Dim wallpaper" />
          <p>Dim wallpaper: {a.dim}%</p>
          {(err || warn) && <div className="err" role="alert">{err || warn}</div>}
        </section>
        <div className="row">
          <GlassButton variant="clear" onClick={reset}>Reset to default</GlassButton>
          {p.user && <GlassButton destructive onClick={p.onSignOut}>Sign out ({p.user})</GlassButton>}
        </div>
      </div>
    </GlassSheet>
  );
});
