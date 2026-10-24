'use client'

// El registro de la IA (Configuración → Registro de la IA), como una lista de
// iOS (23/oct/2026, tercera ronda): las últimas 50 ejecuciones de los pasos de
// IA, con el ícono verde o rojo, el modelo, la hora, el cliente y lo que
// respondió (o el error); tocar una muestra el detalle. «Todas / Errores» es el
// control segmentado de iOS. Antes: letra de 9 a 11 px y botones sin nombre.

import { useEffect, useState } from 'react'
import { AlertCircle, Bot, CheckCircle2, ChevronDown, RefreshCw } from 'lucide-react'
import { getAiExecutionLogs, type AiExecutionLog } from '@/lib/actions/ai-config'
import { cn } from '@/lib/utils'
import { formatRelativeDate, formatearTelefonoAr } from '../shared/helpers'
import { MODEL_GROUPS } from '../shared/model-picker'
import { useDiaLocal } from '../shared/use-dia-local'
import {
  BotonPildoraIos, CargandoIos, CLASE_BOTON_CELDA, CLASE_CELDA, CLASE_CUERPO_BOTON, GrupoIos, IconoCeldaIos, SegmentadoIos,
  TEXTO_PRINCIPAL, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, VacioIos,
} from '../navegacion/lista-ios'

const conError = (l: AiExecutionLog) => l.status === 'error' || l.used_fallback

// El nombre de un modelo conocido («GPT-4.1»); uno pegado a mano va con su ID.
const NOMBRE_DEL_MODELO = new Map(MODEL_GROUPS.flatMap((g) => g.models.map((m) => [m.id, m.label] as const)))

export function AiLogsPanel() {
  const [logs, setLogs] = useState<AiExecutionLog[]>([])
  const [lectura, setLectura] = useState<{ pedido: number; cargando: boolean; error: string | null }>({ pedido: 0, cargando: true, error: null })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'error'>('all')
  // La hora de cada celda ("14:32", "Ayer", "martes") cambia sola a la medianoche.
  const dia = useDiaLocal()

  // La lectura (y «Actualizar»): cada pedido nuevo vuelve a leer.
  useEffect(() => {
    let vigente = true
    getAiExecutionLogs(50)
      .then((res) => {
        if (!vigente) return
        if (!res.error) setLogs(res.data)
        setLectura((l) => ({ ...l, cargando: false, error: res.error ?? null }))
      })
      .catch(() => {
        if (vigente) setLectura((l) => ({ ...l, cargando: false, error: 'No pudimos leer el registro. Revisá la conexión.' }))
      })
    return () => { vigente = false }
  }, [lectura.pedido])

  const actualizar = () => setLectura((l) => ({ pedido: l.pedido + 1, cargando: true, error: null }))

  const visible = filter === 'all' ? logs : logs.filter(conError)
  const errorCount = logs.filter(conError).length

  return (
    <>
      <SegmentadoIos
        etiqueta="Qué ejecuciones mostrar"
        className="mt-3 lg:mt-2"
        valor={filter}
        onCambio={setFilter}
        opciones={[
          { valor: 'all', texto: `Todas (${logs.length})` },
          { valor: 'error', texto: `Errores (${errorCount})` },
        ]}
      />

      {lectura.cargando && logs.length === 0 ? (
        <CargandoIos texto="Leyendo el registro…" />
      ) : visible.length === 0 ? (
        <VacioIos
          icono={Bot}
          titulo={
            lectura.error && logs.length === 0
              ? 'No pudimos leer el registro'
              : filter === 'error' ? 'Sin errores recientes' : 'Todavía no hay ejecuciones'
          }
          texto={
            lectura.error && logs.length === 0
              ? lectura.error
              : filter === 'error'
                ? 'Las últimas ejecuciones de la IA salieron bien.'
                : 'Cuando un paso de IA de una automatización responda, aparece acá.'
          }
        >
          <BotonPildoraIos icono={RefreshCw} onClick={actualizar}>Actualizar</BotonPildoraIos>
        </VacioIos>
      ) : (
        <GrupoIos
          titulo="Últimas 50 ejecuciones"
          accion={
            <button
              type="button"
              onClick={actualizar}
              disabled={lectura.cargando}
              className="-mr-2.5 flex h-11 items-center gap-1.5 rounded-full px-2.5 text-[15px] font-medium text-[var(--wa-accent)] outline-none transition-colors active:bg-white/10 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:h-8 lg:text-[13px] lg:hover:bg-white/[0.07]"
            >
              <RefreshCw aria-hidden className={cn('size-4', lectura.cargando && 'animate-spin')} />
              Actualizar
            </button>
          }
          pie="Si aparece un error, revisá el modelo o la API key en Configuración → IA."
        >
          {visible.map((log) => (
            <CeldaEjecucion
              key={log.id}
              log={log}
              dia={dia}
              abierta={expanded === log.id}
              onAlternar={() => setExpanded((e) => (e === log.id ? null : log.id))}
            />
          ))}
        </GrupoIos>
      )}
    </>
  )
}

