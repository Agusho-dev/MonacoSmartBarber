'use client'

// El Lienzo: un informe, una tabla o un gráfico abiertos en grande.
//
//   variante 'columna'  Sólo el contenido (encabezado fijo + cuerpo con scroll),
//                       a todo el alto de su contenedor. La página de Tex lo
//                       pone en su columna derecha de 520 px desde 1280 px de
//                       ancho (el borde y el lugar los pone la página). No es
//                       modal: el chat se sigue usando al lado.
//   variante 'hoja'     (por defecto) Un Sheet: derecha de 520 px desde 640 px
//                       de ancho; en el celular, desde abajo a pantalla completa.
//
// El informe se lee en orden de lectura de un dueño: cifras, síntesis (la
// conclusión), gráficos y tablas como respaldo. Descargar y Compartir arriba en
// la compu; en el celular, abajo, donde llega el pulgar.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChartColumnBig, Download, FileCheck2, FileText, Loader2, Share2, Table2, X } from 'lucide-react'
import type { TexGrafico, TexInforme, TexTabla } from '@/lib/tex/contrato'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { TexGraficoBloque } from './tex-grafico'
import { TexKpis } from './tex-kpis'
import { TexMarkdown } from './tex-markdown'
import { TexTablaBloque } from './tex-tabla'
import { useInformePdf } from './use-informe-pdf'

/** Lo que se puede abrir en grande en el Lienzo (panel derecho / pantalla completa en el celular). */
export type ContenidoLienzo =
  | { tipo: 'informe'; informe: TexInforme }
  | { tipo: 'tabla'; tabla: TexTabla }
  | { tipo: 'grafico'; grafico: TexGrafico }

export type VarianteLienzo = 'columna' | 'hoja'

