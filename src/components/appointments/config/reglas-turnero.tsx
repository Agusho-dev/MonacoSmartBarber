'use client'

import { useMemo, useState } from 'react'
import { Clock, Eye, TriangleAlert, CalendarRange, Timer, Hourglass } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  NOMBRES_DIAS,
  NOMBRES_DIAS_CORTOS,
  ORDEN_SEMANA,
  horariosOfrecidos,
  normalizarTramos,
  tramosDeTurnos,
  type AgendaTurnos,
  type BarberoConfig,
  type JornadaSemanal,
  type ServicioReservable,
  type Tramo,
} from './tipos'

export interface ValoresReglas {
  apertura: string
  cierre: string
  dias: number[]
  paso: number
  descanso: number
  anticipacionMinima: number
  diasMaximos: number
  toleranciaTardanza: number
  horasParaCancelar: number
}

interface Props {
  valores: ValoresReglas
  onCambiar: (cambio: Partial<ValoresReglas>) => void
  barberos: BarberoConfig[]
  /** Agenda de turnos por día (`appointment_staff_days`). */
  agenda: AgendaTurnos
  /** Jornada de trabajo, para los días que toman turnos "toda su jornada". */
  jornada: JornadaSemanal
  usaAgendaPorDia: boolean
  servicios: ServicioReservable[]
}

