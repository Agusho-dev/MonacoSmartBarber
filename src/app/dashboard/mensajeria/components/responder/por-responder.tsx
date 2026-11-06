'use client'

// «Por responder» (6/nov/2026): la bandeja de tarjetas de Mensajería. Pedido
// del dueño: «que aparezcan cards tipo tinder y que te aparezca para
// responder… las reseñas malas y las preguntas que queden sin responder…
// respondés y deslizás, también podés mandársela a la IA».
//
// - Una tarjeta por conversación que espera (contexto-por-responder.tsx),
//   las reseñas bajas primero y después las consultas por la ventana de 24 h
//   que se cierra antes. Los «gracias» y «listo» van al final.
// - Cada tarjeta trae el borrador de Tex ya escrito (se pide apenas llega a
//   las dos de arriba). Derecha = mandar ESE texto; izquierda = «Listo»; abajo
//   («Después») = al fondo del mazo. Tocar el borrador lo abre para corregirlo.
// - Nada sale en el acto: 5 s de «Deshacer» (como Gmail), y si la persona se
//   va de la pantalla o la app pasa a segundo plano, sale enseguida.
// - En la compu: los mismos botones con atajos (→ ← ↓ E) y, si hay lugar, la
//   lista de lo que sigue al costado.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowLeft, ArrowRight, Bell, BellRing, Check, Clock3, Layers, MessageCircleQuestion, PenLine,
  RefreshCw, SendHorizontal, Star, Undo2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { TexPose } from '@/components/tex/tex-pose'
import { cn } from '@/lib/utils'
import { marcarPendienteListo, marcarPendientesListos, responderPendiente } from '@/lib/actions/por-responder'
import { haceCuanto, resumenDePila, textoNota, type Pendiente } from '@/lib/mensajeria/por-responder'
import type { AjusteBorrador } from '@/lib/mensajeria/borrador-prompt'
import { AccionDeBarraIos, BotonSecundario, EncabezadoSeccion } from '../navegacion/barra-ios'
import { SegmentadoIos, avisarFalla } from '../navegacion/lista-ios'
import { Avatar } from '../shared/avatar'
import { usePorResponder } from './contexto-por-responder'
import { Mazo, type Direccion, type MazoRef } from './mazo'
import { TarjetaCargando, TarjetaPendiente, accionDerecha } from './tarjeta'
import { HojaResponder } from './hoja-responder'
import { HojaAvisos } from './hoja-avisos'
import { useBorradores } from './use-borradores'
import { useAvisosPush } from './use-avisos-push'

const DESHACER_MS = 5000
const CARTEL_AVISOS = 'mensajeria.por-responder.cartel-avisos.v1'

type Pila = 'responder' | 'vencidas'

interface AccionEnEspera {
  tipo: 'enviar' | 'listo'
  p: Pendiente
  texto?: string
  /** Para la cuenta regresiva del anillo. */
  desde: number
}

/** Lleva los postergados al final y la tarjeta fijada arriba, sin cambiar el resto del orden. */
function ordenar(lista: Pendiente[], postergadas: string[], fijada: string | null): Pendiente[] {
  const atras = new Set(postergadas)
  const adelante = lista.filter((p) => !atras.has(p.id))
  const porId = new Map(lista.map((p) => [p.id, p]))
  const fondo = postergadas.map((id) => porId.get(id)).filter((p): p is Pendiente => !!p)
  const todo = [...adelante, ...fondo]
  if (fijada) {
    const i = todo.findIndex((p) => p.id === fijada)
    if (i > 0) todo.unshift(...todo.splice(i, 1))
  }
  return todo
}

function leerCartel(): boolean {
  try {
    return window.localStorage.getItem(CARTEL_AVISOS) !== 'oculto'
  } catch {
    return true
  }
}

