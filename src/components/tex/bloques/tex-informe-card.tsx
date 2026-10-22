'use client'

// La tarjeta del informe en el chat: lo que el dueño va a mandar al contador o
// por WhatsApp. Sello "Listo" (no un trofeo: un informe listo no es un logro),
// tres cifras, una miniatura A4 que se parece al PDF de verdad y las acciones.
// Descargar es la principal en la compu; Compartir, en el celular.

import { memo } from 'react'
import { Download, Eye, FileCheck2, Loader2, Share2 } from 'lucide-react'
import type { TexInforme } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { igualesProfundo } from './formato'
import { useInformePdf } from './use-informe-pdf'

export interface PropsTexInformeCard {
  informe: TexInforme
  orgNombre?: string
  compacto?: boolean
  /** Abre el informe completo en el Lienzo. Sin esto, no hay "Ver". */
  onVer?: () => void
  className?: string
}

/** Parte un título en hasta dos renglones de ~n caracteres (para la miniatura). */
function renglones(texto: string, n: number): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean)
  const lineas: string[] = []
  let actual = ''
  for (const p of palabras) {
    if ((actual + ' ' + p).trim().length > n && actual) {
      lineas.push(actual)
      actual = p
      if (lineas.length === 2) break
    } else actual = (actual + ' ' + p).trim()
  }
  if (lineas.length < 2 && actual) lineas.push(actual)
  if (lineas.length === 2 && palabras.join(' ').length > lineas.join(' ').length) lineas[1] = lineas[1].replace(/\s*\S*$/, '') + '…'
  return lineas.slice(0, 2)
}

/** La hoja A4 en miniatura (1:1,414): misma estructura que el PDF (banda, cifras, gráfico, texto). */
export function MiniaturaA4({ titulo, className }: { titulo: string; className?: string }) {
  const lineas = renglones(titulo, 22)
  return (
    <svg
      viewBox="0 0 100 141.4"
      aria-hidden
      className={cn('block h-auto shrink-0 overflow-hidden rounded-[5px] shadow-[0_8px_20px_-8px_rgba(0,0,0,0.8)] ring-1 ring-white/10', className)}
    >
      <rect width="100" height="141.4" fill="#f5f5f5" />
      <rect width="100" height="24" fill="#0a0a0a" />
      {lineas.map((l, i) => (
        <text key={i} x="8" y={lineas.length === 1 ? 12.5 : 10 + i * 6.2} fontSize="5.4" fontWeight="700" fill="#ffffff">
          {l}
        </text>
      ))}
      <rect x="8" y="17.6" width="30" height="1.5" rx="0.75" fill="#7a7a7a" />
      <rect x="74" y="7.6" width="18" height="1.8" rx="0.9" fill="#d4a73a" />
      {[8, 36.7, 65.4].map((x) => (
        <g key={x}>
          <rect x={x} y="29.5" width="26.6" height="13" rx="1.6" fill="#ffffff" stroke="#e4e4e7" strokeWidth="0.4" />
          <rect x={x + 2.4} y="32.4" width="12" height="1.3" rx="0.65" fill="#a1a1aa" />
          <rect x={x + 2.4} y="36.2" width="17" height="2.6" rx="1.3" fill="#27272a" />
        </g>
      ))}
      <rect x="8" y="48" width="84" height="33" rx="1.8" fill="#ffffff" stroke="#e4e4e7" strokeWidth="0.4" />
      {[13, 20, 9, 24, 18, 21].map((h, i) => (
        <rect key={i} x={15 + i * 12.4} y={76 - h} width="7" height={h} fill={i === 3 ? '#2b8fe6' : '#a1a1aa'} />
      ))}
      {[84, 79, 84, 58].map((w, i) => (
        <rect key={i} x="8" y={88 + i * 5} width={w} height="1.7" rx="0.85" fill="#d4d4d8" />
      ))}
      <rect x="8" y="111" width="84" height="4.2" fill="#1e1e1e" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x="8" y={116 + i * 4.6} width="84" height="4.6" fill={i % 2 ? '#ffffff' : '#ededed'} />
      ))}
    </svg>
  )
}

/**
 * En el celular, cuando la tarjeta se ve, el PDF se arma en segundo plano:
 * Web Share sólo abre la hoja si se llama cerca del toque, y armar el PDF en
 * un teléfono lento puede pasarse de esa ventana. En la compu no hace falta.
 */
function refQuePreparaAlVer(preparar: () => void) {
  return (nodo: HTMLElement | null) => {
    if (!nodo || typeof IntersectionObserver === 'undefined' || typeof window.matchMedia !== 'function') return
    if (!window.matchMedia('(pointer: coarse)').matches || typeof navigator.canShare !== 'function') return
    let espera: ReturnType<typeof setTimeout> | undefined
    const observador = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return
        observador.disconnect()
        espera = setTimeout(preparar, 400)
      },
      { threshold: 0.5 },
    )
    observador.observe(nodo)
    return () => {
      observador.disconnect()
      if (espera) clearTimeout(espera)
    }
  }
}

// Mismo tamaño de botón siempre; lo que cambia con el ancho es cuál es el principal.
const BOTON =
  'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none disabled:opacity-60 sm:h-9 [&_svg]:size-4 [&_svg]:shrink-0'
