'use client'

// El detalle de un caso: la cadena de evidencia (Sistema · Comprobante ·
// Mercado Pago) con lo que coincide entre eslabones, dónde se buscó lo que
// falta, los "podría ser" y las acciones (confirmar o descartar un
// emparejamiento dudoso, vincular, marcar revisado, preguntarle a Tex). Hechos,
// no culpas: "no la encuentro en Mercado Pago", nunca "no cobró".
//
// Escritorio: hoja derecha de 560. Celular: pantalla completa con la barra de
// acciones fija abajo; vive en `?caso=<id>` para que "atrás" la cierre.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeftRight,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  FileImage,
  Link2,
  Link2Off,
  Loader2,
  Plug,
  ReceiptText,
  Server,
  ShieldCheck,
  Undo2,
  Wallet,
  X,
} from 'lucide-react'
import {
  MOTIVOS_REVISION,
  esEmparejamientoDudoso,
  type CandidatoCruce,
  type CasoConciliacion,
  type ComprobanteEvidencia,
  type CuentaConciliacion,
  type EsperadoMP,
  type MotivoRevision,
  type RechazoVista,
  type TipoMovimiento,
} from '@/lib/conciliacion-mp/contrato'
import {
  deshacerRechazo,
  deshacerResolucion,
  rechazarEmparejamiento,
  resolverCaso,
  urlComprobanteConciliacion,
} from '@/lib/actions/conciliacion-mp'
import { TexIcono } from '@/components/tex/tex-icono'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { diaCorto, fechaHoraAR, horaAR, plata, ymdAR } from './formato'
import {
  candidatosDelSistema,
  esCreditoSinCruzar,
  estaConectada,
  etiquetaMotivo,
  montoDelCaso,
  pedidoConfirmar,
  pedidoDescartar,
  pedidoRevisado,
  salvoDescartados,
  senalesOrdenadas,
  sePuedeConfirmar,
  sePuedeDescartar,
  sePuedeRevisar,
  textoConfianza,
  textoDudoso,
  textoNoEsEste,
  textoRechazo,
  transferLogIdsDe,
} from './logica'
import { llamar } from './llamar'
import { ChipCaso } from './visual'

export type ModoDetalle = 'normal' | 'revisar' | 'vincular'

export interface Resuelto {
  caso: CasoConciliacion
  /** Los casos que se pliegan en la lista (el vínculo resuelve los dos lados). */
  casosAfectados: string[]
  /** Lo que deshace el "Deshacer" del aviso: resoluciones (vínculo, revisado) o descartes ("No es este"). */
  tipo: 'resolucion' | 'rechazo'
  ids: string[]
  mensaje: string
}

interface Props {
  abierto: boolean
  caso: CasoConciliacion | null
  casos: CasoConciliacion[]
  cuentas: CuentaConciliacion[]
  multiDia: boolean
  puedeGestionar: boolean
  texDisponible: boolean
  modo: ModoDetalle
  hayAnterior: boolean
  haySiguiente: boolean
  onCerrar: () => void
  onNavegar: (dir: -1 | 1) => void
  onResuelto: (r: Resuelto) => void
  onDeshecho: () => void
  onConectarCuenta: (c: CuentaConciliacion) => void
  onPreguntarTex: (c: CasoConciliacion) => void
}

const VENTANA_BUSQUEDA_MS = 2 * 60 * 60 * 1000 // la búsqueda de candidatos del motor: ±2 h

const ESTADO_COMPROBANTE: Record<string, string> = {
  verified: 'Verificado',
  amount_mismatch: 'Monto distinto',
  duplicate: 'Duplicado',
  needs_review: 'En revisión',
  manual_ok: 'Dado por válido',
  overridden: 'Reemplazado',
  date_mismatch: 'Fecha a revisar',
}

const TIPO_MOVIMIENTO: Record<TipoMovimiento, string> = {
  transferencia: 'Transferencia',
  qr: 'Pago con QR',
  link: 'Link de pago',
  tarjeta: 'Tarjeta',
  point: 'Point',
  rendimiento: 'Rendimiento',
  devolucion: 'Devolución',
  otro: 'Otro',
}

const PROBABILIDAD: Record<CandidatoCruce['probabilidad'], string> = {
  muy_probable: 'Muy probable',
  probable: 'Probable',
  posible: 'Posible',
}

