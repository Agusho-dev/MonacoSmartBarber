'use client'

import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/** Fondo fijo con viñetas cian/violeta (toda la terminal). */
export function TerminalAmbient({ className }: { className?: string }) {
  return (
    <div
      className={cn('pointer-events-none fixed inset-0 z-0 overflow-hidden', className)}
      aria-hidden
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-10%,rgba(34,211,238,0.14),transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_45%_35%_at_95%_15%,rgba(167,139,250,0.1),transparent_45%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_30%_at_5%_80%,rgba(244,114,182,0.06),transparent_40%)]" />
    </div>
  )
}

/** Viñeta superior por pantalla (contenedor relativo). */
export function TerminalSectionGlow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 h-40 md:h-52 opacity-[0.55]',
        className
      )}
      aria-hidden
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(34,211,238,0.14),transparent_55%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_85%_10%,rgba(167,139,250,0.09),transparent_50%)]" />
    </div>
  )
}

/** Marco neón animado: envuelve un único hijo (p. ej. &lt;button&gt;). */
export function TerminalNeoFrame({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('relative rounded-2xl md:rounded-3xl', className)} style={{ padding: '2px' }}>
      <div className="absolute inset-0 rounded-2xl md:rounded-3xl overflow-hidden pointer-events-none">
        <div className="absolute inset-[-200%] bg-[conic-gradient(from_0deg,transparent_0%,rgba(34,211,238,0.65)_10%,rgba(167,139,250,0.55)_18%,rgba(244,114,182,0.5)_26%,rgba(34,211,238,0.4)_34%,transparent_44%)] animate-[checkin-terminal-orbit_3.2s_linear_infinite] motion-reduce:animate-none" />
      </div>
      <div className="absolute -inset-2 rounded-[1.35rem] md:rounded-[1.85rem] bg-gradient-to-r from-cyan-500/35 via-violet-500/30 to-fuchsia-500/35 blur-xl opacity-60 animate-[checkin-terminal-neon-pulse_2.8s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:opacity-50 pointer-events-none" />
      {children}
    </div>
  )
}

/**
 * Glass button wrapper: rotating white ring + halo alrededor del borde.
 * Usar: <GlassRing><button className="checkin-glass-surface ...">...</button></GlassRing>
 * O via prop `radius` para controlar el border-radius.
 */
export function GlassRing({
  children,
  radius = 'rounded-2xl md:rounded-[1.25rem]',
  halo = true,
  className,
}: {
  children: ReactNode
  radius?: string
  halo?: boolean
  className?: string
}) {
  return (
    <div className={cn('relative', radius, className)}>
      <span
        className={cn('checkin-glass-border', radius, !halo && 'checkin-glass-border--no-halo')}
        aria-hidden
      />
      {children}
    </div>
  )
}

/**
 * Anillo giratorio con brillo neón para los botones de servicios.
 * Envuelve un único hijo (p. ej. <button>) y matchea su radius.
 */
export function ServiceRing({
  children,
  radius = 'rounded-xl md:rounded-2xl',
  className,
}: {
  children: ReactNode
  radius?: string
  className?: string
}) {
  return (
    <div className={cn('relative', radius, className)}>
      <span className={cn('checkin-service-halo', radius)} aria-hidden />
      <span className={cn('checkin-service-ring', radius)} aria-hidden />
      {children}
    </div>
  )
}

