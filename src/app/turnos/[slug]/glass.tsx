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
      {/* El degradado de base. Un fondo PLANO no deja ver el vidrio: el
          `backdrop-filter` no tiene nada que desenfocar y los paneles se leen
          como rectángulos grises sobre gris. */}
      <div className="absolute inset-0" style={{ background: 'var(--t-bg-gradient)' }} />
      <div
        className="t-drift-slow absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 110% 55% at 50% -12%, var(--t-glow-1), transparent 64%)',
        }}
      />
      {/* Las dos manchas laterales derivan MUY lento (28 s y 34 s) y sólo con
          `transform`, que el compositor resuelve sin repintar: es lo que hace
          que el vidrio parezca tener algo vivo detrás en vez de un degradado
          pegado. Se apagan enteras con `prefers-reduced-motion`. */}
      <div
        className="t-drift absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 64% 42% at 98% 22%, var(--t-glow-1), transparent 60%)',
        }}
      />
      <div
        className="t-drift t-drift-b absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 46% at -4% 78%, var(--t-glow-2), transparent 62%)',
        }}
      />
      <div
        className="t-drift t-drift-c absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 46% 30% at 22% 42%, var(--t-glow-2), transparent 66%)',
        }}
      />
    </div>
  )
}

// ─── Confirmación en verde ───────────────────────────────────────────

/**
 * La pantalla se pone verde y aparece el tilde.
 *
 * Es deliberadamente el único lugar del turnero donde el color NO es el de la
 * marca: "confirmado" es un código que el cliente ya trae aprendido de las apps
 * de pedidos, y leerlo tarda menos que cualquier texto. El verde y el blanco
 * van fijos (5:1 medido) justamente para que ninguna paleta de dueño pueda
 * dejar ilegible el momento más importante del flujo.
 *
 * El relleno es un CÍRCULO que crece con `transform: scale()` desde donde
 * estaba el botón de confirmar, no un `clip-path` ni un `width`: sólo el
 * primero lo resuelve el compositor sin repintar, y esto corre en el celular
 * más barato del local justo cuando el cliente está mirando.
 *
 * Se auto-oculta: la pantalla de confirmación ya está montada abajo y aparece
 * sola cuando el velo se va.
 */