export function DetalleCaso(props: Props) {
  const contenidoRef = useRef<HTMLDivElement>(null)
  return (
    <Sheet open={props.abierto} onOpenChange={(v) => !v && props.onCerrar()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-[560px]"
        onOpenAutoFocus={(e) => {
          // R y V abren el detalle con el foco donde hace falta (el motivo, el primer "Vincular").
          // Si no, el foco va al cuerpo de la hoja: Radix lo pondría en el primer botón (la flecha
          // "anterior") y quedaría un anillo sobre algo que nadie tocó.
          const el =
            contenidoRef.current?.querySelector<HTMLElement>('[data-foco-inicial]') ??
            contenidoRef.current?.querySelector<HTMLElement>('[data-cuerpo-detalle]')
          if (el) {
            e.preventDefault()
            el.focus({ preventScroll: true })
          }
        }}
      >
        <div ref={contenidoRef} className="flex h-full min-h-0 flex-col">
          {props.caso ? (
            // La clave lleva el modo: R o V con el detalle ya abierto lo vuelven a armar con el foco donde va.
            <Contenido key={`${props.caso.id}:${props.modo}`} {...props} caso={props.caso} />
          ) : (
            <NoEncontrado onCerrar={props.onCerrar} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function NoEncontrado({ onCerrar }: { onCerrar: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-start gap-3 p-6">
      <SheetTitle>Este caso ya no está</SheetTitle>
      <SheetDescription>
        Se volvió a calcular la conciliación con lo nuevo de Mercado Pago y el caso cambió, o es de otro período.
      </SheetDescription>
      <Button variant="outline" onClick={onCerrar}>
        Volver a la lista
      </Button>
    </div>
  )
}

function Contenido(props: Props & { caso: CasoConciliacion }) {
  const { caso: c, casos, cuentas, puedeGestionar } = props
  const [revisando, setRevisando] = useState(props.modo === 'revisar')
  const [vinculando, setVinculando] = useState<string | null>(null)
  const [deshaciendo, setDeshaciendo] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [descartando, setDescartando] = useState(false)
  /** El descarte ("Descartado a mano…") que se está deshaciendo: la clave de su renglón. */
  const [deshaciendoDescarte, setDeshaciendoDescarte] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const candidatosRef = useRef<HTMLDivElement>(null)
  const revisarRef = useRef<HTMLDivElement>(null)

  // R / V con el detalle ya abierto: el foco va al motivo o al primer "Vincular".
  const modo = props.modo
  useEffect(() => {
    if (modo === 'normal') return
    const id = requestAnimationFrame(() => {
      const el = (modo === 'revisar' ? revisarRef.current : candidatosRef.current)?.querySelector<HTMLElement>('[data-foco-inicial]')
      el?.focus()
      el?.scrollIntoView({ block: 'center' })
    })
    return () => cancelAnimationFrame(id)
  }, [modo])

  const t = c.esperados[0]?.tSistema ?? c.movimiento?.fecha ?? c.fecha
  const dia = ymdAR(c.fecha)
  const sucursal = c.esperados.find((e) => e.sucursal)?.sucursal ?? null
  const cuenta = cuentas.find((cu) => (c.cuentaMpId && cu.cuentaMpId === c.cuentaMpId) || (c.alias != null && cu.aliases.includes(c.alias))) ?? null
  const ids = transferLogIdsDe(c)
  const vinculables = puedeGestionar && c.estado !== 'conciliado' && c.estado !== 'revisado' && !c.resolucion
  // Un cobro del sistema se vincula con un MOVIMIENTO de Mercado Pago (los candidatos del motor).
  const candidatosMp = vinculables && ids.length > 0 ? c.candidatos.filter((k) => !k.transferLogIds?.length) : []
  // Un movimiento que "no está en el sistema" se vincula con un COBRO: el motor los manda con sus
  // transfer_logs; si no mandó ninguno, la pantalla busca entre los casos que ya tiene (mismo monto, ±2 h).
  const esMovimientoSuelto = vinculables && c.movimiento != null && ids.length === 0
  const delMotor = esMovimientoSuelto ? c.candidatos.filter((k) => (k.transferLogIds?.length ?? 0) > 0) : []
  const candidatosSis = esMovimientoSuelto && delMotor.length === 0 ? candidatosDelSistema(c, casos) : []
  const totalCandidatos = candidatosMp.length + delMotor.length + candidatosSis.length
  const hayCandidatos = totalCandidatos > 0
  const revisable = puedeGestionar && sePuedeRevisar(c) && !c.resolucion
  // Un emparejamiento dudoso se confirma con un vínculo manual o se descarta con
  // "No es este" (un rechazo del par). Las dos, sólo con conciliacion.manage.
  const dudoso = esEmparejamientoDudoso(c)
  const confirmable = puedeGestionar && sePuedeConfirmar(c)
  const descartable = puedeGestionar && sePuedeDescartar(c)
  const decidiendo = confirmando || descartando
  const rechazados = c.rechazados ?? []

  async function confirmar() {
    const pedido = pedidoConfirmar(c)
    if (!pedido) return
    setConfirmando(true)
    setError(null)
    const r = await llamar(() => resolverCaso(pedido))
    setConfirmando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    props.onResuelto({
      caso: c,
      casosAfectados: [c.id],
      tipo: 'resolucion',
      ids: r.resolucionIds,
      mensaje: 'Confirmado: ya cuenta como plata verificada.',
    })
  }

  async function descartar() {
    const pedido = pedidoDescartar(c)
    if (!pedido) return
    setDescartando(true)
    setError(null)
    const r = await llamar(() => rechazarEmparejamiento(pedido))
    setDescartando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    props.onResuelto({
      caso: c,
      casosAfectados: [c.id],
      tipo: 'rechazo',
      ids: r.rechazoIds,
      mensaje: 'Descartado: no los vuelvo a juntar.',
    })
  }

  async function deshacerDescarte(r: RechazoVista) {
    const clave = r.ids.join(',')
    setDeshaciendoDescarte(clave)
    setError(null)
    const res = await llamar(() => deshacerRechazo(r.ids))
    setDeshaciendoDescarte(null)
    if (!res.ok) {
      setError(res.error ?? 'No se pudo deshacer.')
      return
    }
    props.onDeshecho()
  }

  async function vincular(clave: string, transferLogIds: string[], movimientoId: string, montoEsperado: number, montoMov: number, afectados: string[]) {
    setVinculando(clave)
    setError(null)
    const r = await llamar(() => resolverCaso({ tipo: 'vinculo', transferLogIds, movimientoId }))
    setVinculando(null)
    if (!r.ok) {
      setError(r.error)
      return
    }
    const dif = Math.round(montoMov - montoEsperado)
    props.onResuelto({
      caso: c,
      casosAfectados: afectados,
      tipo: 'resolucion',
      ids: r.resolucionIds,
      mensaje: Math.abs(dif) <= 1 ? 'Vinculado. Ya cuadra.' : `Vinculado. Queda una diferencia de ${plata(Math.abs(dif))}.`,
    })
  }

  function casoDelMovimiento(movimientoId: string): string[] {
    const otro = casos.find((x) => x.id !== c.id && x.movimiento?.id === movimientoId && x.esperados.length === 0)
    return otro ? [c.id, otro.id] : [c.id]
  }

  async function deshacer() {
    const resolucion = c.resolucion
    if (!resolucion) return
    setDeshaciendo(true)
    setError(null)
    // Un vínculo de un cobro conjunto son varias filas: se deshacen juntas.
    const idsResolucion = resolucion.ids?.length ? resolucion.ids : [resolucion.id]
    const r = await llamar(() => deshacerResolucion(idsResolucion))
    setDeshaciendo(false)
    if (!r.ok) {
      setError(r.error ?? 'No se pudo deshacer.')
      return
    }
    props.onDeshecho()
  }

  function vincularCobro(k: CandidatoCruce) {
    const tl = k.transferLogIds ?? []
    if (!c.movimiento || tl.length === 0) return
    void vincular(k.casoId ?? tl[0], tl, c.movimiento.id, k.monto, c.montoMp, k.casoId ? [c.id, k.casoId] : [c.id])
  }

  function accionVincular() {
    const unico = totalCandidatos === 1
    if (unico && candidatosMp[0]) {
      const k = candidatosMp[0]
      void vincular(k.movimientoId, ids, k.movimientoId, c.montoSistema, k.monto, casoDelMovimiento(k.movimientoId))
      return
    }
    if (unico && delMotor[0]) {
      vincularCobro(delMotor[0])
      return
    }
    if (unico && candidatosSis[0] && c.movimiento) {
      const u = candidatosSis[0].caso
      void vincular(u.id, transferLogIdsDe(u), c.movimiento.id, u.montoSistema, c.montoMp, [c.id, u.id])
      return
    }
    candidatosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    candidatosRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  }

  function abrirRevisar() {
    setRevisando(true)
    requestAnimationFrame(() => {
      revisarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      revisarRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    })
  }

  const acciones = hayCandidatos || revisable || confirmable || descartable || props.texDisponible
  // En el celular la barra es de una sola fila: con otras acciones, Tex va como ícono.
  const soloTex = !hayCandidatos && !confirmable && !descartable && !(revisable && !revisando)
  const ayudaNoEsEste = `ayuda-no-es-este-${c.id}`

  return (
    <>
      <header className="flex items-start gap-3 border-b border-white/[0.06] px-4 pt-4 pb-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <ChipCaso caso={c} />
          <SheetTitle className="mt-2 font-mono text-[28px] leading-none font-semibold text-zinc-50 tabular-nums">{montoDelCaso(c)}</SheetTitle>
          <SheetDescription className="mt-1.5 text-sm">
            {[dia ? diaCorto(dia) : null, horaAR(t), c.alias, sucursal].filter(Boolean).join(' · ')}
          </SheetDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="hidden size-9 sm:inline-flex"
            onClick={() => props.onNavegar(-1)}
            disabled={!props.hayAnterior}
            aria-label="Caso anterior"
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden size-9 sm:inline-flex"
            onClick={() => props.onNavegar(1)}
            disabled={!props.haySiguiente}
            aria-label="Caso siguiente"
          >
            <ChevronDown className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-10 sm:size-9" onClick={props.onCerrar} aria-label="Cerrar el detalle">
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div data-cuerpo-detalle tabIndex={-1} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 outline-none sm:px-6">
        {c.explicacion && <p className="text-[15px] leading-relaxed text-zinc-200">{c.explicacion}</p>}

        {dudoso && (
          <div className="space-y-1.5 rounded-xl border border-white/12 bg-white/[0.03] p-3.5">
            <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-100">
              <CircleHelp className="size-4 shrink-0 text-zinc-300" aria-hidden />
              Para confirmar
            </p>
            <p className="text-sm leading-relaxed text-zinc-300">{textoDudoso(c)}</p>
            {!puedeGestionar ? (
              <p className="text-xs text-muted-foreground">Lo confirma o lo descarta quien administra la conciliación.</p>
            ) : !confirmable && !c.resolucion ? (
              <p className="text-xs text-muted-foreground">
                Alguno de estos cobros se registró sin cuenta: no se puede confirmar ni descartar desde acá. Revisalo con el
                comprobante.
              </p>
            ) : null}
          </div>
        )}

        <Cadena caso={c} cuenta={cuenta} cuentas={cuentas} hayCandidatos={hayCandidatos} puedeGestionar={puedeGestionar} onConectarCuenta={props.onConectarCuenta} />

        {error && (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        {hayCandidatos && (
          <div ref={candidatosRef} className="space-y-2">
            <h3 className="text-sm font-semibold">Podría ser</h3>
            <ul className="space-y-2">
              {candidatosMp.slice(0, 3).map((k, i) => (
                <FilaCandidato
                  key={k.movimientoId}
                  probabilidad={PROBABILIDAD[k.probabilidad]}
                  monto={k.monto}
                  cuando={props.multiDia ? fechaHoraAR(k.fecha) : horaAR(k.fecha)}
                  alias={k.alias}
                  motivo={k.motivo}
                  cargando={vinculando === k.movimientoId}
                  deshabilitado={vinculando != null}
                  focoInicial={props.modo === 'vincular' && i === 0}
                  onVincular={() => vincular(k.movimientoId, ids, k.movimientoId, c.montoSistema, k.monto, casoDelMovimiento(k.movimientoId))}
                />
              ))}
              {delMotor.slice(0, 3).map((k, i) => (
                <FilaCandidato
                  key={k.casoId ?? k.transferLogIds?.join(',') ?? k.movimientoId}
                  probabilidad={PROBABILIDAD[k.probabilidad]}
                  monto={k.monto}
                  cuando={props.multiDia ? fechaHoraAR(k.fecha) : horaAR(k.fecha)}
                  alias={k.alias}
                  motivo={k.motivo}
                  cargando={vinculando === (k.casoId ?? k.transferLogIds?.[0])}
                  deshabilitado={vinculando != null}
                  focoInicial={props.modo === 'vincular' && candidatosMp.length === 0 && i === 0}
                  onVincular={() => vincularCobro(k)}
                />
              ))}
              {candidatosSis.map(({ caso: u, motivo }, i) => (
                <FilaCandidato
                  key={u.id}
                  probabilidad={null}
                  monto={u.montoSistema}
                  cuando={props.multiDia ? fechaHoraAR(u.fecha) : horaAR(u.fecha)}
                  alias={u.alias}
                  motivo={`${motivo}${u.esperados[0]?.barbero ? ` · ${u.esperados[0].barbero}` : ''}`}
                  cargando={vinculando === u.id}
                  deshabilitado={vinculando != null}
                  focoInicial={props.modo === 'vincular' && candidatosMp.length === 0 && i === 0}
                  onVincular={() => c.movimiento && vincular(u.id, transferLogIdsDe(u), c.movimiento.id, u.montoSistema, c.montoMp, [c.id, u.id])}
                />
              ))}
            </ul>
          </div>
        )}

        {rechazados.length > 0 && (
          <Descartados
            rechazados={rechazados}
            diaDelCaso={dia}
            puedeGestionar={puedeGestionar}
            deshaciendo={deshaciendoDescarte}
            onDeshacer={(r) => void deshacerDescarte(r)}
          />
        )}

        {c.resolucion && (
          <div className="space-y-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-zinc-100">
              {c.resolucion.tipo === 'vinculo' ? <Link2 className="size-4" aria-hidden /> : <CheckCheck className="size-4" aria-hidden />}
              {c.resolucion.tipo === 'vinculo' ? 'Vinculado a mano' : `Revisado: ${etiquetaMotivo(c.resolucion.motivo)}`}
            </p>
            {c.resolucion.nota && <p className="text-zinc-300">“{c.resolucion.nota}”</p>}
            <p className="text-xs text-muted-foreground">
              {c.resolucion.por ?? 'Alguien del equipo'} · {fechaHoraAR(c.resolucion.en)}
            </p>
            {puedeGestionar && (
              <Button variant="outline" size="sm" className="mt-1 h-9 gap-1.5" onClick={deshacer} disabled={deshaciendo}>
                {deshaciendo ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Undo2 className="size-3.5" aria-hidden />}
                {c.resolucion.tipo === 'vinculo' ? 'Deshacer el vínculo' : 'Deshacer la revisión'}
              </Button>
            )}
          </div>
        )}

        {revisando && revisable && (
          <div ref={revisarRef}>
            <FormRevisado
              caso={c}
              focoInicial={props.modo === 'revisar'}
              onCancelar={() => setRevisando(false)}
              onListo={(resolucionIds) =>
                props.onResuelto({ caso: c, casosAfectados: [c.id], tipo: 'resolucion', ids: resolucionIds, mensaje: 'Marcado como revisado.' })
              }
            />
          </div>
        )}
      </div>

      {acciones && (
        <footer className="shrink-0 border-t border-white/[0.06] bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6">
          {descartable && (
            // Lo que hace "No es este", con su mismo ícono: no es un "revisado", es un "no van juntos".
            <p id={ayudaNoEsEste} className="mb-2.5 flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
              <Link2Off className="mt-px size-3.5 shrink-0" aria-hidden />
              {textoNoEsEste(c)}
            </p>
          )}
          <div className="flex gap-2">
            {confirmable && (
              <Button className="h-10 flex-1 gap-1.5 sm:flex-none" onClick={() => void confirmar()} disabled={decidiendo}>
                {confirmando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
                Confirmar
              </Button>
            )}
            {descartable && (
              <Button
                variant="outline"
                className="h-10 flex-1 gap-1.5 sm:flex-none"
                onClick={() => void descartar()}
                disabled={decidiendo}
                aria-describedby={ayudaNoEsEste}
              >
                {descartando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2Off className="size-4" aria-hidden />}
                No es este
              </Button>
            )}
            {hayCandidatos && (
              <Button className="h-10 flex-1 gap-1.5 sm:flex-none" onClick={accionVincular} disabled={vinculando != null}>
                {vinculando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
                Vincular
              </Button>
            )}
            {revisable && !revisando && (
              <Button variant={hayCandidatos ? 'outline' : 'default'} className="h-10 flex-1 gap-1.5 sm:flex-none" onClick={abrirRevisar}>
                <CheckCheck className="size-4" aria-hidden />
                Marcar revisado
              </Button>
            )}
            {props.texDisponible && (
              <Button
                variant="outline"
                className={cn('h-10 gap-1.5 sm:ml-auto sm:flex-none', soloTex ? 'flex-1' : 'w-10 shrink-0 px-0 sm:w-auto sm:px-3')}
                onClick={() => props.onPreguntarTex(c)}
                aria-label="Preguntale a Tex por este caso"
              >
                <TexIcono className="size-5" />
                <span className={cn('truncate', !soloTex && 'hidden sm:inline')}>Preguntale a Tex</span>
              </Button>
            )}
          </div>
        </footer>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// La cadena
// ─────────────────────────────────────────────────────────────────────────────

function Cadena({
  caso: c,
  cuenta,
  cuentas,
  hayCandidatos,
  puedeGestionar,
  onConectarCuenta,
}: {
  caso: CasoConciliacion
  cuenta: CuentaConciliacion | null
  cuentas: CuentaConciliacion[]
  hayCandidatos: boolean
  puedeGestionar: boolean
  onConectarCuenta: (c: CuentaConciliacion) => void
}) {
  const conComprobante = c.esperados.find((e) => e.comprobante) ?? null
  const comp = conComprobante?.comprobante ?? null
  const senales = senalesOrdenadas(c)
  const huboCruce = c.movimiento != null && c.esperados.length > 0
  // El comprobante de un cobro conjunto MARCADO es el del ancla y cubre la suma; en uno sin marcar
  // (un crédito que suma varios cobros) cada cobro tiene el suyo: se compara con ese cobro, no con la suma.
  const montoUnidad = c.senales.includes('grupo') && conComprobante ? conComprobante.monto : c.montoSistema
  const compIgual = comp?.monto != null ? Math.abs(comp.monto - montoUnidad) <= 1 : null
  // Un emparejamiento dudoso no se dibuja con "=": coincide el monto, pero no está probado.
  const simboloCruce = !huboCruce
    ? null
    : esEmparejamientoDudoso(c)
      ? '≈'
      : c.estado === 'conciliado' || c.diferencia === 0
        ? '='
        : '≠'
  const confianza = textoConfianza(c)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)_1rem_minmax(0,1fr)]">
        <Eslabon titulo="Sistema" icono={Server} faltante={c.esperados.length === 0 ? textoSinSistema(c, hayCandidatos) : null}>
          <DatosSistema esperados={c.esperados} total={c.montoSistema} />
        </Eslabon>
        <Union simbolo={comp == null || compIgual == null || c.esperados.length === 0 ? null : compIgual ? '=' : '≠'} />
        <Eslabon titulo="Comprobante" icono={ReceiptText} faltante={comp ? null : textoSinComprobante(c)}>
          {comp && <DatosComprobante comp={comp} />}
        </Eslabon>
        <Union simbolo={simboloCruce} />
        <Eslabon
          titulo="Mercado Pago"
          icono={Wallet}
          faltante={c.movimiento ? null : textoSinMovimiento(c, cuenta, cuentas, hayCandidatos)}
          accion={
            !c.movimiento && c.estado === 'sin_verificar' && cuenta?.estado === 'sin_conectar' && puedeGestionar ? (
              <Button size="sm" variant="secondary" className="mt-1 h-9 gap-1.5 self-start" onClick={() => onConectarCuenta(cuenta)}>
                <Plug className="size-3.5" aria-hidden />
                Conectar {cuenta.alias}
              </Button>
            ) : null
          }
        >
          {c.movimiento && <DatosMovimiento caso={c} m={c.movimiento} />}
        </Eslabon>
      </div>

      {huboCruce && senales.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Coincide:</span>
          {senales.map((s, i) => (
            <span
              key={s.id}
              className={cn(
                'rounded-full border px-2 py-0.5 text-xs',
                i === 0 && s.id === 'nro_operacion'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/12 bg-white/[0.04] text-zinc-300',
              )}
            >
              {s.texto}
            </span>
          ))}
          {/* Sólo cuando es cierto: dos créditos gemelos en la misma cuenta (no un monto distinto ni otra cuenta). */}
          {confianza && <span className="text-xs text-muted-foreground">· {confianza}</span>}
        </div>
      )}
    </div>
  )
}

function Union({ simbolo }: { simbolo: '=' | '≈' | '≠' | null }) {
  return (
    <div aria-hidden className="hidden items-center justify-center sm:flex">
      <span
        className={cn(
          'font-mono text-base',
          simbolo === '='
            ? 'text-emerald-400/80'
            : simbolo === '≠'
              ? 'text-amber-300'
              : simbolo === '≈'
                ? 'text-zinc-300'
                : 'text-zinc-600',
        )}
      >
        {simbolo ?? '∅'}
      </span>
    </div>
  )
}

function Eslabon({
  titulo,
  icono: Icono,
  faltante,
  accion,
  children,
}: {
  titulo: string
  icono: typeof Server
  faltante: string | null
  accion?: ReactNode
  children?: ReactNode
}) {
  return (
    <section
      aria-label={titulo}
      className={cn(
        'flex min-w-0 flex-col gap-2.5 rounded-xl border p-3',
        faltante ? 'border-dashed border-white/15' : 'border-white/10 bg-white/[0.02]',
      )}
    >
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
        <Icono className="size-3.5" aria-hidden />
        {titulo}
      </h3>
      {faltante ? <p className="text-xs leading-relaxed text-muted-foreground">{faltante}</p> : children}
      {accion}
    </section>
  )
}

function Dato({ etiqueta, children, mono }: { etiqueta: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{etiqueta}</p>
      <p className={cn('text-[13px] break-words text-zinc-100', mono && 'font-mono tabular-nums')}>{children}</p>
    </div>
  )
}

function DatosSistema({ esperados, total }: { esperados: EsperadoMP[]; total: number }) {
  if (esperados.length > 1) {
    return (
      <div className="space-y-2">
        <Dato etiqueta="Cobro conjunto" mono>
          {plata(total)}
        </Dato>
        <ul className="space-y-1.5">
          {esperados.map((e) => (
            <li key={e.clave} className="text-xs text-zinc-300">
              <span className="font-mono tabular-nums">{plata(e.monto)}</span> · {e.barbero ?? 'Sin barbero'}
              {e.cliente ? ` · ${e.cliente}` : ''} · {horaAR(e.tSistema)}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  const e = esperados[0]
  return (
    <div className="space-y-2">
      <Dato etiqueta="Monto" mono>
        {plata(e.monto)}
        {e.propina > 0 && <span className="text-xs text-muted-foreground"> (con {plata(e.propina)} de propina)</span>}
      </Dato>
      {e.barbero && <Dato etiqueta="Barbero">{e.barbero}</Dato>}
      {e.cliente && <Dato etiqueta="Cliente">{e.cliente}</Dato>}
      {e.servicio && <Dato etiqueta="Servicio">{e.servicio}</Dato>}
      <Dato etiqueta="Cuenta" mono>
        {e.alias ?? (e.tipo === 'sin_cuenta' ? 'Sin cuenta asignada' : '—')}
      </Dato>
      <Dato etiqueta="Hora del cobro" mono>
        {horaAR(e.tSistema)}
      </Dato>
      {e.tipo === 'propina_suelta' && <p className="text-xs text-muted-foreground">Propina transferida: el corte se cobró de otra forma.</p>}
      {e.esManual && (
        <span className="inline-flex w-fit rounded-full border border-white/12 px-2 py-0.5 text-[11px] text-zinc-300">Es alta manual</span>
      )}
    </div>
  )
}

function DatosComprobante({ comp }: { comp: ComprobanteEvidencia }) {
  return (
    <div className="space-y-2">
      {comp.tieneImagen && <Miniatura receiptId={comp.id} />}
      <Dato etiqueta="Monto leído" mono>
        {comp.monto != null ? plata(comp.monto) : '—'}
      </Dato>
      {comp.operacion && (
        <Dato etiqueta="Nº de operación" mono>
          {comp.operacion}
        </Dato>
      )}
      {comp.remitente && <Dato etiqueta="Remitente">{comp.remitente}</Dato>}
      {comp.hhmm && (
        <Dato etiqueta="Hora leída" mono>
          {comp.hhmm}
        </Dato>
      )}
      {comp.estado && <p className="text-[11px] text-muted-foreground">{ESTADO_COMPROBANTE[comp.estado] ?? comp.estado}</p>}
    </div>
  )
}

function DatosMovimiento({ caso: c, m }: { caso: CasoConciliacion; m: NonNullable<CasoConciliacion['movimiento']> }) {
  const ajeno = c.estado === 'ajeno'
  const crudo = [m.operationType, m.paymentTypeId, m.paymentMethodId].filter(Boolean).join(' · ')
  return (
    <div className="space-y-2">
      {c.estado === 'otra_cuenta' && c.aliasMp && (
        <p className="flex items-center gap-1.5 text-xs text-amber-300">
          <ArrowLeftRight className="size-3.5" aria-hidden />
          Entró en <span className="font-mono">{c.aliasMp}</span>
        </p>
      )}
      <Dato etiqueta="Monto" mono>
        {plata(m.monto)}
      </Dato>
      <Dato etiqueta="Hora" mono>
        {horaAR(m.fecha)}
      </Dato>
      {!ajeno && m.pagador && <Dato etiqueta="Pagador">{m.pagador}</Dato>}
      {!ajeno && m.pagadorDocUlt4 && (
        <Dato etiqueta="Documento" mono>
          ···{m.pagadorDocUlt4}
        </Dato>
      )}
      <Dato etiqueta="Nº de operación" mono>
        {m.mpId}
      </Dato>
      <Dato etiqueta="Tipo">{TIPO_MOVIMIENTO[m.tipo] ?? m.tipo}</Dato>
      {crudo && <p className="font-mono text-[10px] break-words text-muted-foreground/80">{crudo}</p>}
    </div>
  )
}

/** La imagen del comprobante: la URL firmada se pide al abrir el detalle. */
function Miniatura({ receiptId }: { receiptId: string }) {
  const [img, setImg] = useState<{ id: string; url: string | null; error: string | null } | null>(null)
  const [grande, setGrande] = useState(false)

  useEffect(() => {
    let vivo = true
    llamar(() => urlComprobanteConciliacion(receiptId)).then((r) => {
      if (!vivo) return
      setImg(r.ok ? { id: receiptId, url: r.url, error: null } : { id: receiptId, url: null, error: r.error })
    })
    return () => {
      vivo = false
    }
  }, [receiptId])

  const actual = img?.id === receiptId ? img : null
  if (!actual) {
    return <div className="h-28 w-full animate-pulse rounded-lg bg-white/[0.06]" role="status" aria-label="Cargando el comprobante" />
  }
  if (!actual.url) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileImage className="size-3.5" aria-hidden />
        No se pudo cargar la imagen.
      </p>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setGrande(true)}
        className="group relative block h-28 w-full overflow-hidden rounded-lg border border-white/10 bg-black/40"
        aria-label="Ver el comprobante en grande"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={actual.url} alt="" className="size-full object-cover object-top transition-transform group-hover:scale-[1.02]" />
      </button>
      <Dialog open={grande} onOpenChange={setGrande}>
        <DialogContent className="w-auto max-w-[min(92vw,720px)] p-2 sm:max-w-[min(92vw,720px)]">
          <DialogTitle className="sr-only">Comprobante</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={actual.url} alt="Comprobante de la transferencia" className="max-h-[85dvh] w-auto rounded-md object-contain" />
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo descartado a mano ("No es este")
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo que una persona descartó para este caso: el crédito que no es de este
 * cobro (o el cobro que no es de este crédito). El motor no los vuelve a
 * juntar; "Deshacer" lo devuelve al cruce automático.
 */
function Descartados({
  rechazados,
  diaDelCaso,
  puedeGestionar,
  deshaciendo,
  onDeshacer,
}: {
  rechazados: RechazoVista[]
  diaDelCaso: string | null
  puedeGestionar: boolean
  /** La clave del renglón que se está deshaciendo. */
  deshaciendo: string | null
  onDeshacer: (r: RechazoVista) => void
}) {
  return (
    <section aria-label="Descartado a mano" className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm">
      <ul className="space-y-3">
        {rechazados.map((r, i) => {
          const clave = r.ids.join(',')
          const idTexto = `descarte-${i}-${r.ids[0] ?? ''}`
          return (
            <li key={clave} className="space-y-1.5">
              <p id={idTexto} className="flex items-start gap-1.5 font-medium text-zinc-100">
                <Link2Off className="mt-0.5 size-4 shrink-0 text-zinc-300" aria-hidden />
                <span className="min-w-0 break-words">{textoRechazo(r, diaDelCaso)}</span>
              </p>
              <p className="pl-5.5 text-xs text-muted-foreground">
                {r.por ?? 'Alguien del equipo'}
                {r.en ? ` · ${fechaHoraAR(r.en)}` : ''}
              </p>
              {puedeGestionar && (
                <div className="pl-5.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => onDeshacer(r)}
                    disabled={deshaciendo != null}
                    aria-describedby={idTexto}
                  >
                    {deshaciendo === clave ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Undo2 className="size-3.5" aria-hidden />}
                    Deshacer
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Dónde se buscó lo que falta
// ─────────────────────────────────────────────────────────────────────────────

function ventana(iso: string): { desde: string; hasta: string } {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return { desde: '—', hasta: '—' }
  return { desde: horaAR(new Date(t - VENTANA_BUSQUEDA_MS).toISOString()), hasta: horaAR(new Date(t + VENTANA_BUSQUEDA_MS).toISOString()) }
}

function textoSinSistema(c: CasoConciliacion, hayCandidatos: boolean): string {
  if (c.estado === 'ajeno') return 'No parece un cobro: no se busca en el sistema.'
  // Un crédito que todavía no se pudo cruzar (entró hace minutos, o su cobro no se leyó o no se
  // puede verificar): no "sobra". El porqué lo dice la explicación del caso, arriba.
  if (esCreditoSinCruzar(c)) return 'Todavía no tiene un cobro asociado: no cuenta como plata que sobra.'
  if (hayCandidatos) return 'No hay un cobro registrado a esa hora. Hay cobros parecidos cerca: mirá abajo.'
  const iso = c.movimiento?.fecha ?? c.fecha
  const v = ventana(iso)
  return `Busqué un cobro de ${plata(c.montoMp)} en el sistema entre las ${v.desde} y las ${v.hasta}: no hay ninguno sin pareja${salvoDescartados(c, 'cobro', iso, VENTANA_BUSQUEDA_MS)}.`
}

function textoSinComprobante(c: CasoConciliacion): string {
  if (esCreditoSinCruzar(c)) return 'Sin un cobro asociado todavía, no hay comprobante.'
  if (c.esperados.length === 0) return 'Sin un cobro en el sistema, no hay comprobante.'
  const e = c.esperados[0]
  if (e.esManual) return 'Es alta manual: se cargó sin comprobante.'
  if (e.tipo === 'propina_suelta') return 'La propina no tiene comprobante propio.'
  return 'Se cobró sin escanear el comprobante.'
}

function textoSinMovimiento(
  c: CasoConciliacion,
  cuenta: CuentaConciliacion | null,
  cuentas: CuentaConciliacion[],
  hayCandidatos: boolean,
): string {
  const t = c.esperados[0]?.tSistema ?? c.fecha
  if (c.estado === 'pendiente') {
    return cuenta?.sincronizadaHasta
      ? `Mercado Pago se leyó hasta las ${horaAR(cuenta.sincronizadaHasta)} y este cobro es de las ${horaAR(t)}: se cruza en la próxima lectura.`
      : 'Mercado Pago todavía no se leyó hasta esta hora: se cruza en la próxima lectura.'
  }
  if (c.estado === 'sin_verificar') {
    const alias = c.alias ?? cuenta?.alias
    if (!alias) return 'El cobro no tiene una cuenta asignada: no hay dónde buscarlo.'
    if (cuenta?.estado === 'banco') return `${alias} es una cuenta de banco: no se puede leer desde acá. Controlalo con el comprobante.`
    if (cuenta?.estado === 'error' || cuenta?.estado === 'revocada') return `No pudimos leer ${alias}: ${cuenta.detalleEstado}.`
    if (cuenta?.estado === 'sin_alias') return 'La cuenta no tiene alias: no se puede conectar.'
    if (!cuenta || cuenta.estado === 'sin_conectar') return `${alias} no está conectada: no hay contra qué comparar.`
    return c.explicacion || 'Mercado Pago no se leyó para esta fecha.'
  }
  if (hayCandidatos) return 'No entró en el momento del cobro. Hay movimientos parecidos cerca: mirá abajo.'
  const v = ventana(t)
  const n = cuentas.filter(estaConectada).length
  return `Busqué ${plata(c.montoSistema)} en ${n === 1 ? 'la cuenta conectada' : `las ${n} cuentas conectadas`} entre las ${v.desde} y las ${v.hasta}: nada${salvoDescartados(c, 'credito', t, VENTANA_BUSQUEDA_MS)}.`
}

// ─────────────────────────────────────────────────────────────────────────────
// Podría ser
// ─────────────────────────────────────────────────────────────────────────────

function FilaCandidato({
  probabilidad,
  monto,
  cuando,
  alias,
  motivo,
  cargando,
  deshabilitado,
  focoInicial,
  onVincular,
}: {
  probabilidad: string | null
  monto: number
  cuando: string
  alias: string | null
  motivo: string
  cargando: boolean
  deshabilitado: boolean
  focoInicial: boolean
  onVincular: () => void
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="font-mono font-medium text-zinc-100 tabular-nums">{plata(monto)}</span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{cuando}</span>
          {alias && <span className="truncate font-mono text-xs text-muted-foreground">{alias}</span>}
          {probabilidad && (
            <span className="rounded-full border border-white/12 px-1.5 text-[10px] text-zinc-300">{probabilidad}</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{motivo}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-9 shrink-0 gap-1.5"
        onClick={onVincular}
        disabled={deshabilitado}
        data-foco-inicial={focoInicial ? '' : undefined}
      >
        {cargando ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
        Vincular
      </Button>
    </li>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Marcar revisado: el motivo es obligatorio
// ─────────────────────────────────────────────────────────────────────────────

function FormRevisado({
  caso,
  focoInicial,
  onCancelar,
  onListo,
}: {
  caso: CasoConciliacion
  focoInicial: boolean
  onCancelar: () => void
  onListo: (resolucionIds: string[]) => void
}) {
  const [motivo, setMotivo] = useState<MotivoRevision | null>(null)
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notaObligatoria = motivo === 'otro'
  const listo = motivo != null && (!notaObligatoria || nota.trim().length >= 3) && !enviando

  async function guardar() {
    if (!motivo || !listo) return
    setEnviando(true)
    setError(null)
    const r = await llamar(() => resolverCaso(pedidoRevisado(caso, motivo, nota)))
    setEnviando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onListo(r.resolucionIds)
  }

  return (
    <fieldset data-sin-atajos className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
      <legend className="sr-only">Marcar revisado</legend>
      <p className="text-sm font-semibold">¿Qué fue?</p>
      <div className="flex flex-wrap gap-1.5">
        {MOTIVOS_REVISION.map((m, i) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={motivo === m.id}
            onClick={() => setMotivo(m.id)}
            data-foco-inicial={focoInicial && i === 0 ? '' : undefined}
            className={cn(
              'min-h-9 rounded-full border px-3 text-[13px] transition-colors',
              motivo === m.id ? 'border-zinc-200 bg-zinc-100 text-zinc-900' : 'border-white/15 text-zinc-300 hover:bg-white/5',
            )}
          >
            {m.etiqueta}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        <label htmlFor={`nota-${caso.id}`} className="text-xs text-muted-foreground">
          Nota {notaObligatoria ? '(contá qué fue)' : '(opcional)'}
        </label>
        <Textarea
          id={`nota-${caso.id}`}
          value={nota}
          onChange={(e) => setNota(e.target.value.slice(0, 300))}
          rows={2}
          className="min-h-[64px] resize-none bg-transparent"
          placeholder={notaObligatoria ? 'Por ejemplo: lo pagó el hermano desde otra cuenta' : ''}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" className="h-10 sm:h-9" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
        <Button className="h-10 gap-1.5 sm:h-9" onClick={guardar} disabled={!listo}>
          {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCheck className="size-4" aria-hidden />}
          Marcar revisado
        </Button>
      </div>
    </fieldset>
  )
}