export function TerminalGlobalStyles() {
  return (
    <style>{`
      @keyframes checkin-terminal-orbit {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      @keyframes checkin-terminal-neon-pulse {
        0%, 100% { opacity: 0.5; transform: scale(1); }
        50% { opacity: 0.9; transform: scale(1.04); }
      }
      @keyframes checkin-terminal-shimmer {
        0% { transform: translateX(-120%) skewX(-12deg); }
        100% { transform: translateX(120%) skewX(-12deg); }
      }
      @property --checkin-glass-angle {
        syntax: '<angle>';
        initial-value: 0deg;
        inherits: false;
      }
      @keyframes checkin-glass-spin {
        to { --checkin-glass-angle: 360deg; }
      }
      .checkin-glass-border {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 1.5px;
        background: conic-gradient(
          from var(--checkin-glass-angle, 0deg),
          transparent 0deg,
          rgba(255,255,255,0.95) 35deg,
          rgba(255,255,255,0.2) 75deg,
          transparent 130deg,
          transparent 215deg,
          rgba(255,255,255,0.75) 265deg,
          rgba(255,255,255,0.15) 310deg,
          transparent 360deg
        );
        -webkit-mask:
          linear-gradient(#000 0 0) content-box,
          linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        mask:
          linear-gradient(#000 0 0) content-box,
          linear-gradient(#000 0 0);
        mask-composite: exclude;
        animation: checkin-glass-spin 6s linear infinite;
        pointer-events: none;
        z-index: 2;
      }
      .checkin-glass-border::after {
        content: '';
        position: absolute;
        inset: -6px;
        border-radius: inherit;
        background: conic-gradient(
          from var(--checkin-glass-angle, 0deg),
          transparent 0deg,
          rgba(255,255,255,0.55) 35deg,
          transparent 90deg,
          transparent 230deg,
          rgba(255,255,255,0.4) 265deg,
          transparent 320deg
        );
        filter: blur(10px);
        opacity: 0.6;
        pointer-events: none;
      }
      .checkin-glass-border.checkin-glass-border--no-halo::after {
        display: none !important;
        content: none !important;
      }
      @media (prefers-reduced-motion: reduce) {
        .checkin-glass-border { animation: none; }
      }
      .checkin-glass-surface {
        position: relative;
        background: linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.05) 55%, rgba(255,255,255,0.02));
        -webkit-backdrop-filter: blur(16px);
        backdrop-filter: blur(16px);
        box-shadow:
          0 10px 40px rgba(0,0,0,0.4),
          inset 0 1px 0 rgba(255,255,255,0.28),
          inset 0 -1px 0 rgba(255,255,255,0.06);
      }
      .checkin-glass-surface::before {
        content: '';
        position: absolute;
        inset: 2px 8px auto 8px;
        height: 45%;
        border-radius: 0 0 100% 100% / 0 0 100% 100%;
        background: linear-gradient(to bottom, rgba(255,255,255,0.28), rgba(255,255,255,0.08) 55%, transparent);
        filter: blur(1px);
        pointer-events: none;
      }
      .checkin-glass-surface-sm::before {
        inset: 1px 3px auto 3px;
        height: 42%;
      }
      @keyframes checkin-service-spin {
        to { --checkin-glass-angle: 360deg; }
      }
      .checkin-service-ring {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 2px;
        background: conic-gradient(
          from var(--checkin-glass-angle, 0deg),
          transparent 0deg,
          rgba(34,211,238,0.95) 40deg,
          rgba(167,139,250,0.9) 90deg,
          rgba(244,114,182,0.85) 140deg,
          transparent 200deg,
          transparent 240deg,
          rgba(34,211,238,0.6) 290deg,
          transparent 360deg
        );
        -webkit-mask:
          linear-gradient(#000 0 0) content-box,
          linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        mask:
          linear-gradient(#000 0 0) content-box,
          linear-gradient(#000 0 0);
        mask-composite: exclude;
        animation: checkin-service-spin 4s linear infinite;
        pointer-events: none;
        z-index: 2;
      }
      .checkin-service-halo {
        position: absolute;
        inset: -3px;
        border-radius: inherit;
        background: conic-gradient(
          from var(--checkin-glass-angle, 0deg),
          transparent 0deg,
          rgba(34,211,238,0.55) 40deg,
          rgba(167,139,250,0.5) 90deg,
          rgba(244,114,182,0.45) 140deg,
          transparent 200deg,
          transparent 260deg,
          rgba(34,211,238,0.35) 300deg,
          transparent 360deg
        );
        filter: blur(8px);
        opacity: 0.75;
        animation: checkin-service-spin 4s linear infinite;
        pointer-events: none;
        z-index: 1;
      }
      @media (prefers-reduced-motion: reduce) {
        .checkin-service-ring, .checkin-service-halo { animation: none; }
      }
      @keyframes checkin-countdown {
        from { transform: scaleX(1); }
        to { transform: scaleX(0); }
      }
      .checkin-terminal-shimmer-layer {
        background: linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.08) 45%, transparent 55%);
        animation: checkin-terminal-shimmer 2.4s ease-in-out infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .checkin-terminal-shimmer-layer { animation: none; }
      }
    `}</style>
  )
}

export const terminalH1 = 'text-2xl md:text-5xl font-bold tracking-tight text-balance'
export const terminalH1Gradient =
  'bg-gradient-to-r from-cyan-200 via-white to-violet-200 bg-clip-text text-transparent'
export const terminalH2 = 'text-xl md:text-3xl font-bold tracking-tight text-white/95'
export const terminalH2Muted =
  'text-lg md:text-3xl font-semibold tracking-wide text-cyan-100/75 text-balance drop-shadow-[0_0_18px_rgba(34,211,238,0.12)]'
export const terminalBodyMuted = 'text-sm md:text-lg text-cyan-100/55'

export const terminalGlassCard =
  'rounded-2xl md:rounded-3xl border border-white/15 checkin-glass-surface'
export const terminalGlassCardInner = 'rounded-xl border border-white/10 bg-white/[0.04]'

export const terminalListItem =
  'relative rounded-2xl border border-white/15 checkin-glass-surface text-white transition-all duration-300 hover:border-white/25 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]'

export const terminalKeypadShell =
  'w-full rounded-2xl border border-white/15 checkin-glass-surface p-3 md:p-4 text-center relative overflow-hidden'
export const terminalKeypadKey =
  'relative rounded-xl md:rounded-2xl border border-white/15 checkin-glass-surface checkin-glass-surface-sm text-white font-semibold transition-all duration-200 hover:border-white/28 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50'

export const terminalSecondaryFlat =
  'relative rounded-2xl md:rounded-3xl border border-white/15 checkin-glass-surface text-white transition-all duration-300 hover:border-white/28 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50'

export const terminalPrimaryInnerBtn =
  'relative z-[1] flex w-full flex-row items-center justify-center gap-3 md:gap-4 overflow-hidden rounded-[0.875rem] md:rounded-[1.375rem] border border-white/20 checkin-glass-surface px-3 py-3 md:px-5 md:py-4 text-white transition-all duration-300 hover:border-white/32 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60'

export const terminalDialogSurface =
  'inset-4 translate-x-0 translate-y-0 m-auto h-fit max-w-[95vw] md:max-w-2xl max-h-[80dvh] flex flex-col overflow-hidden border border-white/15 checkin-glass-surface p-4 md:p-8 rounded-2xl md:rounded-[2rem]'

export const terminalProgressTrack = 'w-full max-w-xs h-1 rounded-full bg-white/10 overflow-hidden border border-white/15'
export const terminalProgressFill =
  'h-full rounded-full origin-left bg-gradient-to-r from-cyan-300 via-white to-violet-300'