export function ReglasTurnero({ valores, onCambiar, barberos, agenda, jornada, usaAgendaPorDia, servicios }: Props) {
  return (
    <div id="seccion-reglas" className="grid scroll-mt-24 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Horarios y reglas</CardTitle>
          <CardDescription>
            Cómo se arma la agenda que ve el cliente. A la derecha vas viendo el resultado en vivo.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Horario del local */}
          <section className="space-y-3">
            <Encabezado
              Icono={Clock}
              titulo="Horario en que se toman turnos"
              ayuda="La primera y la última hora en que un cliente puede reservar."
            />
            <div className="flex flex-wrap items-center gap-3">
              <CampoHora etiqueta="Desde" valor={valores.apertura} onChange={v => onCambiar({ apertura: v })} />
              <CampoHora etiqueta="Hasta" valor={valores.cierre} onChange={v => onCambiar({ cierre: v })} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Días en que se aceptan reservas</p>
              <div className="flex flex-wrap gap-1.5">
                {ORDEN_SEMANA.map(dia => {
                  const activo = valores.dias.includes(dia)
                  return (
                    <button
                      key={dia}
                      type="button"
                      onClick={() =>
                        onCambiar({
                          dias: activo
                            ? valores.dias.filter(d => d !== dia)
                            : [...valores.dias, dia].sort(),
                        })
                      }
                      className={cn(
                        'h-9 min-w-11 rounded-lg border px-2 text-xs font-semibold transition-colors',
                        activo
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                      )}
                    >
                      {NOMBRES_DIAS_CORTOS[dia]}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          <Separator />

          {/* Ritmo de la agenda */}
          <section className="space-y-4">
            <Encabezado
              Icono={Timer}
              titulo="Ritmo de la agenda"
              ayuda="Cada cuánto empieza un turno y cuánto aire queda entre uno y otro."
            />

            <ChipsNumero
              etiqueta="Cada cuánto arranca un turno"
              ayuda="Los horarios que ve el cliente van de este salto: 15 min da más opciones, 45 min agenda más prolija."
              valor={valores.paso}
              opciones={[15, 20, 30, 45, 60]}
              formato={v => `${v} min`}
              onChange={v => onCambiar({ paso: v })}
            />

            <ChipsNumero
              etiqueta="Descanso entre turno y turno"
              ayuda="Minutos libres antes y después de cada turno, para limpiar y respirar."
              valor={valores.descanso}
              opciones={[0, 5, 10, 15]}
              formato={v => (v === 0 ? 'Sin descanso' : `${v} min`)}
              onChange={v => onCambiar({ descanso: v })}
            />
          </section>

          <Separator />

          {/* Reglas de reserva */}
          <section className="space-y-4">
            <Encabezado
              Icono={CalendarRange}
              titulo="Reglas para reservar"
              ayuda="Qué puede y qué no puede hacer el cliente desde el link."
            />

            <ChipsNumero
              etiqueta="Anticipación mínima para reservar online"
              ayuda="Evita que alguien reserve para dentro de cinco minutos y llegue tarde. No afecta los turnos que cargás vos desde la agenda."
              valor={valores.anticipacionMinima}
              opciones={[0, 30, 60, 120]}
              formato={v => (v === 0 ? 'Sin mínimo' : v >= 60 ? `${v / 60} h antes` : `${v} min antes`)}
              onChange={v => onCambiar({ anticipacionMinima: v })}
            />

            <ChipsNumero
              etiqueta="Hasta cuándo se puede reservar a futuro"
              ayuda="Cuánto tiempo hacia adelante se muestra el calendario."
              valor={valores.diasMaximos}
              opciones={[7, 14, 30, 60]}
              formato={v => (v === 7 ? '1 semana' : v === 14 ? '2 semanas' : v === 30 ? '1 mes' : v === 60 ? '2 meses' : `${v} días`)}
              onChange={v => onCambiar({ diasMaximos: v })}
            />

            <ChipsNumero
              etiqueta="Hasta cuánto antes puede cancelar el cliente"
              ayuda="Pasado ese límite, el link de cancelación deja de funcionar y tiene que llamar."
              valor={valores.horasParaCancelar}
              opciones={[0, 1, 2, 4, 24]}
              formato={v => (v === 0 ? 'Hasta la hora del turno' : v === 1 ? '1 hora antes' : `${v} horas antes`)}
              onChange={v => onCambiar({ horasParaCancelar: v })}
            />
          </section>

          <Separator />

          <section className="space-y-4">
            <Encabezado
              Icono={Hourglass}
              titulo="Cuando el cliente llega tarde"
              ayuda="Pasado ese tiempo el turno se marca solo como ausente y libera al barbero."
            />
            <ChipsNumero
              etiqueta="Cuánto lo esperamos antes de marcarlo ausente"
              valor={valores.toleranciaTardanza}
              opciones={[5, 10, 15, 20, 30]}
              formato={v => `${v} min`}
              onChange={v => onCambiar({ toleranciaTardanza: v })}
            />
          </section>
        </CardContent>
      </Card>

      <VistaPrevia
        valores={valores}
        barberos={barberos}
        agenda={agenda}
        jornada={jornada}
        usaAgendaPorDia={usaAgendaPorDia}
        servicios={servicios}
      />
    </div>
  )
}

// ─── Vista previa en vivo ────────────────────────────────────────────

function VistaPrevia({
  valores,
  barberos,
  agenda,
  jornada,
  usaAgendaPorDia,
  servicios,
}: {
  valores: ValoresReglas
  barberos: BarberoConfig[]
  agenda: AgendaTurnos
  jornada: JornadaSemanal
  usaAgendaPorDia: boolean
  servicios: ServicioReservable[]
}) {
  const serviciosConDuracion = servicios.filter(s => s.duracionMinutos && s.duracionMinutos > 0)
  const [servicioId, setServicioId] = useState<string>(() => serviciosConDuracion[0]?.id ?? '')

  const diasConGente = useMemo(() => {
    const atienden = barberos.filter(b => b.recibeTurnos)
    return ORDEN_SEMANA.filter(
      dia =>
        valores.dias.includes(dia) &&
        atienden.some(
          b => tramosDeTurnos({ agenda, jornada, staffId: b.id, dia, usaAgendaPorDia }).length > 0
        )
    )
  }, [agenda, barberos, jornada, usaAgendaPorDia, valores.dias])

  const [diaElegido, setDiaElegido] = useState<number | null>(null)
  const dia = diaElegido !== null && valores.dias.includes(diaElegido) ? diaElegido : diasConGente[0] ?? valores.dias[0] ?? 2

  const servicio = serviciosConDuracion.find(s => s.id === servicioId) ?? serviciosConDuracion[0] ?? null
  const duracion = servicio?.duracionMinutos ?? valores.paso

  const { horarios, tramos } = useMemo(() => {
    const atienden = barberos.filter(b => b.recibeTurnos)
    const juntos: Tramo[] = []
    for (const b of atienden) {
      juntos.push(...tramosDeTurnos({ agenda, jornada, staffId: b.id, dia, usaAgendaPorDia }))
    }
    const unificados = normalizarTramos(juntos)
    return {
      tramos: unificados,
      horarios: horariosOfrecidos({
        apertura: valores.apertura,
        cierre: valores.cierre,
        paso: valores.paso,
        duracion,
        tramos: unificados,
      }),
    }
  }, [agenda, barberos, dia, duracion, jornada, usaAgendaPorDia, valores.apertura, valores.cierre, valores.paso])

  const visibles = horarios.slice(0, 18)

  return (
    <Card className="h-fit lg:sticky lg:top-20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Eye className="size-4" />
          Lo que va a ver el cliente
        </CardTitle>
        <CardDescription className="text-xs">
          Horarios reales para un {NOMBRES_DIAS[dia].toLowerCase()} sin turnos tomados.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {ORDEN_SEMANA.filter(d => valores.dias.includes(d)).map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDiaElegido(d)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                d === dia ? 'bg-foreground text-background' : 'bg-muted/50 text-muted-foreground hover:text-foreground'
              )}
            >
              {NOMBRES_DIAS_CORTOS[d]}
            </button>
          ))}
        </div>

        {serviciosConDuracion.length > 0 && (
          <select
            value={servicio?.id ?? ''}
            onChange={e => setServicioId(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Servicio de referencia"
          >
            {serviciosConDuracion.map(s => (
              <option key={s.id} value={s.id}>
                {s.nombre} · {s.duracionMinutos} min
              </option>
            ))}
          </select>
        )}

        {horarios.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {visibles.map(hora => (
                <span
                  key={hora}
                  className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium tabular-nums"
                >
                  {hora}
                </span>
              ))}
              {horarios.length > visibles.length && (
                <span className="px-1 py-1 text-xs text-muted-foreground">
                  +{horarios.length - visibles.length} más
                </span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">{horarios.length} horarios</span> para ese día,
              cada {valores.paso} min, con turnos de {duracion} min
              {valores.descanso > 0 && ` y ${valores.descanso} min de descanso entre uno y otro`}.
            </p>
          </>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <p className="text-muted-foreground">
              {!tramos.length
                ? `Ningún barbero toma turnos los ${NOMBRES_DIAS[dia].toLowerCase()}. Marcá ese día en la grilla de arriba.`
                : `Un turno de ${duracion} min no entra en el horario cargado para ese día. Ampliá el horario del local o el del barbero.`}
            </p>
          </div>
        )}

        {valores.anticipacionMinima > 0 && horarios.length > 0 && (
          <p className="border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground">
            Para el día de hoy se esconden los horarios de las próximas{' '}
            {valores.anticipacionMinima >= 60
              ? `${valores.anticipacionMinima / 60} h`
              : `${valores.anticipacionMinima} min`}
            .
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Piezas de formulario ────────────────────────────────────────────

function Encabezado({
  Icono,
  titulo,
  ayuda,
}: {
  Icono: typeof Clock
  titulo: string
  ayuda?: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icono className="size-4" />
      </span>
      <div>
        <p className="text-sm font-semibold leading-tight">{titulo}</p>
        {ayuda && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{ayuda}</p>}
      </div>
    </div>
  )
}

function CampoHora({
  etiqueta,
  valor,
  onChange,
}: {
  etiqueta: string
  valor: string
  onChange: (valor: string) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {etiqueta}
      <input
        type="time"
        value={valor}
        onChange={e => onChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  )
}

/**
 * Chips en vez de un input numérico vacío. Si el valor guardado no es ninguna de
 * las opciones sugeridas se agrega como chip propio: sin eso, abrir la pantalla
 * y guardar le cambiaría en silencio un número que el dueño eligió antes.
 */
function ChipsNumero({
  etiqueta,
  ayuda,
  valor,
  opciones,
  formato,
  onChange,
}: {
  etiqueta: string
  ayuda?: string
  valor: number
  opciones: number[]
  formato: (valor: number) => string
  onChange: (valor: number) => void
}) {
  const lista = opciones.includes(valor) ? opciones : [...opciones, valor].sort((a, b) => a - b)

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium leading-tight">{etiqueta}</p>
      {ayuda && <p className="text-xs leading-snug text-muted-foreground">{ayuda}</p>}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {lista.map(opcion => (
          <button
            key={opcion}
            type="button"
            onClick={() => onChange(opcion)}
            className={cn(
              'h-9 rounded-lg border px-3 text-xs font-medium transition-colors',
              opcion === valor
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground'
            )}
          >
            {formato(opcion)}
          </button>
        ))}
      </div>
    </div>
  )
}
