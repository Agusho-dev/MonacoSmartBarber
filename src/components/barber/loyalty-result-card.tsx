'use client'

import { useEffect, useRef, type CSSProperties } from 'react'
import { ArrowDown, ArrowUp, Hourglass, ShieldCheck, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { tierGradient, visitasRecientesLabel, type LoyaltyFinalizeResult } from '@/lib/loyalty-checkout'

interface LoyaltyResultCardProps {
  /** Lo que devolvió `loyalty_finalize_visit` (ya con enabled = true). */
  result: LoyaltyFinalizeResult
  clientName?: string | null
  onClose: () => void
  /** Auto-cierre. Default: 2,5 s; 4 s si hubo cambio de categoría (hay más para leer). */
  autoCloseMs?: number
}

/** Si el programa no trajo colores (no debería pasar), zinc del tema oscuro. */
const FALLBACK = { primary: '#27272a', secondary: '#52525b', text: '#fafafa' }

/** Nombre del cliente "grabado" en la tarjeta, como en la app. */
const EMBOSSED: CSSProperties = {
  textShadow: '0 1px 0 rgba(255,255,255,0.25), 0 -1px 0 rgba(0,0,0,0.35)',
}

/**
 * Resultado del programa de fidelización tras el cobro, como una tarjeta
 * ("MonacoCard") con el gradiente de la categoría del cliente: la misma que ve
 * en su celular. Es un overlay a pantalla completa para que el barbero se lo
 * diga al cliente ("sumaste 110 puntos", "subiste a Oro"). Se cierra solo o
 * con la X. Colores, nombres y umbrales vienen del server: acá no hay nada
 * hardcodeado del programa.
 */
export function LoyaltyResultCard({ result, clientName, onClose, autoCloseMs }: LoyaltyResultCardProps) {
  const change = result.tier_changed ?? null
  const ms = autoCloseMs ?? (change ? 4000 : 2500)

  // `onClose` suele venir como arrow inline: se lee por ref para que un re-render
  // del padre no reinicie el temporizador.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    const t = setTimeout(() => onCloseRef.current(), ms)
    return () => clearTimeout(t)
  }, [ms])

  const primary = result.tier_color_primary || FALLBACK.primary
  const secondary = result.tier_color_secondary || FALLBACK.secondary
  const text = result.tier_text_color || FALLBACK.text
  const tierName = result.tier_name ?? 'Cliente'
  const points = Math.max(0, Math.round(result.points_earned ?? 0))
  const balance = Math.max(0, Math.round(result.balance ?? 0))
  const isPlatinum = result.tier_code === 'platinum'
  const celebrate = change === 'up' || change === 'enrolled'

  return (
    <div
      role="status"
      aria-live="polite"
      // z-[120]: por encima del Dialog de cobro (z-[110]). Radix deja el overlay
      // montado ~200 ms mientras anima la salida; la tarjeta ya tiene que estar arriba.
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X className="size-5" />
      </button>

      <div className="w-full max-w-[440px]" onClick={(e) => e.stopPropagation()}>
        {celebrate && (
          <p className="mb-4 text-center text-2xl font-black text-white animate-scale-in">
            {change === 'up' ? `¡Subió a ${tierName}!` : '¡Entró al programa!'}
          </p>
        )}

        <div
          className="relative aspect-[1.586/1] w-full overflow-hidden rounded-[22px] shadow-2xl animate-scale-in"
          style={{ backgroundImage: tierGradient(primary, secondary), color: text }}
        >
          {/* Banda de brillo diagonal */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: 'linear-gradient(115deg, rgba(255,255,255,0) 32%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0) 68%)' }}
          />
          {/* Vignette inferior derecha */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: 'radial-gradient(120% 90% at 100% 100%, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0) 60%)' }}
          />
          {/* Barrido holográfico: sólo Platinum */}
          {isPlatinum && (
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-[60%] opacity-[0.14] animate-[spin_16s_linear_infinite]"
              style={{ backgroundImage: 'conic-gradient(from 0deg, #ff3d7f, #ffb020, #7bff5a, #29d3ff, #8a5bff, #ff3d7f)' }}
            />
          )}

          <div className="relative flex h-full flex-col justify-between p-5 sm:p-6">
            {/* Arriba: wordmark + chip EMV · etiqueta de categoría */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-black tracking-[0.35em]">MONACO</p>
                <div
                  aria-hidden
                  className="mt-3 h-[26px] w-[34px] overflow-hidden rounded-[6px] ring-1 ring-black/25"
                  style={{ backgroundImage: 'linear-gradient(135deg, #E8C46A 0%, #B8892B 100%)' }}
                >
                  <div className="grid h-full grid-cols-3 grid-rows-3">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <span key={i} className="border-[0.5px] border-black/25" />
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.25em]">
                <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
                <span className="truncate">Cliente {tierName}</span>
              </div>
            </div>

            {/* Centro: puntos ganados + estado */}
            <div>
              {points > 0 ? (
                <>
                  <p className="text-[clamp(40px,10vw,56px)] font-black leading-none tracking-tight tabular-nums">
                    +{points.toLocaleString('es-AR')}
                  </p>
                  <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.3em] opacity-80">Puntos</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-black leading-none tracking-tight">Visita sumada</p>
                  <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.3em] opacity-80">Sin puntos esta vez</p>
                </>
              )}
              <p className="mt-2 text-sm font-semibold opacity-90">
                Cliente {tierName} · {visitasRecientesLabel(result.visits_in_window)}
              </p>
              <StatusLine result={result} tierName={tierName} />
            </div>

            {/* Abajo: nombre embossed · saldo */}
            <div className="flex items-end justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-bold uppercase tracking-[0.08em]" style={EMBOSSED}>
                {(clientName ?? 'Cliente').toUpperCase()}
              </p>
              <p className="shrink-0 text-[10px] font-bold uppercase tracking-[0.2em] opacity-80">
                Saldo {balance.toLocaleString('es-AR')} pts
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Segunda línea: qué pasó con la categoría. La gracia NO se festeja: va en ámbar. */
function StatusLine({ result, tierName }: { result: LoyaltyFinalizeResult; tierName: string }) {
  const change = result.tier_changed ?? null
  const pill = 'mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold'

  if (change === 'grace') {
    const days = result.grace_days_left
    return (
      <span className={cn(pill, 'bg-amber-400 text-amber-950')}>
        <Hourglass className="size-3.5" />
        {days != null
          ? `Le quedan ${days} ${days === 1 ? 'día' : 'días'} para mantener ${tierName}`
          : `Tiene pocos días para mantener ${tierName}`}
      </span>
    )
  }
  if (change === 'up') {
    // El grito ("¡Subió a Oro!") ya va como título sobre la tarjeta: acá va lo que
    // cambia de verdad para el cliente, el multiplicador de la categoría nueva.
    const mult = result.multiplier_pct
    return (
      <span className={cn(pill, 'bg-white/20 animate-scale-in')}>
        <ArrowUp className="size-3.5" />
        {mult != null && mult > 0
          ? `Ahora suma puntos al ${Math.round(mult).toLocaleString('es-AR')} %`
          : `Cliente ${tierName} desde hoy`}
      </span>
    )
  }
  if (change === 'enrolled') {
    return (
      <span className={cn(pill, 'bg-white/20 animate-scale-in')}>
        <Sparkles className="size-3.5" /> Ya está en el programa
      </span>
    )
  }
  if (change === 'down') {
    return (
      <span className={cn(pill, 'bg-black/20')}>
        <ArrowDown className="size-3.5" /> Pasó a {tierName}
      </span>
    )
  }
  if (change === 'recovered') {
    return (
      <span className={cn(pill, 'bg-white/20')}>
        <ShieldCheck className="size-3.5" /> Mantiene {tierName}
      </span>
    )
  }
  const faltan = result.visits_to_next
  if (result.next_tier_name && faltan != null && faltan > 0) {
    return (
      <p className="mt-1.5 text-xs font-medium opacity-80">
        {faltan === 1 ? 'Le falta 1 visita' : `Le faltan ${faltan} visitas`} para {result.next_tier_name}
      </p>
    )
  }
  return null
}
