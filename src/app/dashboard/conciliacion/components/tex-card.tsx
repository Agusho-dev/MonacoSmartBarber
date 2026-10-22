'use client'

// La tarjeta de Tex: la pose del momento (logro si cuadró con todas las
// cuentas, analiza si hay diferencias, ayuda si faltan cuentas o hubo un
// error) y la narrativa del motor —plantillas, sin IA— donde cada cifra es un
// botón que filtra la lista de casos. Tex cuenta lo que calculó el código;
// nunca tapa una cifra.
//
// En el celular la pose va en la esquina del veredicto; acá queda la voz.

import { TexIcono } from '@/components/tex/tex-icono'
import { TexPose } from '@/components/tex/tex-pose'
import type { TexPoseNombre } from '@/components/tex/assets'
import type { ResultadoConciliacion } from '@/lib/conciliacion-mp/contrato'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { filtroDeFrase, tokensNarrativa, type FiltroDeNarrativa } from './logica'

interface Props {
  resultado: ResultadoConciliacion | null
  pose: TexPoseNombre
  aliases: string[]
  texDisponible: boolean
  /** Lo que se ve es de otro período o sucursal (el nuevo se está calculando): atenuado y sin botones. */
  desfasado: boolean
  onFiltrar: (f: FiltroDeNarrativa) => void
  onPreguntar: () => void
}

/** Lo que dice Tex si el motor no mandó narrativa (no debería pasar, pero nunca una tarjeta muda). */
function narrativaDeRespaldo(r: ResultadoConciliacion | null): string[] {
  if (!r) return ['No pude leer la conciliación. Apenas se pueda, te cuento qué pasó.']
  switch (r.veredicto.tipo) {
    case 'cuadra':
      return ['Cuadró todo.']
    case 'sin_movimientos':
      return ['No hubo transferencias para controlar.']
    case 'no_se_sabe':
      return ['Todavía me falta leer cuentas para poder decirte si cuadró.']
    case 'error':
      return ['No pude leer alguna cuenta de Mercado Pago: lo que cuento es con lo que pude leer.']
    default:
      return [r.veredicto.detalle].filter(Boolean)
  }
}

export function TexCard({ resultado, pose, aliases, texDisponible, desfasado, onFiltrar, onPreguntar }: Props) {
  const frases = resultado && resultado.narrativa.length > 0 ? resultado.narrativa : narrativaDeRespaldo(resultado)
  const logro = pose === 'logro'

  return (
    <section
      aria-labelledby="tex-card-titulo"
      aria-busy={desfasado}
      className="flex h-full flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5 lg:p-6"
    >
      <div className="hidden lg:block">
        <TexPose pose={pose} alto={120} halo entrada={logro ? 'logro' : 'suave'} />
      </div>
      <div
        className={cn('flex min-w-0 flex-1 flex-col gap-2.5 transition-opacity duration-200', desfasado && 'pointer-events-none opacity-50')}
        inert={desfasado}
      >
        <h2 id="tex-card-titulo" className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[var(--tex-texto)]">
          <TexIcono className="size-5 lg:hidden" />
          Tex
        </h2>
        {frases.map((frase, i) => {
          const filtro = filtroDeFrase(frase, aliases)
          return (
            <p key={i} className="text-[15px] leading-relaxed text-zinc-200">
              {tokensNarrativa(frase, aliases).map((t, j) =>
                t.tipo === 'texto' || !resultado ? (
                  <span key={j}>{t.texto}</span>
                ) : (
                  <button
                    key={j}
                    type="button"
                    onClick={() => onFiltrar(filtro)}
                    className="rounded-sm font-medium text-[var(--tex-texto)] underline decoration-dotted decoration-1 underline-offset-4 transition-colors hover:decoration-solid focus-visible:ring-2 focus-visible:ring-[var(--tex)]/60 focus-visible:outline-none"
                    title="Ver en la lista"
                  >
                    {t.texto}
                  </button>
                ),
              )}
            </p>
          )
        })}
      </div>
      {texDisponible && (
        <Button variant="outline" className="h-11 w-full gap-2 sm:h-10 lg:w-auto lg:self-start" onClick={onPreguntar} disabled={desfasado}>
          <TexIcono className="size-5" />
          Preguntale a Tex
        </Button>
      )}
    </section>
  )
}