export function PorResponder({
  convInicial,
  onVerChat,
}: {
  /** El aviso que se tocó: esa tarjeta arriba. */
  convInicial: string | null
  onVerChat: (p: Pendiente) => void
}) {
  const { estado, error, pilas, ahora, refrescar, ocultar, mostrar } = usePorResponder()
  const { borradores, disponible, pedir, asegurar, escribir } = useBorradores()
  const avisos = useAvisosPush()

  const [pila, setPila] = useState<Pila>('responder')
  const [postergadas, setPostergadas] = useState<string[]>([])
  const [fijada, setFijada] = useState<string | null>(convInicial)
  const [editando, setEditando] = useState<string | null>(null)
  const [verAvisos, setVerAvisos] = useState(false)
  const [enEspera, setEnEspera] = useState<AccionEnEspera | null>(null)
  const [hechas, setHechas] = useState({ respondidas: 0, listas: 0 })
  const [cartel, setCartel] = useState(false)
  const [anuncio, setAnuncio] = useState('')
  const mazo = useRef<MazoRef>(null)
  const barraAcciones = useRef<HTMLDivElement>(null)
  const textoDeLaHoja = useRef<{ id: string; texto: string } | null>(null)
  const enEsperaRef = useRef<AccionEnEspera | null>(null)
  const reloj = useRef<number | null>(null)

  useEffect(() => {
    // Después de montar: localStorage no existe en el servidor.
    const t = window.setTimeout(() => setCartel(leerCartel()), 0)
    return () => window.clearTimeout(t)
  }, [])

  // El aviso que se tocó con la bandeja ya abierta (el service worker le avisa a la página).
  const [convAntes, setConvAntes] = useState(convInicial)
  if (convInicial !== convAntes) {
    setConvAntes(convInicial)
    if (convInicial) setFijada(convInicial)
  }
  // Una vencida pedida desde un aviso: se abre su pila (una vez por aviso, con los datos ya leídos).
  const [pilaElegidaPara, setPilaElegidaPara] = useState<string | null>(null)
  if (convInicial && estado === 'listo' && pilaElegidaPara !== convInicial) {
    setPilaElegidaPara(convInicial)
    if (pilas.vencidas.some((p) => p.id === convInicial)) setPila('vencidas')
  }

  const deResponder = useMemo(() => [...pilas.paraResponder, ...pilas.cierres], [pilas])
  const base = pila === 'responder' ? deResponder : pilas.vencidas
  const ordenadas = useMemo(() => ordenar(base, postergadas, fijada), [base, postergadas, fijada])
  const arriba = ordenadas[0] ?? null
  const ids = useMemo(() => ordenadas.slice(0, 3).map((p) => p.id), [ordenadas])
  const porId = useMemo(() => new Map([...deResponder, ...pilas.vencidas].map((p) => [p.id, p])), [deResponder, pilas.vencidas])

  // La de arriba queda fijada: si entra algo nuevo, no se cambia la tarjeta bajo
  // el dedo. Se ajusta en el render (no en un efecto): converge en una vuelta.
  if (arriba && arriba.id !== fijada) setFijada(arriba.id)

  // Los borradores de las dos de arriba (no los cierres ni las vencidas).
  useEffect(() => {
    if (pila !== 'responder') return
    for (const p of ordenadas.slice(0, 2)) {
      if (!p.esCierre) asegurar(p.id)
    }
  }, [ordenadas, pila, asegurar])

  // ── Las acciones ────────────────────────────────────────────────────────

  const ejecutar = useCallback(async (a: AccionEnEspera) => {
    if (enEsperaRef.current === a) {
      enEsperaRef.current = null
      setEnEspera(null)
    }
    if (reloj.current) {
      window.clearTimeout(reloj.current)
      reloj.current = null
    }
    try {
      const r = a.tipo === 'enviar'
        ? await responderPendiente(a.p.id, a.texto ?? '')
        : await marcarPendienteListo(a.p.id)
      if (!r.ok) {
        toast.error(a.tipo === 'enviar' ? `No salió el mensaje a ${a.p.nombrePila ?? a.p.nombre}: ${r.error}` : r.error)
        mostrar(a.p.id)
        setFijada(a.p.id)
        return
      }
      setHechas((h) => (a.tipo === 'enviar' ? { ...h, respondidas: h.respondidas + 1 } : { ...h, listas: h.listas + 1 }))
      refrescar()
    } catch (e) {
      avisarFalla(e, a.tipo === 'enviar' ? 'No salió el mensaje. Revisá la conexión y probá de nuevo.' : 'No se pudo marcar. Probá de nuevo.')
      mostrar(a.p.id)
      setFijada(a.p.id)
    }
  }, [mostrar, refrescar])

  const encolar = useCallback((a: Omit<AccionEnEspera, 'desde'>) => {
    // La anterior sale ya: un solo «Deshacer» a la vez.
    const previa = enEsperaRef.current
    if (previa) void ejecutar(previa)
    const accion: AccionEnEspera = { ...a, desde: Date.now() }
    enEsperaRef.current = accion
    setEnEspera(accion)
    ocultar(a.p.id)
    setPostergadas((ps) => ps.filter((id) => id !== a.p.id))
    reloj.current = window.setTimeout(() => { void ejecutar(accion) }, DESHACER_MS)
    const quien = a.p.nombrePila ?? a.p.nombre
    setAnuncio(a.tipo === 'enviar' ? `Mandando la respuesta a ${quien}. Podés deshacerlo.` : `${quien}: marcada como lista.`)
  }, [ejecutar, ocultar])

  const deshacer = useCallback(() => {
    const a = enEsperaRef.current
    if (!a) return
    if (reloj.current) window.clearTimeout(reloj.current)
    reloj.current = null
    enEsperaRef.current = null
    setEnEspera(null)
    mostrar(a.p.id)
    setFijada(a.p.id)
    setAnuncio(`Se deshizo. ${a.p.nombrePila ?? a.p.nombre} vuelve arriba.`)
  }, [mostrar])

  // Si la persona se va (otra sección, la app a segundo plano), lo pendiente sale ya.
  // Por ref: el efecto se arma una sola vez y su limpieza es la salida de la pantalla.
  const ejecutarRef = useRef(ejecutar)
  useEffect(() => {
    ejecutarRef.current = ejecutar
  }, [ejecutar])
  useEffect(() => {
    const salir = () => {
      const a = enEsperaRef.current
      if (a) void ejecutarRef.current(a)
    }
    const alOcultar = () => { if (document.visibilityState === 'hidden') salir() }
    window.addEventListener('pagehide', salir)
    document.addEventListener('visibilitychange', alOcultar)
    return () => {
      window.removeEventListener('pagehide', salir)
      document.removeEventListener('visibilitychange', alOcultar)
      salir()
    }
  }, [])

  const puedeSoltar = useCallback((id: string, dir: Direccion) => {
    const p = porId.get(id)
    if (!p) return false
    if (dir !== 'derecha') return true
    if (textoDeLaHoja.current?.id === id) return true
    switch (accionDerecha(p, borradores[id], Date.now())) {
      case 'enviar':
        return true
      case 'escribir':
        setEditando(id)
        return false
      case 'esperar':
        toast.info('Tex todavía está escribiendo: esperá un segundo.')
        return false
      case 'chat':
        onVerChat(p)
        return false
      case 'instagram':
        if (p.usuarioIg) window.open(`https://ig.me/m/${encodeURIComponent(p.usuarioIg)}`, '_blank', 'noopener')
        else toast.info('Instagram ya no deja contestar desde acá: respondele desde la app de Instagram.')
        return false
    }
  }, [porId, borradores, onVerChat])

  const onSoltada = useCallback((id: string, dir: Direccion) => {
    const p = porId.get(id)
    if (!p) return
    if (dir === 'abajo') {
      setPostergadas((ps) => [...ps.filter((x) => x !== id), id])
      setFijada(null)
      setAnuncio(`${p.nombrePila ?? p.nombre} pasó al final.`)
      return
    }
    if (dir === 'izquierda') {
      encolar({ tipo: 'listo', p })
      return
    }
    const forzado = textoDeLaHoja.current?.id === id ? textoDeLaHoja.current.texto : null
    textoDeLaHoja.current = null
    const texto = (forzado ?? borradores[id]?.texto ?? '').trim()
    if (!texto) {
      mostrar(id)
      setEditando(id)
      return
    }
    encolar({ tipo: 'enviar', p, texto })
  }, [porId, borradores, encolar, mostrar])

  const vibrar = useCallback(() => {
    try { navigator.vibrate?.(8) } catch { /* sin vibración */ }
  }, [])

  const editado = editando ? porId.get(editando) ?? null : null

  const enviarDesdeLaHoja = (texto: string) => {
    if (!editado) return
    const id = editado.id
    escribir(id, texto)
    textoDeLaHoja.current = { id, texto }
    setEditando(null)
    setFijada(id)
    // Que la hoja termine de bajar antes de que la tarjeta se vaya volando.
    window.setTimeout(() => mazo.current?.lanzar('derecha'), 260)
  }

  const ajustar = (id: string, ajuste: AjusteBorrador) => { void pedir(id, { ajuste }) }

  const marcarCierresListos = async () => {
    const lista = pilas.cierres.map((p) => p.id)
    if (lista.length === 0) return
    for (const id of lista) ocultar(id)
    const r = await marcarPendientesListos(lista).catch(() => null)
    if (!r || !r.ok) {
      for (const id of lista) mostrar(id)
      toast.error(r && !r.ok ? r.error : 'No se pudieron marcar. Probá de nuevo.')
      return
    }
    setHechas((h) => ({ ...h, listas: h.listas + r.hechas }))
    toast.success(r.hechas === 1 ? '1 cierre marcado como listo' : `${r.hechas} cierres marcados como listos`)
    refrescar()
  }

  // ── Teclado (compu) ─────────────────────────────────────────────────────
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && enEsperaRef.current) {
          e.preventDefault()
          deshacer()
        }
        return
      }
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]'))) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      if (!arriba) return
      if (e.key === 'ArrowRight') { e.preventDefault(); mazo.current?.lanzar('derecha') }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); mazo.current?.lanzar('izquierda') }
      else if (e.key === 'ArrowDown') { e.preventDefault(); mazo.current?.lanzar('abajo') }
      else if (e.key.toLowerCase() === 'e' && accionDerecha(arriba, undefined, Date.now()) !== 'chat' && accionDerecha(arriba, undefined, Date.now()) !== 'instagram') { e.preventDefault(); setEditando(arriba.id) }
      else if (e.key.toLowerCase() === 'z') { e.preventDefault(); deshacer() }
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [arriba, deshacer])

  // Los avisos (toasts) van arriba de los botones, no encima: la barra publica
  // su alto en la variable que usa el composer del chat (globals.css).
  useLayoutEffect(() => {
    const el = barraAcciones.current
    if (!el) return
    const raiz = document.documentElement
    const publicar = () => raiz.style.setProperty('--alto-composer-chat', `${Math.round(el.getBoundingClientRect().height)}px`)
    publicar()
    const obs = new ResizeObserver(publicar)
    obs.observe(el)
    return () => {
      obs.disconnect()
      raiz.style.removeProperty('--alto-composer-chat')
    }
  }, [])

  // ── Lo que se dibuja ────────────────────────────────────────────────────

  const quedan = ordenadas.length
  const totalSesion = hechas.respondidas + hechas.listas
  const iconoAvisos = avisos.estado === 'activo' ? BellRing : Bell
  const sinAvisos = avisos.estado === 'apagado' || avisos.estado === 'instalar'

  const accionArriba = arriba ? accionDerecha(arriba, borradores[arriba.id], ahora) : null
  const textoDerecha = accionArriba === 'enviar' ? 'Enviar' : accionArriba === 'chat' ? 'Abrir chat' : accionArriba === 'instagram' ? 'Instagram' : accionArriba === 'esperar' ? 'Escribiendo' : 'Escribir'

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <AccionDeBarraIos>
        <button
          type="button"
          onClick={() => setVerAvisos(true)}
          aria-label={avisos.estado === 'activo' ? 'Avisos activados' : 'Activar avisos'}
          className="relative -m-1 flex size-11 items-center justify-center rounded-full text-[var(--wa-accent)] outline-none [-webkit-tap-highlight-color:transparent] active:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
        >
          {(() => { const I = iconoAvisos; return <I aria-hidden className="size-[22px]" strokeWidth={2} /> })()}
          {sinAvisos && <span aria-hidden className="absolute right-2 top-2 size-2 rounded-full bg-[#ff453a]" />}
        </button>
      </AccionDeBarraIos>
      <EncabezadoSeccion
        titulo="Por responder"
        subtitulo={estado === 'listo' ? (quedan > 0 ? `${resumenDePila(deResponder)}${pilas.vencidas.length ? ` · ${pilas.vencidas.length} ${pilas.vencidas.length === 1 ? 'vencida' : 'vencidas'}` : ''}` : 'Nada esperando') : undefined}
      >
        <BotonSecundario onClick={() => setVerAvisos(true)}>
          {(() => { const I = iconoAvisos; return <I aria-hidden className="size-4" /> })()}
          {avisos.estado === 'activo' ? 'Avisos activados' : 'Activar avisos'}
        </BotonSecundario>
        <BotonSecundario onClick={refrescar}>
          <RefreshCw aria-hidden className="size-4" /> Actualizar
        </BotonSecundario>
      </EncabezadoSeccion>

      <p className="sr-only" role="status" aria-live="polite">{anuncio}</p>

      <div className="flex min-h-0 flex-1 lg:@min-[1100px]/columnas:grid lg:@min-[1100px]/columnas:grid-cols-[minmax(0,1fr)_300px]">
        <div className="mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col lg:px-6 lg:pt-4">
          {cartel && sinAvisos && estado === 'listo' && (
            <div className="mx-4 mt-2 flex items-center gap-2.5 rounded-2xl bg-[linear-gradient(135deg,rgba(33,192,99,0.16),rgba(33,192,99,0.05))] py-1.5 pl-3 pr-1.5 ring-1 ring-[var(--wa-accent)]/20 lg:mx-0">
              <Bell aria-hidden className="size-[18px] shrink-0 text-[#4cd884]" />
              <p className="min-w-0 flex-1 truncate text-[14px] leading-[18px] text-white/85 lg:text-[13px]">
                Avisos de reseñas y consultas
              </p>
              <button
                type="button"
                onClick={() => setVerAvisos(true)}
                className="h-8 shrink-0 rounded-full bg-[var(--wa-accent)] px-3 text-[14px] font-semibold text-[var(--wa-on-accent)] outline-none active:scale-95 focus-visible:ring-2 focus-visible:ring-white/60 lg:text-[13px]"
              >
                Activar
              </button>
              <button
                type="button"
                aria-label="No mostrar más"
                onClick={() => {
                  setCartel(false)
                  try { window.localStorage.setItem(CARTEL_AVISOS, 'oculto') } catch { /* sin almacenamiento */ }
                }}
                className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-white/50 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-white/50"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          )}

          {estado === 'listo' && pilas.vencidas.length > 0 && (
            <div className="px-4 pt-3 lg:px-0">
              <SegmentadoIos
                etiqueta="Qué pila mirar"
                valor={pila}
                onCambio={(v) => { setPila(v); setFijada(null) }}
                opciones={[
                  { valor: 'responder', texto: `Para responder · ${deResponder.length}` },
                  { valor: 'vencidas', texto: `Vencidas · ${pilas.vencidas.length}` },
                ]}
              />
            </div>
          )}

          <div className="relative min-h-0 flex-1 px-5 pb-3 pt-4 lg:px-0">
            {estado === 'cargando' ? (
              <div className="pr-mazo relative h-full">
                <div className="pr-carta absolute inset-0" data-posicion="2"><TarjetaCargando /></div>
                <div className="pr-carta absolute inset-0" data-posicion="1"><TarjetaCargando /></div>
                <div className="absolute inset-0"><TarjetaCargando /></div>
              </div>
            ) : estado === 'error' && ordenadas.length === 0 ? (
              <Escena pose="ayuda" titulo="No pude leer lo que hay por responder" texto={error ?? 'Revisá la conexión y probá de nuevo.'}>
                <BotonEscena onClick={refrescar}><RefreshCw aria-hidden className="size-4" /> Reintentar</BotonEscena>
              </Escena>
            ) : arriba ? (
              <Mazo
                ref={mazo}
                ids={ids}
                className="h-full"
                puedeSoltar={puedeSoltar}
                onSoltada={onSoltada}
                onUmbral={vibrar}
                render={(id, posicion) => {
                  const p = porId.get(id)
                  if (!p) return null
                  return (
                    <TarjetaPendiente
                      p={p}
                      ahora={ahora}
                      borrador={borradores[id]}
                      ia={disponible}
                      fondo={posicion > 0}
                      onEditar={() => setEditando(id)}
                      onAjuste={(a) => ajustar(id, a)}
                      onPedirIgual={() => { void pedir(id, { forzar: true }) }}
                      onVerChat={() => onVerChat(p)}
                    />
                  )
                }}
              />
            ) : pila === 'vencidas' ? (
              <Escena pose="logro" titulo="No quedan vencidas" texto="Todo lo de la semana está atendido.">
                <BotonEscena onClick={() => setPila('responder')}>Volver a «Para responder»</BotonEscena>
              </Escena>
            ) : totalSesion > 0 ? (
              <Festejo
                respondidas={hechas.respondidas}
                listas={hechas.listas}
                vencidas={pilas.vencidas.length}
                onVencidas={() => setPila('vencidas')}
                onAvisos={sinAvisos ? () => setVerAvisos(true) : undefined}
              />
            ) : (
              <Escena
                pose="saludo"
                titulo="No hay nada esperando"
                texto="Cuando una reseña llegue baja o una consulta quede sin responder, aparece acá como una tarjeta."
              >
                {pilas.vencidas.length > 0 && (
                  <BotonEscena onClick={() => setPila('vencidas')}>Ver {pilas.vencidas.length} vencidas de la semana</BotonEscena>
                )}
                {sinAvisos && (
                  <BotonEscena principal onClick={() => setVerAvisos(true)}><Bell aria-hidden className="size-4" /> Avisame cuando llegue algo</BotonEscena>
                )}
              </Escena>
            )}
          </div>

          {/* Los botones, como los de las apps de tarjetas: Listo · Después · Escribir · Enviar. */}
          <div
            ref={barraAcciones}
            className={cn(
              'relative flex shrink-0 items-start justify-center gap-5 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-1 lg:gap-6 lg:pb-6',
              !arriba && 'invisible',
            )}
          >
            <BarraDeshacer accion={enEspera} onDeshacer={deshacer} />
            <BotonRedondo etiqueta="Listo" atajo="←" tamano="grande" onClick={() => mazo.current?.lanzar('izquierda')}>
              <Check aria-hidden className="size-7" strokeWidth={2.4} />
            </BotonRedondo>
            <BotonRedondo etiqueta="Después" atajo="↓" tamano="chico" onClick={() => mazo.current?.lanzar('abajo')}>
              <Clock3 aria-hidden className="size-5" strokeWidth={2.2} />
            </BotonRedondo>
            {accionArriba !== 'chat' && accionArriba !== 'instagram' && (
              <BotonRedondo etiqueta="Escribir" atajo="E" tamano="chico" onClick={() => arriba && setEditando(arriba.id)}>
                <PenLine aria-hidden className="size-5" strokeWidth={2.2} />
              </BotonRedondo>
            )}
            <BotonRedondo
              etiqueta={textoDerecha}
              atajo="→"
              tamano="grande"
              tono="acento"
              apagado={accionArriba === 'esperar'}
              onClick={() => mazo.current?.lanzar('derecha')}
            >
              <SendHorizontal aria-hidden className="size-7 translate-x-0.5" strokeWidth={2.3} />
            </BotonRedondo>
          </div>

          {estado === 'listo' && pila === 'responder' && pilas.cierres.length > 1 && arriba && !arriba.esCierre && (
            <p className="-mt-2 hidden pb-4 text-center text-[12.5px] text-[var(--wa-text-2)] lg:block">
              Al final hay {pilas.cierres.length} que parecen cierres de charla.{' '}
              <button type="button" onClick={() => { void marcarCierresListos() }} className="font-medium text-[var(--wa-accent)] hover:underline">Marcarlas como listas</button>
            </p>
          )}
        </div>

        {/* En la compu ancha: lo que sigue, para elegir una. */}
        <ColaLateral
          lista={ordenadas.slice(1, 9)}
          ahora={ahora}
          onElegir={(id) => setFijada(id)}
          cierres={pila === 'responder' ? pilas.cierres.length : 0}
          onCierres={() => { void marcarCierresListos() }}
        />
      </div>

      <HojaResponder
        pendiente={editado}
        borrador={editado ? borradores[editado.id] : undefined}
        ia={disponible}
        ahora={ahora}
        onCerrar={() => setEditando(null)}
        onAjuste={(a) => { if (editado) ajustar(editado.id, a) }}
        onEnviar={enviarDesdeLaHoja}
      />
      <HojaAvisos abierta={verAvisos} onCerrar={() => setVerAvisos(false)} avisos={avisos} />
    </div>
  )
}

