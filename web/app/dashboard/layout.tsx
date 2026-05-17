import Link from 'next/link'

const TABS = [
  { href: '/dashboard', label: 'Home' },
  { href: '/dashboard/chats', label: 'Chats' },
  { href: '/dashboard/schedule', label: 'Schedule' },
  { href: '/dashboard/stats', label: 'Stats' },
  { href: '/dashboard/summary', label: 'Summary' },
  { href: '/dashboard/agent', label: 'Agent' },
  { href: '/dashboard/config', label: 'Config' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      <header className="mb-6 border-b pb-4">
        <h1 className="text-2xl font-bold tracking-tight mb-3">viet-chatter dashboard</h1>
        <nav className="flex gap-4 text-sm">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </main>
  )
}
