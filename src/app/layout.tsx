import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Voice Agent — the AI speaks, the code decides',
  description:
    'Hybrid voice/chat agent: injection guard → deterministic engine → LLM fallback. Three scenarios (debt collection, booking, reception), Swedish + English, browser voice.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