function BotonRedondo({
  etiqueta, atajo, tamano, tono = 'neutro', apagado = false, onClick, children,
}: {
  etiqueta: string
  atajo: string
  tamano: 'grande' | 'chico'
  tono?: 'neutro' | 'acento'
  apagado?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        aria-label={etiqueta}
        aria-keyshortcuts={atajo === '←' ? 'ArrowLeft' : atajo === '→' ? 'ArrowRight' : atajo === '↓' ? 'ArrowDown' : atajo}
        className={cn(
          'flex items-center justify-center rounded-full outline-none transition-[transform,background-color,opacity] duration-150 [-webkit-tap-highlight-color:transparent] active:scale-90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--wa-bg)]',
          tamano === 'grande' ? 'size-16 lg:size-14' : 'mt-2.5 size-12 lg:mt-2 lg:size-11',
          tono === 'acento'
            ? 'bg-[var(--wa-accent)] text-[var(--wa-on-accent)] shadow-[0_14px_30px_-10px_rgba(33,192,99,0.75)] hover:bg-[var(--wa-accent-hover)] focus-visible:ring-[var(--wa-accent)]/70'
            : 'bg-[#1f2022] text-white/90 ring-1 ring-white/[0.08] hover:bg-[#2a2b2e] focus-visible:ring-white/50',
          apagado && 'opacity-45',
        )}
      >
        {children}
      </button>
      <span className="flex items-center gap-1 text-[12px] font-medium text-[var(--wa-text-2)]">
        {etiqueta}
        <kbd className="hidden rounded border border-white/15 px-1 font-sans text-[10.5px] leading-4 text-white/45 lg:inline">{atajo}</kbd>
      </span>
    </div>
  )
}

