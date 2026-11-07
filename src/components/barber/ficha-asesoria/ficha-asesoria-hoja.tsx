'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { Dialog as DialogPrimitive } from 'radix-ui'
import {
  AlertTriangle,
  Check,
  History,
  Info,
  MessageCircleQuestionMark,
  NotebookPen,
  Plus,
  RotateCw,
  Scissors,
  Smartphone,
  Sparkles,
} from 'lucide-react'
import { DialogPortal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { vibrate } from '@/lib/barber-feedback'
import { haceCuanto, primerNombre } from '@/lib/fotos-corte/textos'
import {
  ALTURAS_FADE,
  ATAJOS_MOLESTIA,
  CAPITULOS,
  CORTES,
  FORMAS,
  FRECUENCIAS,
  NUMEROS_FADE,
  PARTES_QUE_CRECEN,
  PARTICULARIDADES,
  PREGUNTAS,
  PRODUCTOS,
  TOPE_CORTE_OTRO,
  TOPE_DETALLE_MOLESTIA,
  ZONAS_CRANEO,
  aplicaPregunta,
  aplicarCambios,
  cambioPregunta,
  progresoFicha,
  respondida,
  textoDeValor,
  type CampoFicha,
  type CapituloFicha,
  type ClaveAltura,
  type ClavePregunta,
  type ClaveZona,
  type DatosFicha,
  type PreviaFicha,
} from '@/lib/asesoria/ficha'
import { useFichaAsesoria } from '@/hooks/use-ficha-asesoria'
import { useUltimosCortes } from '@/hooks/use-ultimos-cortes'
import { guardarFichaYa } from '@/stores/ficha-asesoria-store'
import { useFotosCorteStore } from '@/stores/fotos-corte-store'
import type { QueueEntry } from '@/lib/types/database'
import { CORTES_EN_TARJETA_ACTIVA } from '../active-client-card'
import { FotosDelCobro } from '../fotos-del-cobro'
import { VisorFotos, type FotoDelVisor } from '../visor-fotos'
import { CabezaFade, CabezaZonas, SiluetaForma } from './ilustraciones'
import {
  EstadoGuardadoFicha,
  OpcionFicha,
  PeinesNumero,
  ReglaFrecuencia,
  TarjetaPerforada,
  claseOpcionFicha,
} from './controles'

/**
 * - `inicio`: el barbero acaba de tomar a un cliente que pidió asesoría (sale
 *   del ESTADO de la entrada, como el pop-up de antes: cubre Atender, Reclamar
 *   y el inicio desde el dashboard). Cerrarla la confirma.
 * - `consulta`: la abrió el barbero (la tarjeta del corte, el sello, la ficha
 *   del cliente).
 */
export type ModoFicha = 'inicio' | 'consulta'

const SIN_DATOS: DatosFicha = {}

/** Clave del último agujero (la foto), que no es una pregunta de los datos. */
const FOTO = 'foto'

/** Los agujeros de la tarjeta, en orden: las preguntas y la foto. */
const ORDEN_AGUJEROS: readonly string[] = [...PREGUNTAS.map((p) => p.clave), FOTO]

interface FichaAsesoriaHojaProps {
  /** La entrada de la fila del cliente (su ficha se guarda con esta visita). */
  entrada: QueueEntry | null
  /** null = cerrada. */
  modo: ModoFicha | null
  /** Cualquier cierre («Listo», Escape). En `inicio` el panel confirma la asesoría. */
  onCerrar: () => void
}

/**
 * La ficha de asesoría a pantalla completa, para completarla MIENTRAS se
 * asesora (no al cobrar: el cobro es otro momento).
 *
 * Sale de la ranura del reloj, debajo de la hora (que no se tapa nunca: es
 * decisión del dueño), como una ficha que la máquina va imprimiendo. Cada
 * respuesta es un toque, perfora su agujero en la tarjeta de arriba y, si
 * todavía falta algo, la hoja baja sola a la pregunta siguiente. Se guarda sola
 * (ver ficha-asesoria-store): «Listo» sólo la cierra.
 *
 * Es un Dialog de Radix portaleado a #giro-portales (gira 180° con el panel);
 * no se cierra tocando afuera (la hora está afuera y es fácil rozarla): sólo con
 * «Listo» o Escape.
 */
export function FichaAsesoriaHoja({ entrada, modo, onCerrar }: FichaAsesoriaHojaProps) {
  // Lo último que se mostró: mientras la hoja anima la salida, el contenido no
  // se vacía (la entrada pudo dejar de estar en curso).
  const [mostrado, setMostrado] = useState<{ entrada: QueueEntry; modo: ModoFicha } | null>(null)
  if (modo !== null && entrada !== null && (mostrado?.entrada !== entrada || mostrado.modo !== modo)) {
    setMostrado({ entrada, modo })
  }
  const abierta = modo !== null && entrada !== null
  const vista = modo !== null && entrada !== null ? { entrada, modo } : mostrado
  const clienteId = vista?.entrada.client?.id ?? vista?.entrada.client_id ?? null

  const cerrar = useCallback(() => {
    // Lo que quedó en el respiro sale ya.
    if (clienteId) guardarFichaYa(clienteId)
    onCerrar()
  }, [clienteId, onCerrar])

  return (
    <DialogPrimitive.Root open={abierta} onOpenChange={(o) => { if (!o) cerrar() }}>
      <DialogPortal>
        <DialogPrimitive.Overlay className="fixed inset-x-0 bottom-0 top-[var(--alto-banda)] z-[110] bg-[oklch(0.2_0.012_260/0.42)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="ficha-hoja fixed inset-x-0 bottom-0 top-[var(--alto-banda)] z-[110] mx-auto flex w-full max-w-[56rem] flex-col outline-none"
        >
          <div aria-hidden className="ranura-boca" />
          {vista && (
            <CuerpoFicha
              key={vista.entrada.id}
              entrada={vista.entrada}
              modo={vista.modo}
              abierta={abierta}
              onListo={cerrar}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  )
}

function CuerpoFicha({
  entrada,
  modo,
  abierta,
  onListo,
}: {
  entrada: QueueEntry
  modo: ModoFicha
  abierta: boolean
  onListo: () => void
}) {
  const clienteId = entrada.client?.id ?? entrada.client_id ?? null
  const { ficha, cambiar, reintentar, editable } = useFichaAsesoria(clienteId, entrada.id, abierta)
  // Misma clave de caché que la tarjeta del corte: no es una llamada más.
  const { estado: historial } = useUltimosCortes(abierta ? clienteId : null, { limite: CORTES_EN_TARJETA_ACTIVA })

  const datos = ficha?.datos ?? SIN_DATOS
  const previa = ficha?.previa ?? null
  const progreso = useMemo(() => progresoFicha(datos), [datos])
  const fotosDeLaVisita = useFotosCorteStore((s) => {
    const fotos = s.cobros[entrada.id]?.fotos
    let n = 0
    if (fotos) for (const f of fotos) if (f.estado !== 'error') n++
    return n
  })
  const conFoto = entrada.status === 'in_progress'

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const secciones = useRef<Partial<Record<string, HTMLElement | null>>>({})
  const [actual, setActual] = useState<string | null>(PREGUNTAS[0].clave)
  const [ola, setOla] = useState<number | null>(null)
  const [borradorMolestia, setBorradorMolestia] = useState<string | null>(null)
  const [borradorOtro, setBorradorOtro] = useState<string | null>(null)
  const [fotoVista, setFotoVista] = useState<number | null>(null)

  const nombre = entrada.client?.name?.trim() || 'Cliente'
  const pila = primerNombre(nombre) ?? nombre
  const notas = historial.tipo === 'listo' ? historial.datos.cliente.notas?.trim() || null : null

  // Qué pregunta se está mirando: la primera cuyo final pasa del tercio de
  // arriba del área. Con offsetTop (layout), no con rectángulos de pantalla:
  // con la tablet girada 180° esos van al revés. El navegador ya manda un
  // `scroll` por cuadro como mucho, y son 12 lecturas.
  const alScrollear = useCallback(() => {
    const cont = scrollRef.current
    if (!cont) return
    const linea = cont.scrollTop + cont.clientHeight * 0.3
    let elegida: string | null = null
    for (const clave of ORDEN_AGUJEROS) {
      const sec = secciones.current[clave]
      if (!sec) continue
      elegida = clave
      if (sec.offsetTop + sec.offsetHeight > linea) break
    }
    if (elegida) setActual((prev) => (prev === elegida ? prev : elegida))
  }, [])

  const registrar = useCallback(
    (clave: string) => (el: HTMLElement | null) => {
      secciones.current[clave] = el
    },
    [],
  )

  /** Lleva una pregunta arriba del área. A mano, con offsetTop: con la tablet girada 180° los rectángulos de pantalla van al revés. */
  const irA = useCallback((clave: string) => {
    const cont = scrollRef.current
    const sec = secciones.current[clave]
    if (!cont || !sec) return
    const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    cont.scrollTo({ top: Math.max(0, sec.offsetTop - 10), behavior: reducir ? 'auto' : 'smooth' })
  }, [])

  /** Después de una respuesta de un toque: la siguiente que falta, si no se ve bien. */
  function avanzarDesde(clave: ClavePregunta, nuevos: DatosFicha) {
    const i = PREGUNTAS.findIndex((p) => p.clave === clave)
    const siguiente = PREGUNTAS.slice(i + 1).find((p) => aplicaPregunta(nuevos, p.clave) && !respondida(nuevos, p.clave))
    const destino = siguiente?.clave ?? (progresoFicha(nuevos).completa && conFoto ? FOTO : null)
    if (!destino) return
    const cont = scrollRef.current
    const sec = secciones.current[destino]
    if (!cont || !sec) return
    const arriba = cont.scrollTop
    const abajo = cont.scrollTop + cont.clientHeight
    const seVe = sec.offsetTop >= arriba && sec.offsetTop + Math.min(sec.offsetHeight, cont.clientHeight * 0.45) <= abajo
    if (seVe) return
    window.setTimeout(() => irA(destino), 170)
  }

  /** Toda respuesta pasa por acá: se ve en el acto, vibra y se guarda sola. */
  function responder(campo: CampoFicha, valor: unknown, avanzar?: ClavePregunta) {
    if (!editable) return
    vibrate(8)
    const nuevos = aplicarCambios(
      datos,
      valor === undefined ? {} : ({ [campo]: valor } as DatosFicha),
      valor === undefined ? [campo] : [],
    )
    const estabaCompleta = progresoFicha(datos).completa
    cambiar(campo, valor)
    if (!estabaCompleta && progresoFicha(nuevos).completa) {
      setOla(Date.now())
      vibrate([18, 60, 18, 60, 40])
    }
    // Completando una ficha (no corrigiendo una completa): a la siguiente.
    if (avanzar && !estabaCompleta) avanzarDesde(avanzar, nuevos)
  }

  function elegirUna<K extends string>(campo: CampoFicha, clave: K, pregunta: ClavePregunta) {
    const actualValor = datos[campo] as K | undefined
    if (actualValor === clave) responder(campo, undefined)
    else responder(campo, clave, pregunta)
  }

  function alternar<K extends string>(
    campo: CampoFicha,
    clave: K,
    opciones: ReadonlyArray<{ clave: K; opuesta?: string }>,
  ) {
    const lista = (datos[campo] as K[] | undefined) ?? []
    const opuesta = opciones.find((o) => o.clave === clave)?.opuesta
    const nueva = lista.includes(clave) ? lista.filter((x) => x !== clave) : [...lista.filter((x) => x !== opuesta), clave]
    const ordenada = opciones.map((o) => o.clave).filter((c) => nueva.includes(c))
    responder(campo, ordenada.length > 0 ? ordenada : undefined)
  }

  function ninguna(campo: CampoFicha, pregunta: ClavePregunta) {
    const lista = datos[campo] as unknown[] | undefined
    if (Array.isArray(lista) && lista.length === 0) responder(campo, undefined)
    else responder(campo, [], pregunta)
  }

  // Textos libres: lo que se tipea vive en un borrador local (el servidor
  // normaliza los espacios y no hay que moverle el cursor a nadie).
  const textoMolestia = borradorMolestia ?? datos.molesta_detalle ?? ''
  const textoOtro = borradorOtro ?? datos.corte_otro ?? ''
  function escribirMolestia(texto: string) {
    const recortado = texto.slice(0, TOPE_DETALLE_MOLESTIA)
    setBorradorMolestia(recortado)
    const limpio = recortado.replace(/\s+/g, ' ').trim()
    if (editable) cambiar('molesta_detalle', limpio || undefined)
  }
  function escribirOtro(texto: string) {
    const recortado = texto.slice(0, TOPE_CORTE_OTRO)
    setBorradorOtro(recortado)
    const limpio = recortado.replace(/\s+/g, ' ').trim()
    if (editable) cambiar('corte_otro', limpio || undefined)
  }
  function sumarAtajo(atajo: string) {
    vibrate(8)
    const base = textoMolestia.trim()
    const frase = base ? `${base.replace(/[.,;]$/, '')}, ${atajo.charAt(0).toLowerCase()}${atajo.slice(1)}` : atajo
    escribirMolestia(frase)
  }

  const agujeros = [
    ...PREGUNTAS.map((p, i) => ({
      clave: p.clave as string,
      numero: i + 1,
      rotulo: p.corto,
      estado: !aplicaPregunta(datos, p.clave)
        ? ('no_aplica' as const)
        : respondida(datos, p.clave)
          ? ('hecha' as const)
          : ('falta' as const),
    })),
    {
      clave: FOTO,
      numero: PREGUNTAS.length + 1,
      rotulo: 'Foto del corte',
      estado: fotosDeLaVisita > 0 ? ('hecha' as const) : ('falta' as const),
    },
  ]

  const subtitulo = previa
    ? `Actualizás la de ${previa.fecha ? haceCuanto(previa.fecha) : 'antes'}${previa.barbero ? `, con ${primerNombre(previa.barbero)}` : ''}`
    : ficha?.carga.tipo === 'cargando' && !ficha.servidor
      ? 'Buscando si ya tiene una…'
      : 'Ficha nueva'

  const fotosAntes: FotoDelVisor[] = (ficha?.fotos ?? []).map((f, i) => ({
    id: f.id,
    src: f.url,
    alt: `Foto ${i + 1} del corte de la ficha`,
    epigrafe: `${haceCuanto(f.fecha)} · la ficha anterior`,
  }))

  const deshabilitada = !editable
  const propsPregunta = (clave: ClavePregunta) => ({
    clave,
    numero: PREGUNTAS.findIndex((p) => p.clave === clave) + 1,
    datos,
    previa,
    registrar: registrar(clave),
  })

  return (
    <div className="ficha-carton mx-2.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[1.75rem] rounded-t-[0.625rem] bg-card text-card-foreground shadow-[0_28px_70px_-24px_oklch(0.2_0.012_260/0.65)]">
      {/* ── Encabezado: de quién es, cómo va el guardado y la tarjeta perforada ── */}
      <header className="relative shrink-0 border-b border-fuchsia-500/20 bg-[oklch(0.975_0.016_330)] px-5 pb-3 pt-4 sm:px-7">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-fuchsia-700">
              <NotebookPen className="size-3.5" aria-hidden />
              Ficha de asesoría
            </p>
            <DialogPrimitive.Title className="mt-1 text-[1.625rem] font-bold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere] max-sm:text-2xl">
              {nombre}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-0.5 text-[0.9375rem] text-muted-foreground">
              {subtitulo}
            </DialogPrimitive.Description>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <EstadoGuardadoFicha
              estado={ficha?.guardado ?? 'al_dia'}
              error={ficha?.errorGuardado ?? null}
              reintentable={ficha?.errorReintentable ?? true}
              huboCambios={!!ficha?.guardadoEn}
              onReintentar={reintentar}
            />
            {progreso.completa && (
              <span
                key={ola ?? 'ya'}
                className={cn(
                  'inline-flex -rotate-6 items-center gap-1 rounded-md border-2 border-fuchsia-600 bg-card/70 px-2 py-0.5 text-[0.75rem] font-black uppercase tracking-[0.12em] text-fuchsia-700',
                  ola !== null && 'ficha-sello-golpe',
                )}
              >
                <Check className="size-3.5" strokeWidth={3} aria-hidden />
                Completa
              </span>
            )}
          </div>
        </div>
        <div className="mt-3">
          <TarjetaPerforada agujeros={agujeros} actual={actual} ola={ola} onIr={irA} />
        </div>
      </header>

      {/* ── Las preguntas ── */}
      <div
        ref={scrollRef}
        tabIndex={-1}
        onScroll={alScrollear}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
      >
        <Contexto
          modo={modo}
          pila={pila}
          previa={previa}
          notas={notas}
          fotosAntes={fotosAntes}
          onVerFoto={setFotoVista}
          errorCarga={ficha?.carga.tipo === 'error' ? ficha.carga.error : null}
          onReintentar={reintentar}
          sinCliente={!clienteId}
        />

        <Capitulo capitulo="charla" />
        <Pregunta {...propsPregunta('frecuencia')} titulo="¿Cada cuánto se corta?">
          <ReglaFrecuencia
            opciones={FRECUENCIAS}
            valor={datos.frecuencia}
            deshabilitada={deshabilitada}
            etiqueta="Cada cuánto se corta"
            onElegir={(c) => elegirUna('frecuencia', c, 'frecuencia')}
          />
        </Pregunta>

        <Pregunta {...propsPregunta('molesta')} titulo="¿Qué le molesta o no le gusta?">
          <div className="grid grid-cols-2 gap-3">
            <OpcionFicha
              elegida={datos.molesta === false}
              deshabilitada={deshabilitada}
              onElegir={() => responder('molesta', datos.molesta === false ? undefined : false, 'molesta')}
              className="justify-center text-center"
            >
              No, nada
            </OpcionFicha>
            <OpcionFicha
              elegida={datos.molesta === true}
              deshabilitada={deshabilitada}
              onElegir={() => responder('molesta', datos.molesta === true ? undefined : true)}
              className="justify-center text-center"
            >
              Sí
            </OpcionFicha>
          </div>
          <Desplegable abierto={datos.molesta === true}>
            <div className="space-y-3 pt-4">
              <textarea
                value={textoMolestia}
                onChange={(e) => escribirMolestia(e.target.value)}
                disabled={deshabilitada}
                rows={2}
                maxLength={TOPE_DETALLE_MOLESTIA}
                placeholder="¿Qué no le gusta? Ej: que le quede muy corto arriba"
                aria-label="Qué le molesta o no le gusta"
                className="min-h-[5.5rem] w-full resize-none rounded-2xl border-2 border-fuchsia-500/35 bg-card p-4 text-[1.0625rem] leading-snug placeholder:text-muted-foreground focus:border-fuchsia-500/70 focus:outline-none"
              />
              <div className="flex flex-wrap gap-2" aria-label="Atajos">
                {ATAJOS_MOLESTIA.map((a) => (
                  <button
                    key={a}
                    type="button"
                    disabled={deshabilitada}
                    onClick={() => sumarAtajo(a)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3.5 text-[0.9375rem] font-medium outline-none touch-manipulation motion-safe:active:scale-95 hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <Plus className="size-3.5 text-fuchsia-700" aria-hidden />
                    {a}
                  </button>
                ))}
              </div>
            </div>
          </Desplegable>
        </Pregunta>

        <Pregunta {...propsPregunta('crecer')} titulo="¿Se está dejando crecer alguna parte?">
          <GrillaVarias
            opciones={PARTES_QUE_CRECEN}
            valor={datos.crecer}
            textoNinguna="Nada"
            deshabilitada={deshabilitada}
            onAlternar={(c) => alternar('crecer', c, PARTES_QUE_CRECEN)}
            onNinguna={() => ninguna('crecer', 'crecer')}
          />
        </Pregunta>

        <Pregunta {...propsPregunta('productos_usa')} titulo="¿Usa algún producto?">
          <GrillaVarias
            opciones={PRODUCTOS}
            valor={datos.productos_usa}
            textoNinguna="Ninguno"
            deshabilitada={deshabilitada}
            onAlternar={(c) => alternar('productos_usa', c, PRODUCTOS)}
            onNinguna={() => ninguna('productos_usa', 'productos_usa')}
          />
        </Pregunta>

        <Pregunta
          {...propsPregunta('productos_recomendados')}
          titulo="¿Se le recomendó algún producto?"
          ayuda="Si lo hay en el local, al cobrar te lo recordamos."
        >
          <GrillaVarias
            opciones={PRODUCTOS}
            valor={datos.productos_recomendados}
            textoNinguna="Ninguno"
            deshabilitada={deshabilitada}
            onAlternar={(c) => alternar('productos_recomendados', c, PRODUCTOS)}
            onNinguna={() => ninguna('productos_recomendados', 'productos_recomendados')}
          />
        </Pregunta>

        <Capitulo capitulo="cabeza" />
        <Pregunta {...propsPregunta('forma')} titulo="Forma superior">
          <div role="group" aria-label="Forma superior" className="grid grid-cols-3 gap-3">
            {FORMAS.map((f) => {
              const elegida = datos.forma === f.clave
              return (
                <button
                  key={f.clave}
                  type="button"
                  aria-pressed={elegida}
                  disabled={deshabilitada}
                  onClick={() => elegirUna('forma', f.clave, 'forma')}
                  className={cn(claseOpcionFicha(elegida), 'flex-col justify-center gap-2 py-4 text-center')}
                >
                  <SiluetaForma forma={f.clave} className="mx-auto w-14 sm:w-16" />
                  <span>{f.texto}</span>
                </button>
              )
            })}
          </div>
        </Pregunta>

        <Pregunta
          {...propsPregunta('craneo')}
          titulo="Particularidades craneales"
          ayuda="Tocá la zona en la cabeza o el nombre."
        >
          <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <div className="mx-auto w-full max-w-[14rem] rounded-3xl bg-muted/40 p-3">
              <CabezaZonas
                elegidas={datos.craneo ?? []}
                deshabilitada={deshabilitada}
                onTocar={(z: ClaveZona) => {
                  // El punto del occipital es uno para las dos opciones y va
                  // rotando: nada → prominente → plano → nada.
                  if (z === 'occipital_prominente') {
                    const lista = datos.craneo ?? []
                    const hayAlguna = lista.includes('occipital_prominente') || lista.includes('occipital_plano')
                    alternar('craneo', hayAlguna ? 'occipital_plano' : 'occipital_prominente', ZONAS_CRANEO)
                    return
                  }
                  alternar('craneo', z, ZONAS_CRANEO)
                }}
              />
            </div>
            <GrillaVarias
              opciones={ZONAS_CRANEO}
              valor={datos.craneo}
              textoNinguna="Ninguna"
              columnas="2"
              deshabilitada={deshabilitada}
              onAlternar={(c) => alternar('craneo', c, ZONAS_CRANEO)}
              onNinguna={() => ninguna('craneo', 'craneo')}
            />
          </div>
        </Pregunta>

        <Capitulo capitulo="corte" />
        <Pregunta {...propsPregunta('corte')} titulo="¿Qué corte se realiza?">
          <div role="group" aria-label="Qué corte se realiza" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {CORTES.map((c) => (
              <OpcionFicha
                key={c.clave}
                elegida={datos.corte === c.clave}
                deshabilitada={deshabilitada}
                onElegir={() => {
                  if (c.clave === 'otro') responder('corte', datos.corte === 'otro' ? undefined : 'otro')
                  else elegirUna('corte', c.clave, 'corte')
                }}
                ninguna={c.clave === 'otro'}
              >
                {c.clave === 'otro' ? 'Otro (escribir cuál)' : c.texto}
              </OpcionFicha>
            ))}
          </div>
          <Desplegable abierto={datos.corte === 'otro'}>
            <div className="pt-3">
              <input
                type="text"
                value={textoOtro}
                onChange={(e) => escribirOtro(e.target.value)}
                disabled={deshabilitada}
                maxLength={TOPE_CORTE_OTRO}
                enterKeyHint="done"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                placeholder="¿Cuál? Ej: Pompadour"
                aria-label="Qué otro corte"
                className="h-14 w-full rounded-2xl border-2 border-fuchsia-500/35 bg-card px-4 text-[1.0625rem] placeholder:text-muted-foreground focus:border-fuchsia-500/70 focus:outline-none"
              />
            </div>
          </Desplegable>
        </Pregunta>

        <Pregunta {...propsPregunta('fade_altura')} titulo="Altura del fade" ayuda="Tocá la altura en la cabeza o elegila al costado.">
          <div className="grid items-center gap-5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <div className="mx-auto w-full max-w-[14rem] rounded-3xl bg-muted/40 p-3">
              <CabezaFade
                altura={datos.fade_altura}
                onTocarAltura={
                  deshabilitada
                    ? undefined
                    : (a) => {
                        if (datos.fade_altura !== a) responder('fade_altura', a, 'fade_altura')
                      }
                }
              />
            </div>
            <div role="group" aria-label="Altura del fade" className="grid gap-2.5">
              {ALTURAS_FADE.filter((a) => a.clave !== 'tijera').map((a) => (
                <OpcionFicha
                  key={a.clave}
                  elegida={datos.fade_altura === a.clave}
                  deshabilitada={deshabilitada}
                  onElegir={() => elegirUna<ClaveAltura>('fade_altura', a.clave, 'fade_altura')}
                >
                  {a.texto}
                </OpcionFicha>
              ))}
              <OpcionFicha
                elegida={datos.fade_altura === 'tijera'}
                deshabilitada={deshabilitada}
                onElegir={() => elegirUna<ClaveAltura>('fade_altura', 'tijera', 'fade_altura')}
                ninguna
              >
                <span className="inline-flex items-center gap-2">
                  <Scissors className="size-4" aria-hidden />
                  Tijera · sin fade
                </span>
              </OpcionFicha>
            </div>
          </div>
        </Pregunta>

        <Pregunta {...propsPregunta('fade_numero')} titulo="¿Desde qué número el fade?">
          {datos.fade_altura === 'tijera' ? (
            <p className="flex items-center gap-2 rounded-2xl border border-dashed px-4 py-3.5 text-[0.9375rem] text-muted-foreground">
              <Scissors className="size-4 shrink-0" aria-hidden />
              Es a tijera: no lleva número.
            </p>
          ) : (
            <PeinesNumero
              opciones={NUMEROS_FADE}
              valor={datos.fade_numero}
              deshabilitada={deshabilitada}
              etiqueta="Desde qué número el fade"
              onElegir={(c) => elegirUna('fade_numero', c, 'fade_numero')}
            />
          )}
        </Pregunta>

        <Capitulo capitulo="cuidados" />
        <Pregunta {...propsPregunta('particularidades')} titulo="¿Tiene alguna particularidad?">
          <GrillaVarias
            opciones={PARTICULARIDADES}
            valor={datos.particularidades}
            textoNinguna="Ninguna"
            deshabilitada={deshabilitada}
            onAlternar={(c) => alternar('particularidades', c, PARTICULARIDADES)}
            onNinguna={() => ninguna('particularidades', 'particularidades')}
          />
        </Pregunta>

        {/* ── La foto: la del corte terminado, por el celular (la sesión de la entrada) ── */}
        <section
          ref={registrar(FOTO)}
          data-pregunta={FOTO}
          aria-labelledby="ficha-foto"
          className="px-5 py-6 sm:px-7"
        >
          <EncabezadoPregunta
            numero={PREGUNTAS.length + 1}
            hecha={fotosDeLaVisita > 0}
            titulo="Fotografía del corte"
            id="ficha-foto"
            ayuda={conFoto ? 'Con el corte terminado. También la podés sacar al cobrar.' : undefined}
          />
          {conFoto ? (
            <FotosDelCobro entradaId={entrada.id} abierto={abierta} encabezado={false} />
          ) : (
            <p className="flex items-center gap-2 rounded-2xl border border-dashed px-4 py-3.5 text-[0.9375rem] text-muted-foreground">
              <Smartphone className="size-4 shrink-0" aria-hidden />
              La foto se saca con el corte terminado, desde acá o al cobrar.
            </p>
          )}
        </section>

        {entrada.pidio_asesoria === true && (
          <p className="mx-5 mb-8 flex items-start gap-2 rounded-2xl bg-muted/50 px-4 py-3 text-sm leading-snug text-muted-foreground sm:mx-7">
            <Info className="mt-px size-4 shrink-0" aria-hidden />
            {entrada.appointment_id ? (
              <span>Es un turno: al cobrar, elegí lo que se le hizo.</span>
            ) : (
              <span>
                Al cobrar, elegí el servicio que le hiciste. Si no se hizo nada, cerralo como{' '}
                <span className="font-semibold text-foreground">Solo asesoría</span>.
              </span>
            )}
          </p>
        )}
      </div>

      {/* ── Abajo: cuánto falta y «Listo» (se guarda sola: Listo sólo cierra) ── */}
      <div className="shrink-0 border-t bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3.5 sm:px-7">
        <div className="flex items-center gap-4">
          <button
            type="button"
            disabled={progreso.completa}
            onClick={() => {
              const falta = progreso.faltan[0]
              if (falta) irA(falta.clave)
            }}
            className="min-w-0 flex-1 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
          >
            {progreso.completa ? (
              <span className="flex items-center gap-2 text-lg font-bold text-fuchsia-700">
                <Sparkles className="size-5" aria-hidden />
                Ficha completa
              </span>
            ) : (
              <>
                <span className="block font-mono text-lg font-semibold leading-tight tabular-nums">
                  {progreso.hechas}
                  <span className="text-muted-foreground">/{progreso.total}</span>
                </span>
                <span className="block truncate text-sm text-muted-foreground">
                  {progreso.hechas === 0
                    ? 'Un toque por respuesta. Se guarda sola.'
                    : progreso.faltan.length > 4
                      ? `Faltan ${progreso.faltan.length}: tocá acá para ir a la próxima`
                      : `Falta: ${progreso.faltan.map((f) => f.corto.toLowerCase()).join(', ')}`}
                </span>
              </>
            )}
          </button>
          <Button
            size="lg"
            onClick={onListo}
            className={cn(
              'h-14 shrink-0 rounded-2xl px-9 text-lg font-bold touch-manipulation motion-safe:active:scale-[0.98]',
              progreso.completa && 'bg-fuchsia-600 text-white shadow-lg shadow-fuchsia-600/25 hover:bg-fuchsia-700',
            )}
          >
            Listo
          </Button>
        </div>
      </div>

      <VisorFotos fotos={fotosAntes} indice={fotoVista} onIndice={setFotoVista} />
    </div>
  )
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function Capitulo({ capitulo }: { capitulo: CapituloFicha }) {
  return (
    <div className="flex items-center gap-3 px-5 pb-0 pt-7 sm:px-7" aria-hidden>
      <span className="text-[0.75rem] font-bold uppercase tracking-[0.14em] text-fuchsia-700">{CAPITULOS[capitulo]}</span>
      <span className="h-px flex-1 bg-fuchsia-500/25" />
    </div>
  )
}

function EncabezadoPregunta({
  numero,
  hecha,
  titulo,
  id,
  ayuda,
  antes,
}: {
  numero: number
  hecha: boolean
  titulo: string
  id: string
  ayuda?: string
  antes?: string | null
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold tabular-nums motion-safe:transition-colors motion-safe:duration-200',
          hecha ? 'bg-fuchsia-600 text-white' : 'bg-muted text-muted-foreground',
        )}
      >
        {hecha ? <Check className="size-4" strokeWidth={3} /> : numero}
      </span>
      <div className="min-w-0 flex-1">
        <h3 id={id} className="text-[1.25rem] font-semibold leading-snug tracking-[-0.01em]">
          {titulo}
        </h3>
        {ayuda && <p className="mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground">{ayuda}</p>}
        {antes && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <History className="size-3.5 shrink-0" aria-hidden />
            <span>
              Antes: <span className="font-medium text-foreground/75 line-through decoration-foreground/30">{antes}</span>
            </span>
          </p>
        )}
      </div>
    </div>
  )
}

function Pregunta({
  clave,
  numero,
  titulo,
  ayuda,
  datos,
  previa,
  registrar,
  children,
}: {
  clave: ClavePregunta
  numero: number
  titulo: string
  ayuda?: string
  datos: DatosFicha
  previa: PreviaFicha | null
  registrar: (el: HTMLElement | null) => void
  children: React.ReactNode
}) {
  const antes = previa && cambioPregunta(clave, previa.datos, datos) ? textoDeValor(clave, previa.datos) : null
  return (
    <section
      ref={registrar}
      data-pregunta={clave}
      aria-labelledby={`ficha-${clave}`}
      className="border-b border-dashed border-border px-5 py-6 sm:px-7"
    >
      <EncabezadoPregunta
        numero={numero}
        hecha={respondida(datos, clave) && aplicaPregunta(datos, clave)}
        titulo={titulo}
        id={`ficha-${clave}`}
        ayuda={ayuda}
        antes={antes}
      />
      {children}
    </section>
  )
}

/** Opciones de varias respuestas + «Nada / Ninguno» (que es una respuesta: `[]`). */
function GrillaVarias<K extends string>({
  opciones,
  valor,
  textoNinguna,
  columnas = 'auto',
  deshabilitada,
  onAlternar,
  onNinguna,
}: {
  opciones: ReadonlyArray<{ clave: K; texto: string }>
  valor: readonly K[] | undefined
  textoNinguna: string
  columnas?: 'auto' | '2'
  deshabilitada?: boolean
  onAlternar: (clave: K) => void
  onNinguna: () => void
}) {
  const ningunaElegida = Array.isArray(valor) && valor.length === 0
  return (
    <div
      role="group"
      className={cn('grid gap-2.5', columnas === '2' ? 'grid-cols-1 min-[400px]:grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}
    >
      {opciones.map((o) => (
        <OpcionFicha
          key={o.clave}
          elegida={!!valor?.includes(o.clave)}
          deshabilitada={deshabilitada}
          marca
          onElegir={() => onAlternar(o.clave)}
        >
          {o.texto}
        </OpcionFicha>
      ))}
      <OpcionFicha elegida={ningunaElegida} ninguna deshabilitada={deshabilitada} onElegir={onNinguna}>
        {textoNinguna}
      </OpcionFicha>
    </div>
  )
}

/** Algo que aparece debajo de una respuesta (la caja de «Sí», el «Otro»), sin saltos. */
function Desplegable({ abierto, children }: { abierto: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]',
        abierto ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
      // Cerrado no se puede enfocar lo que tiene adentro.
      inert={!abierto}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/** Arriba de las preguntas: quién pidió qué y lo que ya se sabe de él. */
function Contexto({
  modo,
  pila,
  previa,
  notas,
  fotosAntes,
  onVerFoto,
  errorCarga,
  onReintentar,
  sinCliente,
}: {
  modo: ModoFicha
  pila: string
  previa: PreviaFicha | null
  notas: string | null
  fotosAntes: FotoDelVisor[]
  onVerFoto: (indice: number) => void
  errorCarga: string | null
  onReintentar: () => void
  sinCliente: boolean
}) {
  return (
    <div className="space-y-3 px-5 pt-5 sm:px-7">
      {sinCliente && (
        <p role="alert" className="flex items-start gap-2.5 rounded-2xl border border-amber-500/40 bg-amber-400/10 px-4 py-3 text-[0.9375rem] font-medium text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Este lugar de la fila no tiene cliente: la ficha no se puede guardar.
        </p>
      )}
      {errorCarga && (
        <div role="alert" className="flex items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-400/10 py-2 pl-4 pr-1.5 text-amber-900">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug">
            {errorCarga} Lo que marques se guarda igual.
          </p>
          <button
            type="button"
            onClick={onReintentar}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold hover:underline"
          >
            <RotateCw className="size-4" aria-hidden />
            Reintentar
          </button>
        </div>
      )}
      {modo === 'inicio' && (
        <div className="ficha-aviso-inicio flex items-start gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-fuchsia-700 via-fuchsia-600 to-pink-600 px-5 py-4 text-white shadow-lg shadow-fuchsia-700/20">
          <span aria-hidden className="asesoria-respira mt-0.5 flex size-12 shrink-0 items-center justify-center rounded-full border border-white/35 bg-white/15">
            <MessageCircleQuestionMark className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-xl font-black leading-tight tracking-tight">{pila} pidió asesoría</p>
            <p className="mt-1 text-[0.9375rem] leading-snug text-white/90">
              {previa
                ? 'Ya tiene ficha: charlen y cambiá sólo lo que cambie.'
                : 'No sabe qué hacerse: charlá antes de arrancar y marcá acá lo que vayan decidiendo.'}
            </p>
          </div>
        </div>
      )}
      {(notas || fotosAntes.length > 0) && (
        <div className="flex items-start gap-3 rounded-2xl border bg-muted/30 p-3.5">
          <div className="min-w-0 flex-1">
            {notas ? (
              <>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Observaciones</p>
                <p className="mt-1 whitespace-pre-wrap text-[0.9375rem] leading-snug">{notas}</p>
              </>
            ) : (
              <p className="text-[0.9375rem] leading-snug text-muted-foreground">Así quedó la vez pasada.</p>
            )}
          </div>
          {fotosAntes.length > 0 && (
            <div className="flex shrink-0 gap-2">
              {fotosAntes.slice(0, 2).map((f, i) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onVerFoto(i)}
                  aria-label="Ver la foto del corte anterior"
                  className="relative size-16 overflow-hidden rounded-xl border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Image src={f.src} alt="" fill sizes="64px" className="object-cover" draggable={false} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
