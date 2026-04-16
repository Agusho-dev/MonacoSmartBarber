import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Portal de Partners · Monaco',
  description: 'Portal para comercios aliados de Monaco Smart Barber',
}

export default function PartnersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950">
      {children}
    </div>
  )
}