/** «Mandando a Benjamín… Deshacer», con el anillo que se vacía. */
function BarraDeshacer({ accion, onDeshacer }: { accion: AccionEnEspera | null; onDeshacer: () => void }) {
  if (!accion) return null
  const quien = accion.p.nombrePila ?? accion.p.nombre
  return (
    <div
      key={accion.desde}
      className="absolute inset-x-4 bottom-[calc(100%+6px)] z-40 mx-auto flex max-w-[420px] items-center gap-3 rounded-2xl bg-[#2a2b2e]/95 px-3 py-2.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)] ring-1 ring-white/10 backdrop-blur-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2"
    >
      <svg viewBox="0 0 26 26" className="size-6 shrink-0 -rotate-90" aria-hidden>
        <circle cx="13" cy="13" r="11" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
        <circle
          cx="13" cy="13" r="11" fill="none"
          stroke={accion.tipo === 'enviar' ? '#21c063' : '#c7c7cc'}
          strokeWidth="3" strokeLinecap="round" strokeDasharray="69.12"
          className="pr-cuenta"
          style={{ ['--pr-cuenta-ms' as string]: `${DESHACER_MS}ms` }}
        />
      </svg>
      <p className="min-w-0 flex-1 truncate text-[15px] text-white lg:text-[13.5px]">
        {accion.tipo === 'enviar' ? <>Mandando a <b className="font-semibold">{quien}</b>…</> : <><b className="font-semibold">{quien}</b>: lista</>}
      </p>
      <button
        type="button"
        onClick={onDeshacer}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[15px] font-semibold text-[#4cd884] outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-[#4cd884]/60 lg:h-8 lg:text-[13.5px]"
      >
        <Undo2 aria-hidden className="size-4" /> Deshacer
      </button>
    </div>
  )
}

function Escena({ pose, titulo, texto, children }: {
  pose: 'saludo' | 'logro' | 'ayuda' | 'analiza'
  titulo: string
  texto: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <TexPose pose={pose} alto={150} halo entrada={pose === 'logro' ? 'logro' : 'suave'} prioridad />
      <p className="mt-5 text-[22px] font-bold leading-7 tracking-tight text-white lg:text-[19px]">{titulo}</p>
      <p className="mt-1.5 max-w-xs text-[15px] leading-5 text-[var(--wa-text-2)] lg:text-[13.5px]">{texto}</p>
      {children && <div className="mt-6 flex w-full max-w-xs flex-col gap-2.5">{children}</div>}
    </div>
  )
}

function BotonEscena({ children, onClick, principal = false }: { children: React.ReactNode; onClick: () => void; principal?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-12 w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold outline-none transition-[transform,background-color] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:h-10 lg:text-[14px]',
        principal ? 'bg-[var(--wa-accent)] text-[var(--wa-on-accent)] hover:bg-[var(--wa-accent-hover)]' : 'bg-white/[0.08] text-white hover:bg-white/[0.12]',
      )}
    >
      {children}
    </button>
  )
}

