'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'

// Micro-animación celebratoria al activar el Modo Pro (~1.2s).
// Reutiliza clases globales: .animate-pro-celebrate, .pro-sweep, confettiFall.
// El CSS global desactiva las animaciones bajo prefers-reduced-motion.

const SPARKLES = [
  { left: '12%', delay: 0, size: 14 },
  { left: '28%', delay: 0.15, size: 10 },
  { left: '46%', delay: 0.05, size: 16 },
  { left: '63%', delay: 0.22, size: 11 },
  { left: '78%', delay: 0.1, size: 13 },
  { left: '90%', delay: 0.3, size: 9 },
]

export function ProCelebration({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!show) return
    // Diferir el setState para no dispararlo sincrónicamente dentro del effect.
    const raf = requestAnimationFrame(() => setVisible(true))
    const t = setTimeout(() => setVisible(false), 1200)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [show])

  if (!visible) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-xl"
    >
      {/* Barrido dorado sobre la card */}
      <div className="pro-sweep absolute inset-0" />

      {/* Banner central dorado */}
      <div className="absolute inset-x-0 top-3 flex justify-center">
        <div className="animate-pro-celebrate inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.78_0.12_85_/_0.4)] bg-[oklch(0.78_0.12_85_/_0.12)] px-3 py-1 text-xs font-semibold text-[oklch(0.78_0.12_85)] shadow-[0_0_18px_oklch(0.78_0.12_85_/_0.35)]">
          <Sparkles className="size-3.5" />
          Modo Pro activado
        </div>
      </div>

      {/* Chispas cayendo */}
      {SPARKLES.map((s, i) => (
        <span
          key={i}
          className="absolute top-0 text-[oklch(0.78_0.12_85)]"
          style={{
            left: s.left,
            animation: `confettiFall 1.1s ${s.delay}s ease-in forwards`,
          }}
        >
          <Sparkles style={{ width: s.size, height: s.size }} />
        </span>
      ))}
    </div>
  )
}
