// Apple-style soft mesh wallpapers, drawn with CSS (no external assets, no purple).
const mesh = (a: string, b: string, c: string, base: string) =>
  `radial-gradient(70vmax 60vmax at 15% 10%, ${a} 0%, transparent 62%),` +
  `radial-gradient(70vmax 70vmax at 95% 35%, ${b} 0%, transparent 60%),` +
  `radial-gradient(90vmax 70vmax at 25% 105%, ${c} 0%, transparent 70%), ${base}`;

export const WALLPAPERS = [
  { id: 'ocean',    name: 'Ocean',    css: mesh('#5ac8fa', '#0a84ff', '#0b3d6b', '#062540') },
  { id: 'dune',     name: 'Dune',     css: mesh('#ffd9a0', '#ff9f5a', '#8a3b12', '#3b1d0e') },
  { id: 'meadow',   name: 'Meadow',   css: mesh('#d7f5a8', '#34c759', '#0f5a3a', '#07301f') },
  { id: 'sky',      name: 'Sky',      css: mesh('#ffffff', '#a8d8ff', '#5aa9f0', '#d9ecff') },
  { id: 'sand',     name: 'Sand',     css: mesh('#fff4e0', '#f2d7b0', '#d9b48a', '#efe2cf') },
  { id: 'graphite', name: 'Graphite', css: mesh('#6b7280', '#3a3f4a', '#1b1e25', '#0f1115') },
] as const;

export const DEFAULT_WALLPAPER = 'ocean';
