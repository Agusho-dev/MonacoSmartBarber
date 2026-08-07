'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Sistema de vidrio del turnero público.
 *
 * Es el mismo LOOK que la tablet de check-in (`src/components/checkin/
 * terminal-theme.tsx`) pero NO es el mismo código, y no puede serlo: el kiosko
 * es siempre oscuro con neón cian, así que se permite hardcodear
 * `bg-white/[0.04]` y `border-white/15`. El turnero se pinta con los colores de
 * MARCA del dueño, que pueden ser claros u oscuros — copiar esos literales deja
 * el vidrio invisible sobre un fondo claro y el neón peleado con la identidad.
 *
 * Acá cada valor sale de un token derivado en `theme.ts`, donde la opacidad del
 * vidrio se BUSCA midiendo el contraste de la composición real (ver
 * `alphaLegible`). El resultado: sobre el #606060 del dueño el panel es blanco
 * al 12%, sobre un tema claro es blanco casi sólido con sombra, y en los dos
 * casos el texto que va encima sigue cumpliendo WCAG AA.
 *
 * Nada de esto usa una librería de animación: no hay ninguna instalada. Todo es
 * `@keyframes` + `transform`/`opacity`, y todo se apaga con
 * `prefers-reduced-motion`.
 */

// ─── Clases base ─────────────────────────────────────────────────────

/** Panel de vidrio en reposo. */
export const glassPanel = 't-glass rounded-2xl'

/** Panel de vidrio que responde al mouse y al dedo. */
export const glassInteractive = 't-glass t-glass-int rounded-2xl'

// ─── Componentes ─────────────────────────────────────────────────────

export function GlassPanel({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn(glassPanel, className)} {...rest}>
      {children}
    </div>
  )
}

export function GlassButton({
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        glassInteractive,
        'flex items-center justify-center gap-2 font-semibold text-[var(--t-text)]',
        'disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

// ─── Ambiente ────────────────────────────────────────────────────────

/**
 * Manchas de luz fijas detrás de todo.
 *
 * El `backdrop-filter` del vidrio desenfoca lo que tiene atrás; sobre un color
 * PLANO —que es el caso del turnero, no hay imagen de fondo— no hay nada que
 * desenfocar y el efecto directamente no se percibe. Estas tres viñetas son lo
 * que hace que el vidrio exista.
 *
 * Los colores salen de `--t-glow-*`, derivados del primario de la marca y
 * validados contra el texto que cae encima: si la paleta no tiene presupuesto
 * de contraste, el token queda en alpha 0 y las manchas simplemente no se ven,
 * en vez de romper la legibilidad de la página.
 *
 * Son gradientes estáticos a propósito: animarlos cuesta repintado de pantalla
 * completa en celulares baratos, que es exactamente el público del turnero.
 */
export function TurneroAmbient() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 48% at 50% -10%, var(--t-glow-1), transparent 62%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 52% 34% at 96% 24%, var(--t-glow-2), transparent 58%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 58% 40% at 0% 84%, var(--t-glow-2), transparent 60%)',
        }}
      />
    </div>
  )
}

// ─── Estilos globales ────────────────────────────────────────────────

/**
 * Se monta UNA vez en la raíz del wizard. Todo lo que sigue consume tokens
 * `--t-*`, así que ninguna clase trae un color propio.
 */
