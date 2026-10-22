'use client'

// =============================================================================
// Los bloques visuales de una respuesta de Tex: KPIs, gráficos, tablas, la
// tarjeta del informe, el veredicto de la conciliación, sucursales y avisos.
// Cada herramienta devuelve un `TexSalidaUI` (src/lib/tex/contrato.ts) y el
// chat lo dibuja con <TexBloques salida={part.output} />.
//
// Reglas que valen para todos:
//   - Los datos protagonizan: Tex no aparece en ningún bloque.
//   - "No pude leer" se dice (tarjeta roja), nunca se muestra como un cero.
//   - Cada respuesta con cifras lleva su fuente ("Fuente: Finanzas · …") y, si
//     hay, el enlace a la pantalla con los mismos filtros.
//   - Fondo SIEMPRE oscuro, colores directos (`dark:` no funciona en esta app).
//
// Rendimiento: en cada chunk del stream el mensaje llega clonado entero. Cada
// bloque se compara por contenido (memo + igualesProfundo) y no se vuelve a
// dibujar si no cambió; `onAbrirLienzo` se lee de un ref, así un callback
// nuevo del padre no obliga a redibujar.
//
// Uso:
//   <TexBloques salida={salida} orgNombre="Monaco" onAbrirLienzo={setLienzo} />
//   <TexLienzo contenido={lienzo} onCerrar={() => setLienzo(null)} orgNombre="Monaco"
//              variante={useLienzoComoColumna() ? 'columna' : 'hoja'} />
// =============================================================================

import { useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { TexBloque, TexSalidaUI } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { enlaceSeguro, textoFuente } from './formato'
import { LimiteDeError } from './limite-de-error'
import { TexAviso, TexNoPudeLeer } from './tex-aviso'
import { TexGraficoBloque } from './tex-grafico'
import { TexInformeCard } from './tex-informe-card'
import { TexKpis } from './tex-kpis'
import type { ContenidoLienzo } from './tex-lienzo'
import { TexSucursales } from './tex-sucursales'
import { TexTablaBloque } from './tex-tabla'
import { TexVeredictoMini } from './tex-veredicto-mini'

export { TexLienzo, useLienzoComoColumna } from './tex-lienzo'
export type { ContenidoLienzo, TexLienzoProps, VarianteLienzo } from './tex-lienzo'
export { TexKpis } from './tex-kpis'
export { TexGraficoBloque } from './tex-grafico'
export type { PropsTexGrafico, VarianteGrafico } from './tex-grafico'
export { TexTablaBloque } from './tex-tabla'
export type { PropsTexTabla } from './tex-tabla'
export { TexInformeCard, MiniaturaA4 } from './tex-informe-card'
export { TexVeredictoMini } from './tex-veredicto-mini'
export { TexAviso, TexNoPudeLeer } from './tex-aviso'
export { TexSucursales } from './tex-sucursales'
export { TexMarkdown } from './tex-markdown'

export interface TexBloquesProps {
  salida: TexSalidaUI
  orgNombre?: string
  /** Abre el contenido en el Lienzo. Sin él, "Ver completo" no se ofrece. */
  onAbrirLienzo?: (contenido: ContenidoLienzo) => void
  /** Variante chica para el panel lateral (420 px). */
  compacto?: boolean
  /** Clases del contenedor (el margen respecto del texto lo decide el chat). */
  className?: string
}

interface PropsBloque {
  bloque: TexBloque
  compacto: boolean
  orgNombre?: string
  abrir: ((c: ContenidoLienzo) => void) | null
}

function Bloque({ bloque: b, compacto, orgNombre, abrir }: PropsBloque) {
  switch (b?.tipo) {
    case 'kpis':
      return <TexKpis items={b.items} titulo={b.titulo} compacto={compacto} />
    case 'grafico':
      return (
        <TexGraficoBloque
          grafico={b.grafico}
          compacto={compacto}
          onAmpliar={abrir ? () => abrir({ tipo: 'grafico', grafico: b.grafico }) : undefined}
        />
      )
    case 'tabla':
      return (
        <TexTablaBloque
          tabla={b.tabla}
          compacto={compacto}
          onVerTodas={abrir ? () => abrir({ tipo: 'tabla', tabla: b.tabla }) : undefined}
        />
      )
    case 'informe':
      return (
        <TexInformeCard
          informe={b.informe}
          orgNombre={orgNombre}
          compacto={compacto}
          onVer={abrir ? () => abrir({ tipo: 'informe', informe: b.informe }) : undefined}
        />
      )
    case 'conciliacion':
      return <TexVeredictoMini veredicto={b.veredicto} compacto={compacto} />
    case 'sucursales':
      return <TexSucursales items={b.items} />
    case 'aviso':
      return <TexAviso tono={b.tono} texto={b.texto} />
    default:
      // Un tipo que esta versión no conoce (un bundle viejo con un servidor nuevo): se omite.
      return null
  }
}

export function TexBloques({ salida, orgNombre, onAbrirLienzo, compacto = false, className }: TexBloquesProps) {
  // El callback del padre puede ser nuevo en cada render; los bloques reciben
  // uno estable que llama al último.
  const abrirRef = useRef(onAbrirLienzo)
  useEffect(() => {
    abrirRef.current = onAbrirLienzo
  })
  const abrirEstable = useCallback((c: ContenidoLienzo) => abrirRef.current?.(c), [])
  const abrir = typeof onAbrirLienzo === 'function' ? abrirEstable : null

  const bloques = Array.isArray(salida?.bloques) ? salida.bloques : []
  const error = typeof salida?.error === 'string' && salida.error.trim() ? salida.error.trim() : null
  const fuente = typeof salida?.fuente === 'string' && salida.fuente.trim() ? salida.fuente.trim() : null
  const destino = salida?.enlace ? enlaceSeguro(salida.enlace.href) : null
  const textoEnlace = salida?.enlace?.texto?.trim() || 'Ver en el panel'

  if (!error && bloques.length === 0 && !fuente && !destino) return null

  return (
    <div className={cn('@container min-w-0 space-y-3', className)}>
      {error && <TexNoPudeLeer error={error} />}
      {bloques.map((b, i) => (
        <LimiteDeError key={`${i}-${b?.tipo ?? 'x'}`}>
          <Bloque bloque={b} compacto={compacto} orgNombre={orgNombre} abrir={abrir} />
        </LimiteDeError>
      ))}
      {(fuente || destino) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {fuente && <p className="min-w-0 text-[11px] leading-4 text-muted-foreground">{textoFuente(fuente)}</p>}
          {destino &&
            (destino.interno ? (
              <Link
                href={destino.href}
                className="inline-flex min-h-8 items-center gap-0.5 rounded-md text-[12px] font-medium text-[color:var(--tex-texto)] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:outline-none"
              >
                {textoEnlace}
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            ) : (
              <a
                href={destino.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-8 items-center gap-0.5 rounded-md text-[12px] font-medium text-[color:var(--tex-texto)] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:outline-none"
              >
                {textoEnlace}
                <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            ))}
        </div>
      )}
    </div>
  )
}
