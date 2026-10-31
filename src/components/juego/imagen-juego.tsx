'use client'

import Image from 'next/image'
import { createContext, use, useState, useSyncExternalStore } from 'react'

/**
 * Las rutas que se sabe que NO existen (en desarrollo, los sprites que todavía no llegaron;
 * ver src/app/juego/recursos-faltantes.ts): se dibuja la silueta sin pedir nada.
 */
export const RecursosFaltantes = createContext<ReadonlySet<string>>(new Set())

/** Las que fallaron en esta visita: las demás copias (grilla, duelo, HUD) no las vuelven a pedir. */
const fallidas = new Set<string>()

// ─── Imágenes ya bajadas, en memoria ─────────────────────────────────────────
//
// Los retratos, caras y arenas van con `Cache-Control: max-age=0, must-revalidate` (next.config.ts:
// un atlas nuevo nunca convive con una imagen vieja del caché). El costo: cada <img> que se monta
// —cada VS, cada resultado— revalida (un 304) ANTES de pintarse, y sin red no se pinta aunque los
// bytes estén en el caché (con la red trabada, el resultado online salía sin retrato ni fondo). La
// primera vez que una imagen carga se guarda su copia como object URL (blob:, sin red y sin
// revalidar): las siguientes veces de esta visita se dibuja de ahí, al instante. Los bytes salen del
// caché HTTP que la <img> acaba de llenar (`cache: 'force-cache'`), no de otra bajada.

/** Tope de lo que se guarda (bytes de los archivos; hoy todo el juego suma ≈ 2 MB de estas imágenes). */
const MAX_BYTES_EN_MEMORIA = 8 * 1024 * 1024

const enMemoria = new Map<string, { url: string; bytes: number }>()
let bytesEnMemoria = 0
const pidiendo = new Set<string>()

/** La copia en memoria de `ruta` (el src que se le pasa a la imagen, sin `?dpl=`), o null. */
function copiaDe(ruta: string | null): string | null {
  return ruta ? (enMemoria.get(ruta)?.url ?? null) : null
}

function olvidar(ruta: string): void {
  const c = enMemoria.get(ruta)
  if (!c) return
  enMemoria.delete(ruta)
  bytesEnMemoria -= c.bytes
  try {
    URL.revokeObjectURL(c.url)
  } catch {
    // nada
  }
}

/**
 * Guarda la copia de una imagen que ya cargó. `pedida` es la URL que bajó la <img> (con el `?dpl=`
 * de Vercel): con esa misma URL el caché HTTP la tiene y `force-cache` la devuelve sin ir a la red.
 * Sólo del mismo origen; si algo falla, no pasa nada (la próxima vez revalida, como antes).
 */