function CeldaEjecucion({
  log,
  dia,
  abierta,
  onAlternar,
}: {
  log: AiExecutionLog
  /** El día del navegador (useDiaLocal): null mientras no se sabe. */
  dia: string | null
  abierta: boolean
  onAlternar: () => void
}) {
  const error = conError(log)
  const cliente = log.client_name ?? (log.client_phone ? (formatearTelefonoAr(log.client_phone) ?? log.client_phone) : null)
  const modelo = log.model ? (NOMBRE_DEL_MODELO.get(log.model) ?? log.model) : 'Modelo desconocido'
  return (
    <li className={cn(CLASE_CELDA, 'items-start')}>
      <IconoCeldaIos icono={error ? AlertCircle : CheckCircle2} color={error ? 'rojo' : 'verde'} className="mt-3 lg:mt-2.5" />
      <div className={cn(CLASE_CUERPO_BOTON, 'flex-col items-stretch gap-0')}>
        <button type="button" aria-expanded={abierta} onClick={onAlternar} className={cn(CLASE_BOTON_CELDA, 'py-3 lg:py-2.5')}>
          <span className="flex items-baseline gap-3">
            <span className={cn(TEXTO_PRINCIPAL, 'min-w-0 flex-1 truncate font-semibold')}>{modelo}</span>
            {dia && <span className={cn(TEXTO_TERCIARIO, 'shrink-0 tabular-nums')}>{formatRelativeDate(log.executed_at)}</span>}
            <ChevronDown
              aria-hidden
              className={cn('size-4 shrink-0 self-center text-[var(--wa-text-2)] transition-transform duration-200', abierta && 'rotate-180')}
            />
          </span>
          {(cliente || log.used_fallback) && (
            <span className={cn(TEXTO_TERCIARIO, 'block truncate')}>
              {cliente}
              {cliente && log.used_fallback && ' · '}
              {log.used_fallback && <span className="text-[#ffa733]">Usó el respaldo</span>}
            </span>
          )}
          <span className={cn(TEXTO_SECUNDARIO, 'mt-0.5 block', abierta ? 'whitespace-pre-wrap' : 'line-clamp-2', error && 'text-[#ff8a80]')}>
            {log.error_message ?? log.response_preview ?? '(sin contenido)'}
          </span>
        </button>
        {abierta && (
          <div className="space-y-2 pb-3 lg:pb-2.5">
            {log.error_message && log.response_preview && (
              <div>
                <p className={TEXTO_TERCIARIO}>Lo que respondió</p>
                <p className="mt-1 whitespace-pre-wrap rounded-[12px] bg-[var(--wa-raised-2)] px-3 py-2 text-[15px] leading-5 text-[var(--wa-text)] lg:rounded-md lg:text-[13px] lg:leading-[18px]">
                  {log.response_preview}
                </p>
              </div>
            )}
            <p className={TEXTO_TERCIARIO}>
              Estado: <span className={error ? 'text-[#ff8a80]' : 'text-[var(--wa-accent)]'}>{log.status}</span>
            </p>
          </div>
        )}
      </div>
    </li>
  )
}
