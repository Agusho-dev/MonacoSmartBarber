'use client'

// =============================================================================
// El chat de Tex: lo comparten la pantalla /dashboard/asistente y el panel
// lateral. Una instancia = una conversación: quien lo usa le pone
// `key={conversacionId}` y para cambiar de conversación cambia la key.
//
// Protocolo (src/lib/tex/contrato.ts): useChat sobre el `Chat` de
// transporte.ts contra /api/tex/chat, mandando SÓLO el último mensaje + el id
// de la conversación (el historial lo tiene el servidor). El `Chat` se crea UNA
// vez (gotcha 12: congela transport y callbacks), así que lo que cambia entre
// renders viaja de otra forma: la página actual, en cada envío (`body`); los
// avisos al padre (título, fin del turno), por un avisador que escucha un
// efecto con los callbacks del render actual.
// =============================================================================

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { useChat } from '@ai-sdk/react'
import { ArrowDown, Square } from 'lucide-react'
import { TEX_MAX_CARACTERES, type TexFase, type TexUIMessage } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { TexCaraEstado } from '@/components/tex/tex-cara'
import type { ContenidoLienzo } from '@/components/tex/bloques'
import { crearRelojPasos, RelojPasosContext, useTecladoVirtual } from './hooks'
import {
  avisarLento,
  derivarEstadoTex,
  destinoDelScroll,
  lineaDeEstado,
  pasoActivo,
  pasosDeMensaje,
  textoDeMensaje,
  type EstadoTex,
} from './logica'
import { crearChatTex } from './transporte'
import {
  descartarPreguntaFallida,
  ejecutarReintento,
  mensajesARestaurar,
  planDeReintento,
  type PedidoTex,
} from './reintento'
import { TexComposer, type TexComposerHandle } from './tex-composer'
import { TexErrorTurno, TexSinClave } from './tex-error'
import {
  TexAvisoHistorialRecortado,
  TexAvisoTurno,
  TexMensajePendiente,
  TexMensajeTex,
  TexMensajeUsuario,
} from './tex-mensaje'

export interface TexChatHandle {
  enfocar: () => void
  /** Deja el texto en el composer (con el primer hueco seleccionado) sin mandarlo. */
  escribir: (texto: string) => void
  /** Manda el texto. false si no se pudo (Tex respondiendo, sin clave, vacío). */
  enviar: (texto: string) => boolean
  ocupado: () => boolean
  vacia: () => boolean
}

export interface TexChatInfo {
  estado: EstadoTex
  /** "Leyendo las finanzas de Paraná…" · vacío en reposo. */
  linea: string
  ocupado: boolean
  vacia: boolean
}

export interface TexChatAcciones {
  enviar: (texto: string) => void
  escribir: (texto: string) => void
}

export interface TexChatProps {
  ref?: Ref<TexChatHandle>
  conversacionId: string
  mensajesIniciales: TexUIMessage[]
  /** 'panel' = variante compacta (420 px / hoja del celular). */
  variante: 'pagina' | 'panel'
  orgNombre: string
  puedeConfigurar: boolean
  /** Ve la conciliación con Mercado Pago (la receta "¿Cuadró la plata?"). */
  puedeConciliacion: boolean
  /** Sin clave de Anthropic el composer queda deshabilitado y el vacío lo explica. */
  hayClave?: boolean
  /** Ruta desde la que se pregunta: viaja como contexto (nunca como instrucción). */
  pagina?: string | null
  /** Lo que se ve con la conversación vacía. */
  vacio?: (acciones: TexChatAcciones) => ReactNode
  /** Encabezado que necesita el estado de Tex (la línea con aria-live). */
  encabezado?: (info: TexChatInfo) => ReactNode
  /** La conversación ya existe en el servidor (empezó la primera respuesta). */
  onPrimerMensaje?: (conversacionId: string, texto: string) => void
  onTitulo?: (conversacionId: string, titulo: string) => void
  onTurnoTerminado?: (conversacionId: string) => void
  onAbrirLienzo?: (contenido: ContenidoLienzo) => void
  onNueva?: () => void
}