const COLORES_PAPELITOS = ['#21c063', '#ffb340', '#64b5ff', '#ff6961', '#bf5af2', '#f5f5f5']

/** «Todo respondido»: Tex con la copa, los papelitos y lo que se hizo. */
function Festejo({ respondidas, listas, vencidas, onVencidas, onAvisos }: {
  respondidas: number
  listas: number
  vencidas: number
  onVencidas: () => void
  onAvisos?: () => void
}) {
  // Los papelitos: posiciones al azar, fijas para este festejo.
  const [papelitos] = useState(() =>
    Array.from({ length: 34 }, (_, i) => ({
      izquierda: Math.random() * 100,
      x: `${(Math.random() - 0.5) * 120}px`,
      giro: `${360 + Math.random() * 540}deg`,
      dura: `${1.8 + Math.random() * 1.4}s`,
      demora: `${Math.random() * 0.5}s`,
      color: COLORES_PAPELITOS[i % COLORES_PAPELITOS.length],
      ancho: 6 + Math.round(Math.random() * 5),
    })),
  )
  const partes = [
    respondidas > 0 ? `${respondidas} ${respondidas === 1 ? 'respondida' : 'respondidas'}` : null,
    listas > 0 ? `${listas} ${listas === 1 ? 'marcada como lista' : 'marcadas como listas'}` : null,
  ].filter(Boolean)
  return (
    <div className="relative h-full overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {papelitos.map((c, i) => (
          <span
            key={i}
            className="pr-papelito absolute top-0 block rounded-[2px] opacity-0"
            style={{
              left: `${c.izquierda}%`,
              width: c.ancho,
              height: c.ancho * 1.6,
              backgroundColor: c.color,
              ['--pr-x' as string]: c.x,
              ['--pr-giro' as string]: c.giro,
              ['--pr-dura' as string]: c.dura,
              ['--pr-demora' as string]: c.demora,
            }}
          />
        ))}
      </div>
      <Escena pose="logro" titulo="Todo respondido" texto={partes.length > 0 ? `${partes.join(' y ')}. Nadie quedó esperando.` : 'Nadie quedó esperando.'}>
        {vencidas > 0 && <BotonEscena onClick={onVencidas}>Ver {vencidas} vencidas de la semana</BotonEscena>}
        {onAvisos && <BotonEscena principal onClick={onAvisos}><Bell aria-hidden className="size-4" /> Avisame cuando llegue algo</BotonEscena>}
      </Escena>
    </div>
  )
}