export interface TexLienzoProps {
  contenido: ContenidoLienzo | null
  onCerrar: () => void
  orgNombre?: string
  /** 'hoja' (por defecto): Sheet. 'columna': sólo el contenido, para la columna de 520 px de la página. */
  variante?: VarianteLienzo
  className?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Ayudas
// ─────────────────────────────────────────────────────────────────────────────

// Una función de suscripción por consulta (estable): si cambiara en cada
// render, useSyncExternalStore se volvería a suscribir cada vez.
const suscripciones = new Map<string, (avisar: () => void) => () => void>()

function suscribirMedia(consulta: string): (avisar: () => void) => () => void {
  let s = suscripciones.get(consulta)
  if (!s) {
    s = (avisar: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const mq = window.matchMedia(consulta)
      mq.addEventListener('change', avisar)
      return () => mq.removeEventListener('change', avisar)
    }
    suscripciones.set(consulta, s)
  }
  return s
}

function useMedia(consulta: string, enServidor = false): boolean {
  return useSyncExternalStore(
    suscribirMedia(consulta),
    () => typeof window.matchMedia === 'function' && window.matchMedia(consulta).matches,
    () => enServidor,
  )
}

/**
 * ¿Va el Lienzo como columna? true desde 1280 px de ancho de ventana (la regla
 * de la pantalla de Tex). Para que la página decida entre `variante='columna'`
 * y `variante='hoja'` con la misma vara.
 */
export function useLienzoComoColumna(): boolean {
  return useMedia('(min-width: 1280px)')
}

function tituloDe(c: ContenidoLienzo): string {
  if (c.tipo === 'informe') return c.informe.titulo || 'Informe'
  if (c.tipo === 'tabla') return c.tabla.titulo || 'Tabla'
  return c.grafico.titulo || 'Gráfico'
}

/**
 * El encabezado del Lienzo es el marco: dice qué es ("Informe", "Tabla",
 * "Gráfico") y lleva las acciones. El título entero (la conclusión) va en el
 * cuerpo: en el encabezado, al lado de los botones, se cortaba con "…".
 */
function etiquetaDe(c: ContenidoLienzo): string {
  if (c.tipo === 'informe') return 'Informe'
  if (c.tipo === 'tabla') return 'Tabla'
  return 'Gráfico'
}

function subtituloDe(c: ContenidoLienzo): string {
  if (c.tipo === 'informe') return 'Listo para mandar'
  if (c.tipo === 'tabla') {
    const n = Array.isArray(c.tabla.filas) ? c.tabla.filas.length : 0
    return `${n.toLocaleString('es-AR')} ${n === 1 ? 'fila' : 'filas'}`
  }
  return c.grafico.tipo === 'torta' ? 'Partes de un total' : 'Toca un punto o una barra para ver la cifra'
}

/** Clave estable del contenido: al abrir otro, el cuerpo arranca arriba y se resetea su estado. */
function claveDe(c: ContenidoLienzo): string {
  const texto = JSON.stringify(c)
  let h = 5381
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0
  return `${c.tipo}:${(h >>> 0).toString(36)}`
}

const BOTON =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0'
const PRINCIPAL = 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90'
const SECUNDARIO = 'border-border bg-white/[0.03] text-foreground hover:bg-white/[0.07]'

// ─────────────────────────────────────────────────────────────────────────────
// Acciones del informe (las mismas que la tarjeta)
// ─────────────────────────────────────────────────────────────────────────────

function AccionesInforme({ informe, orgNombre, enBarra }: { informe: TexInforme; orgNombre?: string; enBarra: boolean }) {
  const pdf = useInformePdf(informe, orgNombre)
  return (
    <div className={cn('flex items-center gap-2', enBarra && 'w-full')} onPointerEnter={pdf.preparar} onFocusCapture={pdf.preparar}>
      {enBarra ? (
        <>
          <button type="button" onClick={pdf.compartir} disabled={pdf.ocupado != null} aria-busy={pdf.ocupado === 'compartir'} className={cn(BOTON, PRINCIPAL, 'h-11 flex-1')}>
            {pdf.ocupado === 'compartir' ? <Loader2 className="animate-spin" aria-hidden /> : <Share2 aria-hidden />}
            Compartir
          </button>
          <button type="button" onClick={pdf.descargar} disabled={pdf.ocupado != null} aria-busy={pdf.ocupado === 'descargar'} className={cn(BOTON, SECUNDARIO, 'h-11 flex-1')}>
            {pdf.ocupado === 'descargar' ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            Descargar PDF
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={pdf.descargar} disabled={pdf.ocupado != null} aria-busy={pdf.ocupado === 'descargar'} className={cn(BOTON, PRINCIPAL)}>
            {pdf.ocupado === 'descargar' ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            Descargar PDF
          </button>
          <button
            type="button"
            onClick={pdf.compartir}
            disabled={pdf.ocupado != null}
            aria-busy={pdf.ocupado === 'compartir'}
            aria-label="Compartir"
            title="Compartir"
            className={cn(BOTON, SECUNDARIO, 'w-9 px-0')}
          >
            {pdf.ocupado === 'compartir' ? <Loader2 className="animate-spin" aria-hidden /> : <Share2 aria-hidden />}
          </button>
        </>
      )}
      <p className="sr-only" aria-live="polite">
        {pdf.ocupado ? 'Armando el PDF…' : ''}
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Cuerpos
// ─────────────────────────────────────────────────────────────────────────────

function CuerpoInforme({ informe }: { informe: TexInforme }) {
  const graficos = Array.isArray(informe.graficos) ? informe.graficos : []
  const tablas = Array.isArray(informe.tablas) ? informe.tablas : []
  const sintesis = typeof informe.sintesis === 'string' ? informe.sintesis.trim() : ''
  const subtitulo = [informe.periodo, informe.alcance].filter((x) => x && x.trim()).join(' · ')
  return (
    <div className="space-y-5">
      {/* El encabezado lo corta con "…" al lado de los botones: acá va entero, como en el PDF. */}
      <div>
        <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--tex-texto)]/25 bg-[color:var(--tex)]/10 px-2 py-0.5 text-[11px] font-medium text-[color:var(--tex-texto)]">
          <FileCheck2 className="size-3" aria-hidden />
          Listo
        </span>
        <h3 className="mt-2 text-[19px] leading-snug font-semibold text-pretty text-foreground">{informe.titulo}</h3>
        {subtitulo && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitulo}</p>}
      </div>
      <TexKpis items={informe.kpis} />
      {sintesis && (
        <section aria-label="Síntesis">
          <p className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Síntesis</p>
          <TexMarkdown texto={sintesis} />
        </section>
      )}
      {graficos.map((g, i) => (
        <TexGraficoBloque key={`g${i}`} grafico={g} variante="lienzo" />
      ))}
      {tablas.map((t, i) => (
        <TexTablaBloque key={`t${i}`} tabla={t} modo="completa" claseScroll="max-h-[min(60vh,520px)]" />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// El panel (encabezado + cuerpo + barra de acciones en el celular)
// ─────────────────────────────────────────────────────────────────────────────

interface PropsPanel {
  contenido: ContenidoLienzo
  onCerrar: () => void
  orgNombre?: string
  enHoja: boolean
  className?: string
}

function IconoDe({ tipo }: { tipo: ContenidoLienzo['tipo'] }) {
  const Icono = tipo === 'informe' ? FileText : tipo === 'tabla' ? Table2 : ChartColumnBig
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-zinc-300" aria-hidden>
      <Icono className="size-4" />
    </span>
  )
}

function PanelLienzo({ contenido, onCerrar, orgNombre, enHoja, className }: PropsPanel) {
  const titulo = tituloDe(contenido)
  const tituloRef = useRef<HTMLHeadingElement>(null)
  const clave = claveDe(contenido)

  // Como columna (no modal): al abrir, el foco va al título del Lienzo; al
  // cerrar, vuelve a lo que lo abrió ("Ampliar", "Ver"). En la hoja eso lo hace Radix.
  useEffect(() => {
    if (enHoja) return
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    tituloRef.current?.focus({ preventScroll: true })
    return () => {
      if (previo && document.contains(previo)) previo.focus({ preventScroll: true })
    }
  }, [clave, enHoja])

  const esInforme = contenido.tipo === 'informe'

  return (
    <section
      aria-label={`Lienzo: ${titulo}`}
      onKeyDown={(e) => {
        if (enHoja || e.key !== 'Escape' || e.defaultPrevented) return
        e.stopPropagation()
        onCerrar()
      }}
      // flex-1 además de h-full: la página lo monta dentro de un <aside> flex en columna.
      className={cn('flex h-full min-h-0 flex-1 flex-col bg-background', className)}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:pt-3">
        <IconoDe tipo={contenido.tipo} />
        <div className="min-w-0 flex-1">
          {enHoja ? (
            <SheetTitle className="truncate text-[15px] leading-5 font-semibold">
              {etiquetaDe(contenido)}
              <span className="sr-only">: {titulo}</span>
            </SheetTitle>
          ) : (
            <h2 ref={tituloRef} tabIndex={-1} className="truncate text-[15px] leading-5 font-semibold text-foreground outline-none">
              {etiquetaDe(contenido)}
              <span className="sr-only">: {titulo}</span>
            </h2>
          )}
          <p className="truncate text-[12px] leading-4 text-muted-foreground">{subtituloDe(contenido)}</p>
        </div>
        {esInforme && (
          <div className="hidden sm:block">
            <AccionesInforme informe={contenido.informe} orgNombre={orgNombre} enBarra={false} />
          </div>
        )}
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="-mr-1.5 grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none"
        >
          <X className="size-5" aria-hidden />
        </button>
      </header>

      <div
        key={clave}
        className={cn(
          '@container min-h-0 flex-1 overscroll-contain px-4 py-4',
          contenido.tipo === 'tabla' ? 'flex flex-col' : 'overflow-y-auto',
        )}
      >
        {contenido.tipo === 'informe' && <CuerpoInforme informe={contenido.informe} />}
        {contenido.tipo === 'tabla' && (
          <TexTablaBloque
            tabla={contenido.tabla}
            modo="completa"
            className="flex min-h-0 flex-1 flex-col [&>h3]:text-[17px] [&>h3]:leading-snug"
            claseScroll="min-h-0"
          />
        )}
        {contenido.tipo === 'grafico' && <TexGraficoBloque grafico={contenido.grafico} variante="ampliado" />}
      </div>

      {esInforme && (
        <footer className="shrink-0 border-t border-border bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
          <AccionesInforme informe={contenido.informe} orgNombre={orgNombre} enBarra />
        </footer>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TexLienzo
// ─────────────────────────────────────────────────────────────────────────────

function HojaLienzo({ contenido, onCerrar, orgNombre, className }: Omit<TexLienzoProps, 'variante'>) {
  const desdeAbajo = useMedia('(max-width: 639.98px)', true)
  // Mientras la hoja sale (220 ms), el contenido que tenía se sigue viendo:
  // sin esto se desliza vacía.
  const [ultimo, setUltimo] = useState<ContenidoLienzo | null>(contenido)
  if (contenido !== null && contenido !== ultimo) setUltimo(contenido)
  const mostrado = contenido ?? ultimo

  return (
    <Sheet
      open={contenido !== null}
      onOpenChange={(abierto) => {
        if (!abierto) onCerrar()
      }}
    >
      <SheetContent
        side={desdeAbajo ? 'bottom' : 'right'}
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn(
          'gap-0 p-0',
          desdeAbajo
            ? 'h-[100dvh] max-h-[100dvh] border-t-0 data-[state=closed]:duration-[220ms] data-[state=open]:duration-[320ms]'
            : 'w-full data-[state=closed]:duration-200 data-[state=open]:duration-[260ms] sm:max-w-[520px]',
          className,
        )}
      >
        {mostrado && <PanelLienzo contenido={mostrado} onCerrar={onCerrar} orgNombre={orgNombre} enHoja />}
      </SheetContent>
    </Sheet>
  )
}

export function TexLienzo({ contenido, onCerrar, orgNombre, variante = 'hoja', className }: TexLienzoProps) {
  if (variante === 'columna') {
    if (!contenido) return null
    return <PanelLienzo contenido={contenido} onCerrar={onCerrar} orgNombre={orgNombre} enHoja={false} className={className} />
  }
  return <HojaLienzo contenido={contenido} onCerrar={onCerrar} orgNombre={orgNombre} className={className} />
}
