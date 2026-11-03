import '@zakisheriff/liquid-glass/styles.css';
import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = { title: 'Zip to GitHub', description: 'Upload a project zip and commit it to GitHub.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0a84ff' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