function memorizar(ruta: string, pedida: string): void {
  if (enMemoria.has(ruta) || pidiendo.has(ruta)) return
  if (typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') return
  let url: URL
  try {
    url = new URL(pedida, location.href)
  } catch {
    return
  }
  if (url.origin !== location.origin) return
  pidiendo.add(ruta)
  fetch(url.href, { cache: 'force-cache', credentials: 'same-origin' })
    .then((r) => (r.ok ? r.blob() : null))
    .then((blob) => {
      if (!blob || blob.size === 0 || !blob.type.startsWith('image/') || enMemoria.has(ruta)) return
      enMemoria.set(ruta, { url: URL.createObjectURL(blob), bytes: blob.size })
      bytesEnMemoria += blob.size
      // Las más viejas primero (nunca la recién guardada).
      for (const vieja of enMemoria.keys()) {
        if (bytesEnMemoria <= MAX_BYTES_EN_MEMORIA || vieja === ruta) break
        olvidar(vieja)
      }
    })
    .catch(() => undefined)
    .finally(() => pidiendo.delete(ruta))
}

/** Nadie avisa cuando llega una copia: la imagen la toma en su próximo montaje (o render). */
const sinAvisos = () => () => {}

type Tipo = 'cuerpo' | 'cara' | 'arena'

interface Props {
  src: string | null
  alt: string
  tipo: Tipo
  /** Acento del personaje para la silueta de reserva. */
  color?: string
  className?: string
  prioridad?: boolean
  /** Dar vuelta horizontal (el de la izquierda mira hacia el centro). */
  espejar?: boolean
  posicion?: string
  /** Otra imagen antes de la silueta (el retrato pelado que falta → el retrato de siempre). */
  alternativa?: string | null
}

/**
 * Imagen del juego (retrato, cara o arena) con reserva: si el archivo todavía no existe
 * o no carga, se dibuja una silueta con el color del personaje en vez de un ícono roto.
 * Sin optimizador de Next: el pixel art se ve tal cual. Lo ya bajado en la visita se dibuja de
 * memoria, sin red (ver arriba).
 */
export function ImagenJuego({
  src: pedida,
  alt,
  tipo,
  color = '#8a8f99',
  className,
  prioridad,
  espejar,
  posicion,
  alternativa = null,
}: Props) {
  const [fallida, setFallida] = useState<string | null>(null)
  const [, setRevision] = useState(0)
  const faltantes = use(RecursosFaltantes)
  const sirve = (ruta: string | null): ruta is string =>
    !!ruta && fallida !== ruta && !faltantes.has(ruta) && !fallidas.has(ruta)
  const src = sirve(pedida) ? pedida : sirve(alternativa) ? alternativa : null
  // Al hidratar, lo mismo que el servidor (sin copia): la copia entra en el render siguiente.
  const copia = useSyncExternalStore(sinAvisos, () => copiaDe(src), () => null)
  if (!src) {
    return <Silueta tipo={tipo} color={color} className={className} espejar={espejar} />
  }
  return (
    <Image
      src={copia ?? src}
      alt={alt}
      fill
      unoptimized
      draggable={false}
      loading={prioridad ? 'eager' : 'lazy'}
      className={className}
      sizes="100vw"
      style={{
        objectFit: tipo === 'arena' ? 'cover' : 'contain',
        objectPosition: posicion ?? (tipo === 'cuerpo' ? 'center bottom' : 'center'),
        transform: espejar ? 'scaleX(-1)' : undefined,
      }}
      onLoad={(e) => {
        if (!copia) memorizar(src, e.currentTarget.currentSrc || e.currentTarget.src)
      }}
      onError={() => {
        if (copia) {
          // La copia en memoria no sirvió (no debería pasar): se olvida y se vuelve a la red.
          olvidar(src)
          setRevision((n) => n + 1)
          return
        }
        fallidas.add(src)
        setFallida(src)
      }}
    />
  )
}

function Silueta({ tipo, color, className, espejar }: { tipo: Tipo; color: string; className?: string; espejar?: boolean }) {
  const estilo = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    transform: espejar ? 'scaleX(-1)' : undefined,
  } as const
  if (tipo === 'arena') {
    return (
      <svg className={className} style={estilo} viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="160" height="90" fill="#141419" />
        <rect y="62" width="160" height="28" fill="#1e1d22" />
        <path d="M0 62 H160" stroke="#3a3842" strokeWidth="1" />
        <path d="M20 10 h120" stroke="#f5b301" strokeOpacity=".35" strokeWidth="2" />
        <path d="M74 26 l6 -8 6 8 6 -8 6 8" stroke="#ffffff" strokeOpacity=".35" strokeWidth="2" fill="none" />
      </svg>
    )
  }
  if (tipo === 'cara') {
    return (
      <svg className={className} style={estilo} viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="40" r="22" fill={color} fillOpacity=".55" />
        <path d="M12 100 C16 72 33 64 50 64 C67 64 84 72 88 100 Z" fill={color} fillOpacity=".4" />
      </svg>
    )
  }
  return (
    <svg
      className={className}
      style={estilo}
      viewBox="0 0 120 280"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
    >
      <circle cx="60" cy="30" r="22" fill={color} fillOpacity=".5" />
      <path
        d="M33 60 h54 l15 72 -12 5 -9 -40 v76 l7 102 h-20 l-8 -90 h-0 l-8 90 h-20 l7 -102 v-76 l-9 40 -12 -5 z"
        fill={color}
        fillOpacity=".38"
      />
    </svg>
  )
}
