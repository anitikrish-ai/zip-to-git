import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Zip to GitHub', short_name: 'Zip2GH', description: 'Upload a project zip and commit it to GitHub.',
    start_url: '/', display: 'standalone', background_color: '#0b0d12', theme_color: '#0a84ff',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
