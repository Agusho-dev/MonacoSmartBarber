import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Portal de Partners · BarberOS',
  description: 'Portal para comercios aliados de BarberOS',
}

export default function PartnersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="barber-theme min-h-screen bg-background text-foreground">
      <div
        className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100"
        style={{
          backgroundImage:
            'radial-gradient(at 20% 0%, rgba(59,130,246,0.06) 0px, transparent 50%), radial-gradient(at 80% 100%, rgba(168,85,247,0.05) 0px, transparent 50%)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