const SECUNDARIO = 'border-border bg-white/[0.03] text-foreground hover:bg-white/[0.07]'
/** Principal en el celular, secundario en la compu. */
const PRINCIPAL_EN_CELULAR =
  'border-transparent bg-primary text-primary-foreground hover:bg-primary/90 sm:border-border sm:bg-white/[0.03] sm:text-foreground sm:hover:bg-white/[0.07]'
/** Secundario en el celular, principal en la compu. */
const PRINCIPAL_EN_COMPU =
  'border-border bg-white/[0.03] text-foreground hover:bg-white/[0.07] sm:border-transparent sm:bg-primary sm:text-primary-foreground sm:hover:bg-primary/90'

function TexInformeCardBase({ informe, orgNombre, compacto = false, onVer, className }: PropsTexInformeCard) {
  const pdf = useInformePdf(informe, orgNombre)
  const refVisible = refQuePreparaAlVer(pdf.preparar)
  const subtitulo = [informe.periodo, informe.alcance].filter((x) => x && x.trim()).join(' · ')
  const kpis = (Array.isArray(informe.kpis) ? informe.kpis : []).filter((k) => k && k.valor).slice(0, 3)
  const ocupadoDescargar = pdf.ocupado === 'descargar'
  const ocupadoCompartir = pdf.ocupado === 'compartir'

  return (
    <article
      ref={refVisible}
      className={cn('@container min-w-0 rounded-2xl border border-border bg-card p-3.5 @md:p-4', className)}
      aria-label={`Informe: ${informe.titulo}`}
    >
      <div className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5', !compacto && '@lg:gap-x-5')}>
        <MiniaturaA4 titulo={informe.titulo} className={cn('w-14', !compacto && '@lg:row-span-3 @lg:w-[92px]')} />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--tex-texto)]/25 bg-[color:var(--tex)]/10 px-2 py-0.5 text-[11px] font-medium text-[color:var(--tex-texto)]">
              <FileCheck2 className="size-3" aria-hidden />
              Listo
            </span>
            <span className="text-[11px] text-muted-foreground">Informe en PDF</span>
          </div>
          <h3 className="mt-1.5 line-clamp-3 text-[15px] leading-snug font-semibold text-pretty text-foreground @md:text-[16px]">
            {informe.titulo}
          </h3>
          {subtitulo && <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{subtitulo}</p>}
        </div>

        {kpis.length > 0 && (
          <dl className={cn('col-span-2 mt-3 grid grid-cols-3 gap-1.5', !compacto && '@lg:col-span-1')}>
            {kpis.map((k, i) => (
              <div key={i} className="@container min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                <dt className="truncate text-[10.5px] leading-4 text-muted-foreground" title={k.etiqueta}>
                  {k.etiqueta}
                </dt>
                {/* Del ancho de su cajita: en 390 px, "$18.420.300" se achica en vez de pisar la de al lado. */}
                <dd
                  className="mt-0.5 font-mono leading-5 font-semibold whitespace-nowrap text-foreground tabular-nums"
                  style={{ fontSize: `clamp(11px, calc(100cqi / ${(Math.max(6, k.valor.length) * 0.62).toFixed(2)}), 15px)` }}
                >
                  {k.valor}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div
          className={cn('col-span-2 mt-3 flex flex-wrap gap-2', !compacto && '@lg:col-span-1')}
          onPointerEnter={pdf.preparar}
          onFocusCapture={pdf.preparar}
        >
          <button
            type="button"
            onClick={pdf.compartir}
            disabled={pdf.ocupado != null}
            aria-busy={ocupadoCompartir}
            className={cn(BOTON, PRINCIPAL_EN_CELULAR, 'order-1 flex-1 sm:order-3 sm:flex-none')}
          >
            {ocupadoCompartir ? <Loader2 className="animate-spin" aria-hidden /> : <Share2 aria-hidden />}
            Compartir
          </button>
          <button
            type="button"
            onClick={pdf.descargar}
            disabled={pdf.ocupado != null}
            aria-busy={ocupadoDescargar}
            aria-label="Descargar PDF"
            className={cn(BOTON, PRINCIPAL_EN_COMPU, 'order-2 sm:order-1')}
          >
            {ocupadoDescargar ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            <span className="sm:hidden">PDF</span>
            <span className="hidden sm:inline">Descargar PDF</span>
          </button>
          {onVer && (
            <button type="button" onClick={onVer} className={cn(BOTON, SECUNDARIO, 'order-3 sm:order-2')}>
              <Eye aria-hidden />
              Ver
            </button>
          )}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {pdf.ocupado ? 'Armando el PDF…' : ''}
      </p>
    </article>
  )
}

/** Comparada por contenido (el stream clona el mensaje en cada chunk). `onVer` se compara por presencia. */
export const TexInformeCard = memo(
  TexInformeCardBase,
  (a, b) =>
    a.orgNombre === b.orgNombre &&
    a.compacto === b.compacto &&
    a.className === b.className &&
    !!a.onVer === !!b.onVer &&
    igualesProfundo(a.informe, b.informe),
)
