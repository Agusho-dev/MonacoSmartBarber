'use client'

// Casos (reseñas de 2 estrellas o menos), como una pantalla de WhatsApp para
// iOS (23/oct/2026, tercera ronda): una celda por caso con el ícono naranja,
// el cliente, las estrellas, el comentario, lo que marcó para mejorar y la
// hora en 24 h. «Contactar» abre su chat y el estado se cambia con el menú de
// la celda (abierto, contactado, resuelto o descartado: los cuatro botones de
// antes en uno). «Ver todos» va en la barra. En la compu, la misma lista con
// la piel de la Mac.

import { useState, useEffect, useTransition, useCallback, useMemo } from 'react'
import { Check, ChevronDown, Frown, MessageSquare, Star } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getCrmCases, updateCrmCase, type CrmCaseRow, type CrmCaseStatus } from '@/lib/actions/crm-cases'
import { useMensajeria } from '../shared/mensajeria-context'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { displayName, formatRelativeDate } from '../shared/helpers'
import { useDiaLocal } from '../shared/use-dia-local'
import { AccionDeBarraIos, BotonSecundario, BotonTextoIos, EncabezadoSeccion } from '../navegacion/barra-ios'
import {
  BotonTextoCeldaIos, CargandoIos, CLASE_CELDA, CLASE_CUERPO, CLASE_ITEM_MENU_IOS, CLASE_MENU_IOS, ContenidoSeccion,
  GrupoIos, IconoCeldaIos, TEXTO_PRINCIPAL, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, VacioIos, avisarFalla,
} from '../navegacion/lista-ios'
import { toast } from 'sonner'

const STATUS_CONFIG: Record<CrmCaseStatus, { label: string; dot: string; texto: string }> = {
  open:      { label: 'Abierto',    dot: 'bg-[#ff453a]', texto: 'text-[#ff6961]' },
  contacted: { label: 'Contactado', dot: 'bg-[#ff9f0a]', texto: 'text-[#ffa733]' },
  resolved:  { label: 'Resuelto',   dot: 'bg-[var(--wa-accent)]', texto: 'text-[var(--wa-accent)]' },
  dismissed: { label: 'Descartado', dot: 'bg-[#8e8e93]', texto: 'text-[var(--wa-text-2)]' },
}
const ESTADOS: CrmCaseStatus[] = ['open', 'contacted', 'resolved', 'dismissed']

function Stars({ rating }: { rating: number | null }) {
  const r = rating ?? 0
  return (
    <span role="img" aria-label={`${r} de 5 estrellas`} className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} aria-hidden className={cn('size-4 lg:size-3.5', i <= r ? 'fill-[#ffcc00] text-[#ffcc00]' : 'text-[#5a5a5e]')} />
      ))}
    </span>
  )
}