/** Sin texto a los 8 s: "Está tardando más de lo normal." */
const LENTO_MS = 8000

/** A menos de esto del final el hilo está "al final": lo sigue y no muestra "Nuevo ↓". */
const CERCA_DEL_FINAL_PX = 80

function caraDe(estado: EstadoTex): TexCaraEstado {
  if (estado === 'hablando') return 'hablando'
  if (estado === 'reposo') return 'reposo'
  return 'pensando'
}

type EventoChat =
  | { tipo: 'titulo'; titulo: string }
  | { tipo: 'fin' }
  /** El pedido terminó con error: si fue un "Volver a generar" sin nada nuevo, vuelve la respuesta anterior. */
  | { tipo: 'fallo'; mensajes: TexUIMessage[] }

/**
 * Los callbacks del `Chat` quedan congelados al crearlo (gotcha 12) y los del
 * padre cambian entre renders. El Chat emite acá y un efecto escucha con los
 * callbacks de ESTE render: sin refs leídos en el render y sin setState de más.
 */
function crearAvisador() {
  const oyentes = new Set<(e: EventoChat) => void>()
  return {
    emitir: (e: EventoChat) => oyentes.forEach((oyente) => oyente(e)),
    escuchar: (oyente: (e: EventoChat) => void) => {
      oyentes.add(oyente)
      return () => {
        oyentes.delete(oyente)
      }
    },
  }
}

/**
 * La respuesta del hilo que se puede anclar (logica.ts: destinoDelScroll), con
 * dónde empieza en px desde el comienzo del contenido. Tiene que ser lo ÚLTIMO
 * del hilo (con un error o un aviso debajo, se sigue al final para que se
 * vean), llegada en esta sesión (una conversación reabierta arranca abajo,
 * como siempre), con la respuesta ya a la vista (mientras Tex trabaja, el hilo
 * sigue los pasos) y no anclada antes (después de "Nuevo ↓" sigue al final).
 */
function respuestaParaAnclar(sc: HTMLElement, yaAnclada: string | null): { id: string; inicio: number } | null {
  const ultimo = sc.querySelector<HTMLElement>('[data-tex-hilo]')?.lastElementChild
  if (!(ultimo instanceof HTMLElement) || ultimo.dataset.texMensaje !== 'nueva') return null
  const id = ultimo.dataset.texId
  const respuesta = ultimo.querySelector<HTMLElement>('[data-tex-respuesta]')
  if (!id || id === yaAnclada || !respuesta) return null
  return { id, inicio: respuesta.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop }
}

/** El vacío se dibuja como componente: así sus acciones no se "llaman" durante el render del chat. */
function Vacio({ render, acciones }: { render: (acciones: TexChatAcciones) => ReactNode; acciones: TexChatAcciones }) {
  return <>{render(acciones)}</>
}

