import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'

export const metadata: Metadata = {
  title: 'viet-chatter config',
  description: 'Runtime configuration for the viet-chatter WhatsApp bot.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning on <html> + <body>: browser extensions
  // (Grammarly, Dark Reader, ColorZilla, etc.) inject className/attrs into
  // the top-level nodes before React hydrates, producing a SSR/client diff
  // that we can't (and shouldn't) fight. Only suppresses the warning at the
  // boundary node — child mismatches still warn.
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="min-h-screen bg-background text-foreground antialiased"
        suppressHydrationWarning
      >
        {children}
        <Toaster />
      </body>
    </html>
  )
}