export function ConfirmacionVerde({ onDone }: { onDone?: () => void }) {
  return (
    <div
      className="t-go-layer pointer-events-none fixed inset-0 z-50 overflow-hidden"
      onAnimationEnd={e => {
        if (e.animationName === 't-go-hide') onDone?.()
      }}
      role="status"
      aria-live="polite"
    >
      <span className="t-go-fill" aria-hidden />
      <div className="t-go-content relative flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
        <span className="relative flex h-28 w-28 items-center justify-center">
          <span className="t-go-ring absolute inset-0 rounded-full" aria-hidden />
          <span className="t-go-ring t-go-ring-b absolute inset-0 rounded-full" aria-hidden />
          <svg viewBox="0 0 64 64" className="relative h-28 w-28" fill="none" aria-hidden>
            <circle cx="32" cy="32" r="27" fill="rgba(255,255,255,0.16)" />
            <path
              d="M19 33 L28 42 L45 24"
              stroke="#ffffff"
              strokeWidth="5.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="t-go-tick"
            />
          </svg>
        </span>
        <p className="t-go-text text-[28px] font-bold leading-tight tracking-tight text-white">
          ¡Turno confirmado!
        </p>
      </div>
      <span className="sr-only">Tu turno quedó confirmado</span>
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
        /* Dos capas: el brillo interno (degradado de arriba al medio) sobre el
           relleno translúcido. Es lo que le da CANTO al panel; con relleno
           parejo se lee como un rectángulo pintado, no como vidrio. */
        background:
          linear-gradient(180deg, var(--t-glass-sheen) 0%, transparent 52%),
          var(--t-glass-bg);
        border: 1px solid var(--t-glass-border);
        /* El rim interior es la mitad del efecto "vidrio grueso": una línea de
           luz por dentro del borde arriba y una sombra por dentro abajo hacen
           que el panel se lea como un material con canto, no como un
           rectángulo pintado. */
        box-shadow:
          var(--t-glass-shadow),
          inset 0 1px 1px -1px var(--t-glass-highlight),
          inset 0 -1px 1px -1px rgba(0, 0, 0, 0.18);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        backdrop-filter: blur(20px) saturate(180%);
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

      /* ── Deriva del ambiente ───────────────────────────────────── */
      /* Sólo transform: el compositor la resuelve sin repintar la página. */
      @keyframes t-drift {
        0%   { transform: translate3d(0, 0, 0) scale(1); }
        50%  { transform: translate3d(-4%, 3%, 0) scale(1.08); }
        100% { transform: translate3d(0, 0, 0) scale(1); }
      }
      .t-drift {
        animation: t-drift 28s ease-in-out infinite;
        will-change: transform;
      }
      .t-drift-b { animation-duration: 34s; animation-direction: reverse; }
      .t-drift-c { animation-duration: 41s; animation-delay: -12s; }
      .t-drift-slow { animation: t-drift 46s ease-in-out infinite reverse; will-change: transform; }

      /* ── Entrada de una tarjeta que aparece sola ───────────────── */
      /* Distinta de .t-rise: ésta llega desde arriba y con un rebote corto,
         porque anuncia un RECONOCIMIENTO ("te encontramos"), no un ítem más
         de una lista. */
      @keyframes t-pop-in {
        0%   { opacity: 0; transform: translate3d(0, -8px, 0) scale(0.96); }
        70%  { opacity: 1; transform: translate3d(0, 2px, 0) scale(1.01); }
        100% { opacity: 1; transform: none; }
      }
      .t-pop-in { animation: t-pop-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both; }

      /* ── Hoja inferior (elegir barbero) ────────────────────────── */
      @keyframes t-veil-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes t-sheet-in {
        from { transform: translate3d(0, 100%, 0); }
        to   { transform: none; }
      }
      .t-veil { animation: t-veil-in 240ms ease both; }
      .t-sheet {
        animation: t-sheet-in 380ms cubic-bezier(0.22, 1, 0.36, 1) both;
        will-change: transform;
      }

      /* ── Confirmación en verde ─────────────────────────────────── */
      @keyframes t-go-fill {
        from { transform: scale(0); }
        to   { transform: scale(1); }
      }
      @keyframes t-go-hide {
        from { opacity: 1; }
        to   { opacity: 0; }
      }
      @keyframes t-go-ring {
        0%   { opacity: 0; transform: scale(0.5); }
        25%  { opacity: 0.5; }
        100% { opacity: 0; transform: scale(2.1); }
      }
      @keyframes t-go-text {
        from { opacity: 0; transform: translate3d(0, 12px, 0); }
        to   { opacity: 1; transform: none; }
      }
      .t-go-layer {
        /* El velo se va solo. El 'forwards' deja opacity 0 fijo, así que aunque
           el padre lo siguiera montando no volvería a taparle la pantalla al
           cliente. */
        animation: t-go-hide 460ms ease 1900ms forwards;
      }
      .t-go-fill {
        position: absolute;
        left: 50%;
        /* Nace donde estaba el botón de confirmar, abajo: el verde se lee como
           consecuencia del toque y no como una pantalla que apareció. */
        top: 62%;
        /* Dimensionado para que a escala 1 APENAS cubra la pantalla desde ese
           origen. Con un círculo enorme (280vmax) el barrido se completaba
           visualmente en el primer 20% de la animación y el efecto se leía como
           un flash: el resto del crecimiento pasaba fuera de la pantalla. */
        width: 150vmax;
        height: 150vmax;
        margin-left: -75vmax;
        margin-top: -75vmax;
        border-radius: 50%;
        background: radial-gradient(circle at 50% 46%, #1aa14c 0%, #15803d 42%, #0f6a33 100%);
        transform: scale(0);
        animation: t-go-fill 620ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
        will-change: transform;
      }
      .t-go-content { animation: t-go-text 420ms cubic-bezier(0.22, 1, 0.36, 1) 340ms both; }
      .t-go-text { animation: t-go-text 460ms cubic-bezier(0.22, 1, 0.36, 1) 620ms both; }
      .t-go-ring {
        background: radial-gradient(circle, rgba(255,255,255,0.55), transparent 66%);
        animation: t-go-ring 1500ms ease-out 520ms infinite;
      }
      .t-go-ring-b { animation-delay: 1000ms; }
      /* 38 ≈ el largo real del trazo del tilde en el viewBox de 64. */
      .t-go-tick {
        stroke-dasharray: 38;
        stroke-dashoffset: 38;
        animation: t-draw 420ms cubic-bezier(0.65, 0, 0.35, 1) 560ms forwards;
      }

      /* ── Sin animación ─────────────────────────────────────────── */
      /* El estado final tiene que quedar VISIBLE: apagar una animación con
         fill-mode "both" deja el elemento en su estado natural, pero el trazo
         del tilde vive en el dasharray y sin esto quedaría dibujado a medias. */
      @media (prefers-reduced-motion: reduce) {
        .t-step,
        .t-rise,
        .t-pop-in,
        .t-check-shell,
        .t-check-ring,
        .t-check-tick,
        .t-sheen::after,
        .t-skel::after,
        .t-drift,
        .t-drift-slow,
        .t-sheet,
        .t-veil,
        .t-go-content,
        .t-go-text,
        .t-go-ring,
        .t-go-tick {
          animation: none !important;
        }
        .t-check-halo { animation: none !important; opacity: 0; }
        .t-check-ring, .t-check-tick { stroke-dashoffset: 0; }
        .t-go-ring { opacity: 0; }
        .t-go-tick { stroke-dashoffset: 0; }
        /* El verde igual tiene que TAPAR la pantalla y después irse: sin el
           relleno a escala 1 quedaría un círculo de tamaño cero y el cliente no
           vería ninguna confirmación. Lo que se apaga es el movimiento, no el
           estado. */
        .t-go-fill { animation: none !important; transform: scale(1); }
        .t-go-layer { animation: t-go-hide 300ms linear 1500ms forwards; }
        .t-glass-int { transition: none; }
        .t-glass-int:hover { transform: none; }
      }
    `}</style>
  )
}