export function TexChat({
  ref,
  conversacionId,
  mensajesIniciales,
  variante,
  orgNombre,
  puedeConfigurar,
  puedeConciliacion,
  hayClave = true,
  pagina,
  vacio,
  encabezado,
  onPrimerMensaje,
  onTitulo,
  onTurnoTerminado,
  onAbrirLienzo,
  onNueva,
}: TexChatProps) {
  const compacto = variante === 'panel'
  const [fase, setFase] = useState<TexFase | null>(null)
  // Respuestas cortadas con Detener (el aviso del servidor no llega: el fetch se abortó).
  const [interrumpidos, setInterrumpidos] = useState<ReadonlySet<string>>(() => new Set())
  // Detener antes del primer chunk: no hay mensaje del assistant donde anotarlo.
  const [sinRespuesta, setSinRespuesta] = useState<string | null>(null)
  // Cada pedido al servidor lleva su número: "Está tardando" mira el pedido en
  // curso y no la pregunta (un "Volver a generar" reusa la misma pregunta, y el
  // aviso del pedido anterior aparecía al instante).
  const [pedidoN, setPedidoN] = useState(0)
  const [lentoEn, setLentoEn] = useState(-1)
  const [hayNuevo, setHayNuevo] = useState(false)
  // Los mensajes que ya estaban al abrir no entran animados.
  const [idsIniciales] = useState(() => new Set(mensajesIniciales.map((m) => m.id)))
  const [reloj] = useState(crearRelojPasos)
  const [avisador] = useState(crearAvisador)
  // El último pedido (enviar o volver a generar): define cómo se reintenta (ver reintento.ts).
  const pedidoRef = useRef<PedidoTex | null>(null)

  const [chat] = useState(() =>
    crearChatTex({
      conversacionId,
      mensajesIniciales,
      onData: (parte) => {
        // data-estado es transient: sólo llega acá, nunca a message.parts.
        if (parte.type === 'data-estado') setFase(parte.data.fase)
        else if (parte.type === 'data-titulo') avisador.emitir({ tipo: 'titulo', titulo: parte.data.titulo })
      },
      onFinish: ({ message, messages, isAbort, isError }) => {
        setFase(null)
        if (isAbort) {
          if (messages.some((m) => m.id === message.id)) {
            setInterrumpidos((prev) => new Set(prev).add(message.id))
          } else {
            const ultimo = messages[messages.length - 1]
            if (ultimo?.role === 'user') setSinRespuesta(ultimo.id)
          }
        }
        if (isError) avisador.emitir({ tipo: 'fallo', mensajes: messages })
        avisador.emitir({ tipo: 'fin' })
      },
      onError: () => setFase(null),
    }),
  )
  const { messages, status, error, sendMessage, regenerate, stop, setMessages } = useChat({
    chat,
    experimental_throttle: 50,
  })

  useEffect(
    () =>
      avisador.escuchar((e) => {
        if (e.tipo === 'titulo') onTitulo?.(conversacionId, e.titulo)
        else if (e.tipo === 'fallo') {
          const restaurar = mensajesARestaurar(pedidoRef.current, e.mensajes)
          if (restaurar) setMessages(restaurar)
        } else onTurnoTerminado?.(conversacionId)
      }),
    [avisador, conversacionId, onTitulo, onTurnoTerminado, setMessages],
  )

  const ocupado = status === 'submitted' || status === 'streaming'
  const ultimo = messages.length > 0 ? messages[messages.length - 1] : undefined
  const estado = derivarEstadoTex({ status, ultimo, fase })
  const activo = estado === 'consultando' && ultimo?.role === 'assistant' ? pasoActivo(ultimo) : null
  const linea = lineaDeEstado(estado, activo)
  const vacia = messages.length === 0
  const textoEnCurso = ocupado && ultimo?.role === 'assistant' ? textoDeMensaje(ultimo) : ''

  // Tiempos de cada paso, medidos acá (no los manda el servidor).
  useEffect(() => {
    if (ultimo?.role !== 'assistant') return
    reloj.observar(pasosDeMensaje(ultimo).map((p) => ({ id: p.id, terminado: p.estado !== 'corriendo' })))
  }, [ultimo, reloj])

  // "Está tardando más de lo normal": 8 s del pedido en curso sin una letra.
  const hayTextoEnCurso = textoEnCurso !== ''
  useEffect(() => {
    if (!ocupado || hayTextoEnCurso) return
    const n = pedidoN
    const t = window.setTimeout(() => setLentoEn(n), LENTO_MS)
    return () => window.clearTimeout(t)
  }, [ocupado, hayTextoEnCurso, pedidoN])
  const lento = avisarLento({ ocupado, hayTexto: hayTextoEnCurso, pedidoEnCurso: pedidoN, pedidoLento: lentoEn })

  // ── Scroll: baja solo si estás a menos de 80 px del final, y nunca saca de
  // la pantalla el comienzo de la respuesta que está llegando ──────────────
  const scrollRef = useRef<HTMLDivElement>(null)
  const contenidoRef = useRef<HTMLDivElement>(null)
  // Una conversación reabierta arranca abajo; el estado vacío, arriba (en el
  // celular el parte del día puede no entrar y el saludo quedaría tapado).
  const pegadoRef = useRef(mensajesIniciales.length > 0)
  const scrollProgramadoHastaRef = useRef(0)
  // La respuesta que ya se ancló con su comienzo a la vista: no se vuelve a anclar.
  const anclaRef = useRef<string | null>(null)

  useEffect(() => {
    const sc = scrollRef.current
    const ct = contenidoRef.current
    if (!sc || !ct) return
    let alto = ct.offsetHeight
    if (pegadoRef.current) sc.scrollTop = sc.scrollHeight
    // Un ResizeObserver ve todo lo que agranda el hilo: el texto que llega, un
    // gráfico que termina de cargar, la tarjeta que se pliega. Observar también
    // el contenedor cubre el teclado del celular, que lo achica.
    const ro = new ResizeObserver(() => {
      const nuevoAlto = ct.offsetHeight
      const crecio = nuevoAlto > alto + 1
      alto = nuevoAlto
      const debajo = () => sc.scrollHeight - sc.scrollTop - sc.clientHeight
      if (!pegadoRef.current) {
        // "Nuevo ↓" sólo si lo nuevo quedó fuera de la vista (no por el margen de abajo).
        if (crecio && debajo() >= CERCA_DEL_FINAL_PX) setHayNuevo(true)
        return
      }
      // Pegado: sigue al final, salvo que eso saque de la pantalla el comienzo
      // de la respuesta que está llegando (logica.ts: destinoDelScroll). Se mira
      // sólo cuando crece el contenido: el teclado que achica la pantalla no ancla.
      const respuesta = crecio ? respuestaParaAnclar(sc, anclaRef.current) : null
      const destino = destinoDelScroll({ fondo: sc.scrollHeight - sc.clientHeight, inicioRespuesta: respuesta?.inicio ?? null })
      if (destino.anclada && respuesta) {
        anclaRef.current = respuesta.id
        pegadoRef.current = false
        // El scroll que dispara esta línea no vuelve a "pegar" el hilo: con menos de
        // 80 px abajo, alScrollear lo daba por "cerca del final" y el texto que seguía
        // llegando empujaba otra vez el comienzo de la respuesta fuera de la pantalla.
        scrollProgramadoHastaRef.current = performance.now() + 150
      }
      sc.scrollTop = destino.top
      if (destino.anclada && debajo() >= CERCA_DEL_FINAL_PX) setHayNuevo(true)
    })
    ro.observe(ct)
    ro.observe(sc)
    return () => ro.disconnect()
  }, [])

  /**
   * La persona movió el hilo a mano (o pidió "Nuevo ↓"): la respuesta que está
   * llegando ya no se ancla sola. Si no, al volver al final el hilo la subía de
   * golpe hasta el comienzo de la respuesta.
   */
  function noAnclarLaUltima() {
    const u = messages[messages.length - 1]
    if (u?.role === 'assistant') anclaRef.current = u.id
  }

  function alScrollear() {
    const sc = scrollRef.current
    if (!sc || performance.now() < scrollProgramadoHastaRef.current) return
    const cerca = sc.scrollHeight - sc.scrollTop - sc.clientHeight < CERCA_DEL_FINAL_PX
    if (!cerca && pegadoRef.current) noAnclarLaUltima()
    pegadoRef.current = cerca
    if (cerca && hayNuevo) setHayNuevo(false)
  }

  function irAlFinal() {
    const sc = scrollRef.current
    if (!sc) return
    noAnclarLaUltima()
    pegadoRef.current = true
    setHayNuevo(false)
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scrollProgramadoHastaRef.current = performance.now() + (suave ? 600 : 0)
    sc.scrollTo({ top: sc.scrollHeight, behavior: suave ? 'smooth' : 'auto' })
  }

  // ── Acciones ──────────────────────────────────────────────────────────────
  const composerRef = useRef<TexComposerHandle>(null)
  const cuerpo = { pagina: pagina ?? undefined }

  // La conversación nueva se le anuncia al padre (historial, ?c= en la URL)
  // recién cuando el servidor empieza a responder: los errores previos al
  // stream (429, sin clave) cortan antes de crearla y dejarían una fantasma.
  const primerTextoRef = useRef<string | null>(null)
  useEffect(() => {
    if (status !== 'streaming' || primerTextoRef.current === null) return
    const texto = primerTextoRef.current
    primerTextoRef.current = null
    onPrimerMensaje?.(conversacionId, texto)
  }, [status, conversacionId, onPrimerMensaje])

  /** Cada pedido nuevo: el aviso de lento arranca de cero, se va el "Detuviste" y el hilo baja. */
  function prepararPedido() {
    setPedidoN((n) => n + 1)
    setSinRespuesta(null)
    pegadoRef.current = true
    setHayNuevo(false)
  }

  function nuevoPedido(pedido: PedidoTex) {
    pedidoRef.current = pedido
    prepararPedido()
  }

  function enviar(texto: string): boolean {
    const t = texto.trim()
    if (!t || t.length > TEX_MAX_CARACTERES || !hayClave || ocupado) return false
    let base = messages
    // Un envío que falló ANTES del stream se cortó antes de que el servidor
    // guardara la pregunta: no existe del otro lado y no queda acá. Después de
    // un "Volver a generar" fallido, en cambio, la pregunta sigue guardada.
    if (descartarPreguntaFallida(pedidoRef.current, status, messages)) {
      base = messages.slice(0, -1)
      setMessages(base)
    }
    if (base.length === 0) primerTextoRef.current = t
    nuevoPedido({ tipo: 'enviar' })
    void sendMessage({ text: t }, { body: cuerpo })
    return true
  }

  function regenerar() {
    if (ocupado || !hayClave) return
    // Si falla antes de que llegue algo, vuelve esta respuesta (el servidor la conserva).
    nuevoPedido({ tipo: 'regenerar', antes: messages })
    void regenerate({ body: cuerpo })
  }

  /** "Reintentar": la misma pregunta con su id (el servidor deduplica), nunca una nueva. */
  function reintentar() {
    if (ocupado || !hayClave) return
    const anterior = pedidoRef.current
    const plan = planDeReintento(anterior, messages)
    if (!plan) return
    prepararPedido()
    pedidoRef.current = ejecutarReintento({ messages, setMessages, sendMessage, regenerate }, plan, cuerpo, anterior)
  }

  /** Detener antes de la primera letra deja la pregunta sola: se vuelve a mandar con su id. */
  function volverAPreguntar() {
    if (ocupado || !hayClave || ultimo?.role !== 'user') return
    // El pedido detenido estaba en vuelo: el servidor pudo haber guardado la pregunta.
    nuevoPedido({ tipo: 'enviar', quizasGuardada: true })
    void sendMessage(undefined, { body: cuerpo })
  }

  function detener() {
    void stop()
  }

  useImperativeHandle(ref, () => ({
    enfocar: () => composerRef.current?.enfocar(),
    escribir: (texto: string) => composerRef.current?.escribir(texto),
    enviar,
    ocupado: () => ocupado,
    vacia: () => vacia,
  }))

  const avisoLento = lento ? (
    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
      <span>Está tardando más de lo normal.</span>
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={detener}>
        <Square className="size-3 fill-current" aria-hidden />
        Detener
      </Button>
    </div>
  ) : null

  const enviarRapido = (texto: string) => {
    enviar(texto)
  }
  const escribirEnComposer = (texto: string) => composerRef.current?.escribir(texto)

  let contenido: ReactNode
  if (vacia) {
    contenido = hayClave ? (
      vacio ? <Vacio render={vacio} acciones={{ enviar: enviarRapido, escribir: escribirEnComposer }} /> : null
    ) : (
      <div className="my-auto">
        <TexSinClave puedeConfigurar={puedeConfigurar} compacto={compacto} />
      </div>
    )
  } else {
    contenido = (
      <ol aria-label="Conversación con Tex" data-tex-hilo="" className={cn('flex flex-col', compacto ? 'gap-6' : 'gap-7')}>
        {messages.map((m, i) => {
          const esUltimo = i === messages.length - 1
          if (m.role === 'user') {
            return (
              <li key={m.id} data-tex-mensaje="usuario">
                <TexMensajeUsuario mensaje={m} animar={!idsIniciales.has(m.id)} />
              </li>
            )
          }
          if (m.role !== 'assistant') return null
          const enCurso = esUltimo && ocupado
          return (
            <li key={m.id} data-tex-mensaje={idsIniciales.has(m.id) ? 'guardada' : 'nueva'} data-tex-id={m.id}>
              <TexMensajeTex
                mensaje={m}
                compacto={compacto}
                enCurso={enCurso}
                puedeRegenerar={esUltimo && !ocupado && hayClave}
                interrumpido={interrumpidos.has(m.id)}
                orgNombre={orgNombre}
                aviso={enCurso ? avisoLento : null}
                onRegenerar={esUltimo ? regenerar : undefined}
                onAbrirLienzo={onAbrirLienzo}
                onEnviar={esUltimo ? enviarRapido : undefined}
              />
            </li>
          )
        })}
        {ocupado && ultimo?.role === 'user' && (
          <li>
            <TexMensajePendiente aviso={avisoLento} />
          </li>
        )}
        {!ocupado && ultimo?.role === 'user' && sinRespuesta === ultimo.id && (
          <li>
            <TexAvisoTurno codigo="interrumpido" texto="" onVolverAPreguntar={hayClave ? volverAPreguntar : undefined} />
          </li>
        )}
        {status === 'error' && error && (
          <li>
            <TexErrorTurno error={error} puedeConfigurar={puedeConfigurar} onReintentar={reintentar} onNueva={onNueva} />
          </li>
        )}
        {status === 'ready' && ultimo?.role === 'assistant' && ultimo.metadata?.historialRecortado === true && (
          <li>
            <TexAvisoHistorialRecortado onNueva={onNueva} />
          </li>
        )}
      </ol>
    )
  }

  const teclado = useTecladoVirtual()

  return (
    <RelojPasosContext value={reloj}>
      <div className="flex min-h-0 flex-1 flex-col" style={teclado ? { paddingBottom: teclado } : undefined}>
        {encabezado?.({ estado, linea, ocupado, vacia })}

        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={alScrollear}
            className="h-full overflow-y-auto overflow-x-hidden overscroll-contain"
          >
            <div
              ref={contenidoRef}
              className={cn(
                'mx-auto flex min-h-full w-full flex-col pb-7',
                compacto ? 'px-3 pt-4' : 'max-w-[720px] px-4 pt-5 lg:px-6 lg:pt-8',
              )}
            >
              {contenido}
            </div>
          </div>

          {hayNuevo && !vacia && (
            <button
              type="button"
              onClick={irAlFinal}
              className="absolute bottom-3 left-1/2 z-10 flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card/95 px-3.5 text-[13px] font-medium text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1"
            >
              Nuevo
              <ArrowDown className="size-3.5" aria-hidden />
            </button>
          )}
        </div>

        <TexComposer
          ref={composerRef}
          compacto={compacto}
          ocupado={ocupado}
          deshabilitado={!hayClave}
          placeholder={
            hayClave ? (compacto ? 'Preguntale a Tex…' : 'Preguntá algo o pedí un informe…') : 'Tex todavía no tiene clave de Anthropic.'
          }
          orgNombre={orgNombre}
          puedeConciliacion={puedeConciliacion}
          cara={{ visible: !vacia && hayClave, estado: caraDe(estado), texto: textoEnCurso }}
          onEnviar={enviar}
          onDetener={detener}
        />
      </div>
    </RelojPasosContext>
  )
}
