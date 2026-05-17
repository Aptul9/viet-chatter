import { redirect } from 'next/navigation'

// Root path now redirects to the unified dashboard, which holds the config tab
// alongside the other dashboard surfaces. Keeping `/` reachable so old
// bookmarks still land somewhere sensible.
export default function Page(): never {
  redirect('/dashboard')
}