/** En la compu ancha: las que siguen, para traer una arriba. */
function ColaLateral({ lista, ahora, onElegir, cierres, onCierres }: {
  lista: Pendiente[]
  ahora: number
  onElegir: (id: string) => void
  cierres: number
  onCierres: () => void
}) {
  return (
    <aside className="hidden min-h-0 flex-col border-l border-[var(--wa-divider)] px-3 py-4 lg:@min-[1100px]/columnas:flex" aria-label="Lo que sigue">
      <p className="flex items-center gap-2 px-2 pb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--wa-text-2)]">
        <Layers aria-hidden className="size-4" /> Lo que sigue
      </p>
      {lista.length === 0 ? (
        <p className="px-2 text-[13px] text-[var(--wa-text-2)]">Nada más en la pila.</p>
      ) : (
        <ul className="wa-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {lista.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onElegir(p.id)}
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left outline-none transition-colors hover:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
              >
                <Avatar name={p.nombre} size={36} avatarUrl={p.avatarUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-[var(--wa-text)]">{p.nombre}</span>
                  <span className="flex items-center gap-1 truncate text-[12px] text-[var(--wa-text-2)]">
                    {p.tipo === 'resena'
                      ? <><Star aria-hidden className="size-3 fill-[#ffb340] text-[#ffb340]" /> {textoNota(p.nota ?? p.notaFinal ?? 0)}</>
                      : p.esCierre ? 'Cierre de charla' : <><MessageCircleQuestion aria-hidden className="size-3" /> Consulta</>}
                    <span aria-hidden>·</span> {haceCuanto(p.esperandoDesde, ahora)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {cierres > 1 && (
        <button
          type="button"
          onClick={onCierres}
          className="mt-3 rounded-xl px-2 py-2 text-left text-[12.5px] leading-4 text-[var(--wa-text-2)] outline-none hover:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
        >
          {cierres} parecen cierres de charla. <span className="font-medium text-[var(--wa-accent)]">Marcarlas como listas</span>
        </button>
      )}
      <div className="mt-auto space-y-1.5 px-2 pt-4 text-[11.5px] text-[var(--wa-text-2)]">
        <p className="flex items-center gap-2"><ArrowRight aria-hidden className="size-3.5" /> Enviar el borrador</p>
        <p className="flex items-center gap-2"><ArrowLeft aria-hidden className="size-3.5" /> Listo, sin responder</p>
        <p className="flex items-center gap-2"><ArrowDown aria-hidden className="size-3.5" /> Después</p>
        <p className="flex items-center gap-2"><kbd className="rounded border border-white/15 px-1 font-sans text-[10px]">E</kbd> Editar · <kbd className="rounded border border-white/15 px-1 font-sans text-[10px]">⌘Z</kbd> Deshacer</p>
      </div>
    </aside>
  )
}
