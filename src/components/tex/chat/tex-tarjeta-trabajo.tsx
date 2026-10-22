'use client'

// La tarjeta de trabajo: lo que Tex hizo para llegar a la respuesta.
//
// Lo que traen las herramientas de DATOS (finanzas, reseñas, la consulta
// avanzada…) es el trabajo, no la respuesta: vive acá, plegado, y cada paso
// tiene su "Ver datos" para quien quiera auditar. En la respuesta sólo se
// dibuja lo de `mostrar`, `graficar` y `generar_informe` (contrato:
// esHerramientaVisible). Lo que Tex dijo entre una consulta y otra ("Busco a
// Chipi como barbero") también es trabajo: va acá, entre los pasos.
//
// Mientras Tex consulta, la tarjeta está abierta y muestra cada paso
// ("Leyendo las reseñas · Chipi · octubre", spinner → check, segundos). Cuando
// empieza la respuesta se pliega en una línea —"Consulté Reseñas y Equipo ·
// 3,2 s ›"— que se vuelve a abrir. Un paso que falló dice su error en una
// línea: en gris si la respuesta salió igual (Tex se recuperó, no hay nada que
// alarme), en ámbar si la respuesta no llegó. Un dato que falta nunca se
// esconde, pero tampoco se grita.

import { useId, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, CircleAlert, CircleStop, Loader2, TriangleAlert } from 'lucide-react'
import { metaHerramienta } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { TexPose } from '@/components/tex/tex-pose'
import { TexBloques, type ContenidoLienzo } from '@/components/tex/bloques'
import { useTiemposPasos, type TiemposPasos } from './hooks'
import { IconoDominio } from './iconos'
import {
  duracionDelTrabajo,
  filaDePaso,
  formatearDuracion,
  partesDelResumen,
  resumenPlegado,
  tieneDatosParaVer,
  type ItemTrabajo,
  type PasoTex,
} from './logica'

interface Props {
  /** Los pasos y las notas de Tex, en orden (`anatomiaDeRespuesta(m).trabajo`). */
  trabajo: ItemTrabajo[]
  /** El mensaje sigue llegando. */
  enCurso: boolean
  /** Ya llegó el texto de la respuesta: la tarjeta se pliega. */
  textoEmpezo: boolean
  /**
   * La respuesta no llegó (sin texto ni bloques, o el turno se cortó por los
   * pasos o un error): recién ahí un paso fallido se marca en ámbar.
   */
  alarma?: boolean
  compacto?: boolean
  /** "Está tardando más de lo normal." + [Detener], si corresponde. */
  aviso?: ReactNode
  orgNombre?: string
  /** Para "Ver las N filas" / "Ampliar" dentro de "Ver datos". */
  onAbrirLienzo?: (contenido: ContenidoLienzo) => void
}

