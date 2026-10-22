'use client'

// La cara de Tex: la voz. Va chica y animada donde se conversa (el composer,
// el encabezado, el lanzador). Tres cuadros apilados y precargados; el visible
// lo elige el atributo `data-cuadro`, que escriben un timer (parpadeo) y un
// requestAnimationFrame (habla) directo en el DOM: el stream trae ~20 cambios
// por segundo y no tiene sentido re-renderizar React por cada cuadro.
//
// Cuadros: 1 = ojos abiertos, sonrisa · 2 = ojos cerrados, boca chica · 3 = boca en "O".
//
// Cómo habla: un cursor "lee" el texto que va llegando a ~32 letras por
// segundo (y acelera si el stream se le adelanta). Cada ~100 ms mira la última
// letra leída: a/o/u abren la boca (3), e/i alternan, una consonante la cierra
// (1) y la puntuación cierra los ojos un instante (2), como una pausa. El
// markdown no se "pronuncia". Si el texto deja de crecer, la boca se cierra.

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { srcCara, srcSetCara, TEX_CARA_ASPECTO, type TexCuadro } from './assets'
import { useTexAnimacion } from './use-tex-animacion'

export type TexCaraEstado = 'reposo' | 'pensando' | 'hablando'

interface Props {
  /** Ancho en px. El alto sale del dibujo (1,41:1). */
  tamano?: number
  estado?: TexCaraEstado
  /** Lo que Tex está diciendo: crece con el stream y la boca lo va "leyendo". */
  texto?: string
  className?: string
  /** Con etiqueta la cara se anuncia (role img); sin ella es decorativa. */
  etiqueta?: string
}

const PARPADEO_MS = 120
const PARPADEO_MIN_MS = 3500
const PARPADEO_MAX_MS = 7000
const DOBLE_PARPADEO = 0.15
const CUADRO_MIN_MS = 95
const PAUSA_MS = 190
const SILENCIO_MS = 300
const LETRAS_POR_SEG = 32

const VOCAL_ABIERTA = /[aáàoóòuúùü]/i
const VOCAL_CERRADA = /[eéèiíì]/i
const PAUSA = /[.,;:!?¡¿\n]/
const MARKDOWN = /[#*_`|>~[\]()-]/g

const CUADROS: readonly TexCuadro[] = [1, 2, 3]

export function TexCara({ tamano = 40, estado = 'reposo', texto = '', className, etiqueta }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const textoRef = useRef(texto)
  const animacion = useTexAnimacion()
  const mueve = animacion === 'completa'

  useEffect(() => {
    textoRef.current = texto
  }, [texto])

  // Parpadeo (reposo y pensando). Se saltea con la pestaña oculta.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const poner = (c: TexCuadro) => {
      if (el.dataset.cuadro !== String(c)) el.dataset.cuadro = String(c)
    }
    poner(1)
    if (!mueve || estado === 'hablando') return

    let vivo = true
    const timers: number[] = []
    const despues = (fn: () => void, ms: number) => {
      timers.push(window.setTimeout(() => vivo && fn(), ms))
    }
    const parpadear = (luego: () => void) => {
      poner(2)
      despues(() => {
        poner(1)
        luego()
      }, PARPADEO_MS)
    }
    const programar = () => {
      const espera = PARPADEO_MIN_MS + Math.random() * (PARPADEO_MAX_MS - PARPADEO_MIN_MS)
      despues(() => {
        if (document.hidden) return programar()
        parpadear(() => {
          if (Math.random() < DOBLE_PARPADEO) despues(() => parpadear(programar), 140)
          else programar()
        })
      }, espera)
    }
    programar()
    return () => {
      vivo = false
      timers.forEach((t) => window.clearTimeout(t))
      poner(1)
    }
  }, [mueve, estado])

  // Habla sincronizada con el texto que llega.
  useEffect(() => {
    const el = ref.current
    if (!el || !mueve || estado !== 'hablando') return
    const poner = (c: TexCuadro) => {
      if (el.dataset.cuadro !== String(c)) el.dataset.cuadro = String(c)
    }

    let raf = 0
    // Arranca casi al día: si ya había texto, no lo "relee" entero.
    let visto = Math.max(0, textoRef.current.length - 24)
    let largoPrevio = textoRef.current.length
    let ultimoCrecimiento = performance.now()
    let ultimoCuadro = 0
    let pausaHasta = 0
    let alterna = false

    const tick = (ahora: number) => {
      const t = textoRef.current
      if (t.length < visto) visto = 0 // otro mensaje
      if (t.length !== largoPrevio) {
        largoPrevio = t.length
        ultimoCrecimiento = ahora
      }
      const pendiente = t.length - visto
      if (ahora >= pausaHasta && ahora - ultimoCuadro >= CUADRO_MIN_MS) {
        if (pendiente > 0) {
          const dt = ultimoCuadro === 0 ? CUADRO_MIN_MS : Math.min(ahora - ultimoCuadro, 250)
          let n = Math.max(1, Math.round((dt / 1000) * LETRAS_POR_SEG))
          if (pendiente > 120) n += Math.floor(pendiente / 30) // alcanzar al stream
          const tramo = t.slice(visto, visto + n)
          visto += tramo.length
          ultimoCuadro = ahora
          if (PAUSA.test(tramo)) {
            poner(2)
            pausaHasta = ahora + PAUSA_MS
          } else {
            const letras = tramo.replace(MARKDOWN, '').replace(/\s+/g, '')
            const ultima = letras.charAt(letras.length - 1)
            if (ultima) {
              if (VOCAL_ABIERTA.test(ultima)) poner(3)
              else if (VOCAL_CERRADA.test(ultima)) {
                alterna = !alterna
                poner(alterna ? 3 : 1)
              } else poner(1)
            }
          }
        } else if (ahora - ultimoCrecimiento > SILENCIO_MS) {
          poner(1)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      poner(1)
    }
  }, [mueve, estado])

  const alto = Math.round(tamano / TEX_CARA_ASPECTO)
  const ancho = tamano <= 48 ? 96 : tamano <= 96 ? 192 : 384

  return (
    <span
      ref={ref}
      data-cuadro="1"
      className={cn('tex-cara', className)}
      style={{ width: tamano }}
      role={etiqueta ? 'img' : undefined}
      aria-label={etiqueta}
      aria-hidden={etiqueta ? undefined : true}
    >
      {CUADROS.map((n) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={n}
          data-n={n}
          src={srcCara(n, ancho)}
          srcSet={srcSetCara(n)}
          sizes={`${tamano}px`}
          width={tamano}
          height={alto}
          alt=""
          decoding="async"
          draggable={false}
        />
      ))}
    </span>
  )
}