export function CrmCasesPanel({ onNavigateToInbox }: { onNavigateToInbox?: () => void } = {}) {
  const { conversations, setActiveConv, setShowMobileChat, handleStartConversation } = useMensajeria()
  const [cases, setCases] = useState<CrmCaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showResolved, setShowResolved] = useState(false)
  const [isActing, startActing] = useTransition()
  // La hora de cada celda ("14:32", "Ayer", "martes") cambia sola a la medianoche.
  const dia = useDiaLocal()

  const loadCases = useCallback(async () => {
    try {
      const result = await getCrmCases()
      setCases(result.data)
    } catch {
      // Se queda la lista que había.
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await getCrmCases()
        if (!cancelled) setCases(result.data)
      } catch {
        // Sin red: se ve el vacío.
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  // Realtime: refrescar cuando entra un caso nuevo (reseña de 2 estrellas o menos) o cambia uno.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('crm-cases-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_cases' }, () => { loadCases() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadCases])

  const handleStatus = (caseId: string, status: CrmCaseStatus) => {
    // Optimista
    setCases(prev => prev.map(c => c.id === caseId
      ? { ...c, status, resolved_at: ['resolved', 'dismissed'].includes(status) ? new Date().toISOString() : null }
      : c))
    startActing(async () => {
      try {
        const res = await updateCrmCase(caseId, { status })
        if (res.error) { toast.error(res.error); loadCases() }
      } catch (e) {
        avisarFalla(e, 'No se pudo cambiar el estado. Revisá la conexión y probá de nuevo.')
        loadCases()
      }
    })
  }

  const handleResponder = (clientId: string | null | undefined) => {
    if (!clientId) { toast.error('El caso no tiene un cliente vinculado'); return }
    const conv = conversations.find(c => c.client_id === clientId || c.client?.id === clientId)
    if (conv) {
      setActiveConv(conv)
      setShowMobileChat(true)
      onNavigateToInbox?.()
    } else {
      handleStartConversation(clientId)
      onNavigateToInbox?.()
    }
  }

  const pendientes = useMemo(() => cases.filter(c => c.status === 'open' || c.status === 'contacted'), [cases])
  const cerrados = useMemo(() => cases.filter(c => c.status === 'resolved' || c.status === 'dismissed'), [cases])

  // Las estrellas, con palabras: un glifo de estrella como adorno va contra la regla de íconos (sin emojis ni glifos).
  const resumen = pendientes.length > 0
    ? `${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'} · reseñas de 2 estrellas o menos`
    : 'Sin casos pendientes'

  const celda = (c: CrmCaseRow) => (
    <CeldaCaso key={c.id} caso={c} dia={dia} ocupado={isActing} onContactar={() => handleResponder(c.client?.id)} onEstado={(s) => handleStatus(c.id, s)} />
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <AccionDeBarraIos>
        <BotonTextoIos onClick={() => setShowResolved(v => !v)}>{showResolved ? 'Pendientes' : 'Ver todos'}</BotonTextoIos>
      </AccionDeBarraIos>
      <EncabezadoSeccion titulo="Casos" subtitulo={loading ? undefined : resumen}>
        <BotonSecundario onClick={() => setShowResolved(v => !v)}>{showResolved ? 'Sólo pendientes' : 'Ver todos'}</BotonSecundario>
      </EncabezadoSeccion>

      <ContenidoSeccion>
        {loading ? (
          <CargandoIos texto="Cargando casos…" />
        ) : pendientes.length === 0 && (!showResolved || cerrados.length === 0) ? (
          <VacioIos
            icono={Frown}
            titulo={showResolved ? 'Sin casos' : 'Sin casos pendientes'}
            texto="Cuando un cliente deja una reseña de 2 estrellas o menos, aparece acá para que puedas hacer el seguimiento."
          />
        ) : (
          <>
            {pendientes.length > 0 ? (
              <GrupoIos titulo={`Pendientes · ${pendientes.length}`} pie="Reseñas de 2 estrellas o menos.">
                {pendientes.map(celda)}
              </GrupoIos>
            ) : (
              <p className={cn(TEXTO_SECUNDARIO, 'px-4 pt-2 lg:px-3')}>No hay casos pendientes.</p>
            )}
            {showResolved && cerrados.length > 0 && <GrupoIos titulo="Cerrados">{cerrados.map(celda)}</GrupoIos>}
          </>
        )}
      </ContenidoSeccion>
    </div>
  )
}

function CeldaCaso({
  caso: c,
  dia,
  ocupado,
  onContactar,
  onEstado,
}: {
  caso: CrmCaseRow
  /** El día del navegador (useDiaLocal): null mientras no se sabe. */
  dia: string | null
  ocupado: boolean
  onContactar: () => void
  onEstado: (estado: CrmCaseStatus) => void
}) {
  const cfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.open
  const name = displayName(c.client?.name || c.client?.phone || 'Cliente', c.client?.instagram ? 'instagram' : 'whatsapp')
  const categories = c.review?.improvement_categories ?? []
  const closed = c.status === 'resolved' || c.status === 'dismissed'
  return (
    <li className={cn(CLASE_CELDA, 'items-start')}>
      <IconoCeldaIos icono={Frown} color={closed ? 'gris' : 'naranja'} className="mt-3 lg:mt-2.5" />
      <div className={cn(CLASE_CUERPO, 'flex-col items-stretch gap-1 py-3 lg:py-2.5')}>
        <div className="flex items-baseline gap-3">
          <p className={cn(TEXTO_PRINCIPAL, 'min-w-0 flex-1 truncate font-semibold', closed && 'text-[var(--wa-text-2)]')}>{name}</p>
          {dia && <span className={cn(TEXTO_TERCIARIO, 'shrink-0 tabular-nums')}>{formatRelativeDate(c.review?.created_at ?? c.created_at)}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Stars rating={c.review?.rating ?? null} />
          {c.branch?.name && <span className={TEXTO_TERCIARIO}>{c.branch.name}</span>}
        </div>
        {c.review?.comment && (
          <p className="text-[15px] leading-5 text-[var(--wa-text)] lg:text-[13px] lg:leading-[18px]">“{c.review.comment}”</p>
        )}
        {categories.length > 0 && (
          <p className={TEXTO_TERCIARIO}>Para mejorar: {categories.join(' · ')}</p>
        )}
        <div className="-mb-1.5 mt-0.5 flex items-center gap-4 lg:-mb-1 lg:gap-3">
          <BotonTextoCeldaIos icono={MessageSquare} onClick={onContactar} etiqueta={`Contactar a ${name}`}>
            Contactar
          </BotonTextoCeldaIos>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={ocupado}
                aria-label={`Estado del caso de ${name}: ${cfg.label}. Cambiar`}
                className={cn(
                  'relative z-10 -ml-2.5 flex h-11 items-center gap-1.5 rounded-full px-2.5 text-[17px] font-medium outline-none transition-colors [-webkit-tap-highlight-color:transparent]',
                  'active:bg-white/10 data-[state=open]:bg-white/10 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:-ml-2 lg:h-8 lg:px-2 lg:text-[13px] lg:hover:bg-white/[0.07]',
                  cfg.texto,
                )}
              >
                <span aria-hidden className={cn('size-2 rounded-full', cfg.dot)} />
                {cfg.label}
                <ChevronDown aria-hidden className="size-4" strokeWidth={2.2} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4} collisionPadding={12} className={CLASE_MENU_IOS}>
              {ESTADOS.map((s) => (
                <DropdownMenuItem key={s} onSelect={() => { if (s !== c.status) onEstado(s) }} className={CLASE_ITEM_MENU_IOS}>
                  <span aria-hidden className={cn('ml-1 size-2.5 shrink-0 rounded-full', STATUS_CONFIG[s].dot)} />
                  <span className="flex-1">{s === 'open' && closed ? 'Reabrir' : STATUS_CONFIG[s].label}</span>
                  {s === c.status && <Check aria-hidden className="text-[var(--wa-accent)]" strokeWidth={2.4} />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  )
}