export function TurneroStyles() {
  return (
    <style>{`
      /* ── Vidrio ────────────────────────────────────────────────── */
      .t-glass {
        position: relative;
        background: var(--t-glass-bg);
        border: 1px solid var(--t-glass-border);
        box-shadow: var(--t-glass-shadow);
        -webkit-backdrop-filter: blur(16px) saturate(150%);
        backdrop-filter: blur(16px) saturate(150%);
      }
      /* Línea de luz del borde superior. Va con los extremos recortados para
         que no se monte sobre las esquinas redondeadas. */
      .t-glass::before {
        content: '';
        position: absolute;
        top: 0;
        left: 12%;
        right: 12%;
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--t-glass-highlight), transparent);
        pointer-events: none;
      }
      .t-glass-inner {
        background: var(--t-glass-inner);
        border: 1px solid var(--t-glass-border);
      }
      .t-glass-int {
        transition:
          background-color 200ms ease,
          border-color 200ms ease,
          box-shadow 260ms ease,
          transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      /* Sólo en punteros reales: en celular el :hover se queda pegado después
         del tap y la tarjeta queda elevada para siempre. */
      @media (hover: hover) {
        .t-glass-int:hover {
          background: var(--t-glass-bg-hover);
          border-color: var(--t-glass-border-strong);
          box-shadow: var(--t-glass-shadow-hover);
          transform: translateY(-2px);
        }
      }
      .t-glass-int:active {
        transform: translateY(0) scale(0.985);
      }
      .t-glass-int:focus-visible {
        outline: none;
        border-color: var(--t-glass-border-strong);
        box-shadow: var(--t-glass-shadow), 0 0 0 3px var(--t-ring);
      }
      /* Estado elegido: el borde pasa a ser el primario y el halo lo despega
         del resto de la grilla. */
      .t-glass-sel {
        border-color: var(--t-primary);
        box-shadow: inset 0 0 0 1px var(--t-primary), 0 10px 30px -12px var(--t-ring);
      }
      @media (hover: hover) {
        .t-glass-sel:hover { box-shadow: inset 0 0 0 1px var(--t-primary), 0 14px 34px -12px var(--t-ring); }
      }

      /* ── Entrada de paso ───────────────────────────────────────── */
      @keyframes t-in-fwd {
        from { opacity: 0; transform: translate3d(22px, 0, 0); }
        to   { opacity: 1; transform: none; }
      }
      @keyframes t-in-back {
        from { opacity: 0; transform: translate3d(-22px, 0, 0); }
        to   { opacity: 1; transform: none; }
      }
      .t-step { animation: t-in-fwd 340ms cubic-bezier(0.22, 1, 0.36, 1) both; }
      .t-step-back { animation-name: t-in-back; }

      /* ── Aparición escalonada ──────────────────────────────────── */
      @keyframes t-rise {
        from { opacity: 0; transform: translate3d(0, 12px, 0) scale(0.97); }
        to   { opacity: 1; transform: none; }
      }
      .t-rise {
        animation: t-rise 380ms cubic-bezier(0.22, 1, 0.36, 1) both;
        animation-delay: calc(var(--t-i, 0) * 30ms);
      }

      /* ── Brillo que recorre el CTA ─────────────────────────────── */
      /* El barrido ocupa el primer 16% del ciclo y el resto es pausa: un loop
         continuo al lado de un botón de "confirmar" se lee como nerviosismo. */
      @keyframes t-sheen {
        0%   { transform: translateX(-160%) skewX(-18deg); }
        16%  { transform: translateX(280%) skewX(-18deg); }
        100% { transform: translateX(280%) skewX(-18deg); }
      }
      .t-sheen { position: relative; overflow: hidden; }
      .t-sheen::after {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        width: 38%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.26), transparent);
        animation: t-sheen 6.5s ease-in-out infinite 1.2s;
        pointer-events: none;
      }

      /* ── Esqueletos de carga ───────────────────────────────────── */
      @keyframes t-sweep {
        from { transform: translateX(-100%); }
        to   { transform: translateX(100%); }
      }
      .t-skel {
        position: relative;
        overflow: hidden;
        background: var(--t-glass-bg);
        border: 1px solid var(--t-glass-border);
      }
      .t-skel::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, transparent, var(--t-glass-highlight), transparent);
        opacity: 0.55;
        animation: t-sweep 1500ms ease-in-out infinite;
      }

      /* ── Tilde de confirmación ─────────────────────────────────── */
      @keyframes t-draw { to { stroke-dashoffset: 0; } }
      @keyframes t-pop {
        0%   { opacity: 0; transform: scale(0.82); }
        60%  { opacity: 1; transform: scale(1.05); }
        100% { opacity: 1; transform: scale(1); }
      }
      @keyframes t-halo {
        0%   { opacity: 0; transform: scale(0.6); }
        40%  { opacity: 0.75; transform: scale(1); }
        100% { opacity: 0; transform: scale(1.55); }
      }
      .t-check-shell { animation: t-pop 520ms cubic-bezier(0.22, 1, 0.36, 1) both; }
      .t-check-halo { animation: t-halo 1400ms ease-out 620ms both; }
      .t-check-ring {
        stroke-dasharray: 166;
        stroke-dashoffset: 166;
        animation: t-draw 640ms cubic-bezier(0.65, 0, 0.35, 1) 140ms forwards;
      }
      /* 37 ≈ el largo real del trazo (12 + 24 unidades del viewBox de 64): si el
         dasharray fuese más grande, el tilde terminaría de dibujarse antes de
         que la animación llegue al final y el último tramo quedaría muerto. */
      .t-check-tick {
        stroke-dasharray: 37;
        stroke-dashoffset: 37;
        animation: t-draw 380ms cubic-bezier(0.65, 0, 0.35, 1) 700ms forwards;
      }

      /* ── Sin animación ─────────────────────────────────────────── */
      /* El estado final tiene que quedar VISIBLE: apagar una animación con
         fill-mode "both" deja el elemento en su estado natural, pero el trazo
         del tilde vive en el dasharray y sin esto quedaría dibujado a medias. */
      @media (prefers-reduced-motion: reduce) {
        .t-step,
        .t-rise,
        .t-check-shell,
        .t-check-ring,
        .t-check-tick,
        .t-sheen::after,
        .t-skel::after {
          animation: none !important;
        }
        .t-check-halo { animation: none !important; opacity: 0; }
        .t-check-ring, .t-check-tick { stroke-dashoffset: 0; }
        .t-glass-int { transition: none; }
        .t-glass-int:hover { transform: none; }
      }
    `}</style>
  )
}