export function TexTarjetaTrabajo({
  trabajo,
  enCurso,
  textoEmpezo,
  alarma = false,
  compacto = false,
  aviso,
  orgNombre,
  onAbrirLienzo,
}: Props) {
  const tiempos = useTiemposPasos()
  // null = la decide el estado del turno; true/false = la abrió o cerró la persona.
  const [manual, setManual] = useState<boolean | null>(null)
  // Los pasos con "Ver datos" abierto: sus bloques se montan recién ahí.
  const [conDatos, setConDatos] = useState<ReadonlySet<string>>(() => new Set())
  const idBase = useId()
  const idLista = `${idBase}-pasos`

  const pasos = trabajo.flatMap((item) => (item.tipo === 'paso' ? [item.paso] : []))
  // Abierta a la fuerza mientras Tex consulta. Una herramienta visible que
  // corre DESPUÉS de que empezó la respuesta (`mostrar` armando las tablas) no
  // la vuelve a abrir: su lugar en la respuesta ya dice "Preparando…".
  const corriendo = enCurso && !textoEmpezo && pasos.some((p) => p.estado === 'corriendo')
  // Un paso sin terminar en un mensaje que ya no llega (Detener, corte de red)
  // quedó interrumpido: no gira para siempre.
  const plegadaSola = !corriendo && (textoEmpezo || !enCurso)
  const abierta = corriendo || (manual ?? !plegadaSola)

  const duracion = duracionDelTrabajo(pasos, tiempos)
  const resumen = partesDelResumen(pasos, duracion)

  function alternarDatos(id: string) {
    setConDatos((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  return (
    <div
      className={cn(
        'rounded-[14px] border transition-[border-color,background-color] duration-[240ms] motion-reduce:transition-none',
        abierta ? 'border-border bg-card' : 'border-transparent bg-transparent',
      )}
    >
      {!corriendo && (
        <button
          type="button"
          onClick={() => setManual(!abierta)}
          aria-expanded={abierta}
          aria-controls={idLista}
          // Entero para el lector de pantalla: en el celular lo consultado se ve truncado.
          aria-label={resumenPlegado(pasos, duracion)}
          className={cn(
            // Plegada es una línea ("Consulté Reseñas y Equipo · 3,2 s ›") con el
            // chevron pegado al texto; abierta, el encabezado de la tarjeta.
            'flex min-h-8 max-w-full items-center gap-1.5 rounded-[14px] text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/50',
            abierta ? 'w-full px-3 pt-2' : '-mx-0.5 px-0.5',
          )}
        >
          {alarma && resumen.fallos && <TriangleAlert className="size-3.5 shrink-0 text-amber-300" aria-hidden />}
          {/* Sólo se trunca lo consultado: las fallas y la duración quedan siempre a la vista. */}
          <span className={cn('flex min-w-0 items-center gap-1', abierta && 'flex-1')}>
            <span className="min-w-0 truncate">{resumen.principal}</span>
            {resumen.fallos && (
              <span className={cn('shrink-0 whitespace-nowrap', alarma && 'text-amber-300')}>· {resumen.fallos}</span>
            )}
            {resumen.duracion && <span className="shrink-0 whitespace-nowrap tabular-nums">· {resumen.duracion}</span>}
          </span>
          <ChevronRight
            aria-hidden
            className={cn('size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none', abierta && 'rotate-90')}
          />
        </button>
      )}

      {/* El pliegue: grid 1fr ↔ 0fr anima el alto real sin medirlo. */}
      <div
        className="grid transition-[grid-template-rows] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{ gridTemplateRows: abierta ? '1fr' : '0fr' }}
      >
        <div className="min-h-0 overflow-hidden" inert={!abierta}>
          <div className={cn('flex items-start gap-3', corriendo ? 'p-3' : 'px-3 pb-3 pt-1.5')}>
            {corriendo && <TexPose pose="analiza" alto={compacto ? 40 : 48} entrada="suave" className="mt-0.5" />}
            <div className="min-w-0 flex-1">
              <ol id={idLista} className="space-y-0.5" aria-label="Pasos de Tex">
                {trabajo.map((item) =>
                  item.tipo === 'nota' ? (
                    // En vivo, 3 renglones como máximo (la tarjeta es el progreso). Terminada
                    // se abre para auditar: la nota va entera, porque si Tex escribió una
                    // conclusión y DESPUÉS consultó algo más, esa conclusión vive acá.
                    <li
                      key={item.id}
                      className={cn('py-0.5 pl-[30px] pr-2 text-[12.5px] leading-[18px] text-muted-foreground', enCurso && 'line-clamp-3')}
                    >
                      {item.texto}
                    </li>
                  ) : (
                    <FilaPaso
                      key={item.paso.id}
                      paso={item.paso}
                      idDatos={`${idBase}-datos-${item.paso.id}`}
                      enCurso={enCurso}
                      alarma={alarma}
                      tiempos={tiempos}
                      datosAbiertos={conDatos.has(item.paso.id)}
                      onDatos={() => alternarDatos(item.paso.id)}
                      orgNombre={orgNombre}
                      onAbrirLienzo={onAbrirLienzo}
                    />
                  ),
                )}
              </ol>
              {aviso}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface PropsFila {
  paso: PasoTex
  idDatos: string
  enCurso: boolean
  alarma: boolean
  tiempos: TiemposPasos
  datosAbiertos: boolean
  onDatos: () => void
  orgNombre?: string
  onAbrirLienzo?: (contenido: ContenidoLienzo) => void
}

/** Un paso: ícono · "Reseñas · Chipi · octubre" · estado · segundos · [Ver datos]. */
function FilaPaso({ paso, idDatos, enCurso, alarma, tiempos, datosAbiertos, onDatos, orgNombre, onAbrirLienzo }: PropsFila) {
  const meta = metaHerramienta(paso.nombre)
  const fila = filaDePaso(paso, enCurso)
  const t = tiempos[paso.id]
  const duracion = t?.fin !== undefined ? formatearDuracion(t.fin - t.inicio) : null
  const activo = paso.estado === 'corriendo' && enCurso
  const cortado = paso.estado === 'cortado' || (paso.estado === 'corriendo' && !enCurso)
  // Mientras Tex trabaja la tarjeta es el progreso (como siempre); terminada,
  // es para auditar. Así el botón no aparece y desaparece entre un paso y otro,
  // y en el celular la fila en vivo (con Tex al lado) no se queda sin lugar.
  const verDatos = !enCurso && tieneDatosParaVer(paso)
  // "Reseñas · Chipi · octubre": con dos pasos de Reseñas, el lector de pantalla
  // distingue cada "Ver datos" y cada región (el texto visible sigue siendo "Ver datos").
  const deQue = [fila.titulo, ...fila.detalle].join(' · ')

  return (
    <li>
      <div
        className={cn(
          'flex min-h-8 items-center gap-2 rounded-lg px-2 py-1 text-[13px]',
          activo && 'bg-[color:var(--tex)]/[0.07] ring-1 ring-[color:var(--tex)]/45',
        )}
      >
        <IconoDominio icono={meta.icono} aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        {/* Dos renglones como máximo: en el celular los argumentos ("Chipi · octubre") no se pierden. */}
        <span className="line-clamp-2 min-w-0 flex-1 [overflow-wrap:anywhere]">
          <span className="text-foreground/90">{fila.titulo}</span>
          {fila.detalle.length > 0 && <span className="text-muted-foreground"> · {fila.detalle.join(' · ')}</span>}
        </span>
        {activo ? (
          <Loader2
            aria-label="En curso"
            className="size-3.5 shrink-0 animate-spin text-[color:var(--tex-texto)] motion-reduce:animate-none"
          />
        ) : cortado ? (
          <CircleStop aria-label="Interrumpido" className="size-3.5 shrink-0 text-muted-foreground" />
        ) : paso.estado === 'ok' ? (
          <Check
            aria-label="Listo"
            className="size-3.5 shrink-0 text-emerald-400 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:duration-150"
          />
        ) : alarma ? (
          <TriangleAlert aria-label="Falló" className="size-3.5 shrink-0 text-amber-300" />
        ) : (
          <CircleAlert aria-label="Falló" className="size-3.5 shrink-0 text-zinc-400" />
        )}
        {duracion && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{duracion}</span>}
        {verDatos && (
          <button
            type="button"
            onClick={onDatos}
            aria-label={`Ver datos de ${deQue}`}
            aria-expanded={datosAbiertos}
            aria-controls={idDatos}
            className={cn(
              // 28 px a la vista y 40 de toque (el ::after): la fila sigue midiendo 32.
              'relative -my-0.5 inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors after:absolute after:-inset-y-1.5 after:inset-x-0',
              'hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/50',
              datosAbiertos && 'text-foreground',
            )}
          >
            Ver datos
            <ChevronDown
              aria-hidden
              className={cn('size-3.5 transition-transform duration-200 motion-reduce:transition-none', datosAbiertos && 'rotate-180')}
            />
          </button>
        )}
      </div>
      {fila.error && (
        <p
          className={cn('truncate pb-1 pl-[30px] pr-2 text-[12px] leading-4', alarma ? 'text-amber-200/90' : 'text-muted-foreground')}
          title={fila.error}
        >
          {fila.error}
        </p>
      )}
      {datosAbiertos && paso.salida && (
        <div id={idDatos} role="region" aria-label={`Datos de ${deQue}`} className="pb-2 pl-[30px] pr-1 pt-1.5">
          <TexBloques salida={paso.salida} orgNombre={orgNombre} onAbrirLienzo={onAbrirLienzo} compacto />
        </div>
      )}
    </li>
  )
}
