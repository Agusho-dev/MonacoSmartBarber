'use client'

// =============================================================================
// /dashboard/asistente — la pantalla de Tex.
//
// 1440: riel de conversaciones (264) | hilo centrado (máx. 720) | Lienzo (520,
// al abrir un informe, tabla o gráfico en grande). 390: el shell no muestra la
// barra inferior ni hace swipe en esta ruta; debajo de su header va la subbarra
// [Historial] · estado · [Nueva] y el historial se abre en una hoja.
//
// Alto: el shell NO le suma su padding inferior a esta ruta (ver
// dashboard-shell.tsx), así que la pantalla cancela el padding del <main> con
// márgenes negativos y mide exactamente el viewport menos el header del shell
// (48 px en el celular, 56 en la compu). Con `dvh`, la barra de la URL del
// celular no la empuja debajo del borde.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { RotateCcw, SquarePen } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  borrarConversacionTex,
  cargarConversacionTex,
  fijarConversacionTex,
  listarConversacionesTex,
  renombrarConversacionTex,
} from '@/lib/actions/tex'
import type { TexConversacion, TexPulso, TexUIMessage } from '@/lib/tex/contrato'
import { esErrorDeVersion, TEXTO_RECARGA_MANUAL } from '@/lib/recarga-version'
import { EVENTO_ABRIR_TEX, tomarAperturaPendiente, type PedidoAbrirTex } from '@/components/tex/abrir-tex'
import { TexLienzo, useLienzoComoColumna, type ContenidoLienzo } from '@/components/tex/bloques'
import { TexChat, type TexChatHandle } from '@/components/tex/chat/tex-chat'
import { esAtajoTex, hayModalAbierto, punteroFino, useMediaQuery } from '@/components/tex/chat/hooks'
import { TexPose } from '@/components/tex/tex-pose'
import { cn } from '@/lib/utils'
import { nuevoUuid } from '@/components/tex/chat/ids'
import { cambiarEnLista, esConversacionNoEncontrada, historialRefrescado, tituloProvisorio } from '@/components/tex/chat/logica'
import { crearBorradosConDeshacer } from './borrados'
import { EncabezadoTex, OpcionesTexMovil } from './components/encabezado'
import { EsqueletoHilo } from './components/esqueleto'
import { TexHistorial } from './components/historial'
import { ParteDelDia } from './components/parte-del-dia'

interface Props {
  saludo: string
  orgNombre: string
  puedeConfigurar: boolean
  puedeConciliacion: boolean
  hayClave: boolean
  conversacionesIniciales: TexConversacion[]
  historialConError: boolean
  pulso: TexPulso[]
  /** La conversación que se abre (la de `?c=` o una nueva con id ya generado). */
  inicial: { id: string; mensajes: TexUIMessage[] }
  /** `?c=` apuntaba a una conversación que no existe o no es de esta persona. */
  conversacionNoEncontrada: boolean
  /**
   * `?c=` no se pudo leer (base caída, timeout): la conversación puede estar
   * intacta, así que no se dice "no existe" ni se borra el enlace: se ofrece
   * reintentar.
   */
  aperturaFallida?: { id: string; mensaje: string } | null
  /** Hora del servidor (ms) para agrupar el historial igual al hidratar. */
  ahora: number
}

function mensajeDeError(e: unknown, porDefecto: string): string {
  if (esErrorDeVersion(e)) return TEXTO_RECARGA_MANUAL
  return porDefecto
}

/** `?c=<id>` en la barra, sin navegar (la página es force-dynamic: un router.replace la volvería a pedir entera). */
function ponerConversacionEnUrl(id: string | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('c', id)
  else url.searchParams.delete('c')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

type Apertura = { ok: true } | { ok: false; mensaje: string; noEncontrada: boolean }

export function AsistenteClient({
  saludo,
  orgNombre,
  puedeConfigurar,
  puedeConciliacion,
  hayClave,
  conversacionesIniciales,
  historialConError,
  pulso,
  inicial,
  conversacionNoEncontrada,
  aperturaFallida = null,
  ahora: ahoraInicial,
}: Props) {
  const [conversaciones, setConversaciones] = useState(conversacionesIniciales)
  const [historialError, setHistorialError] = useState(historialConError)
  const [activa, setActiva] = useState(inicial)
  const [cargandoId, setCargandoId] = useState<string | null>(null)
  const [falloAlAbrir, setFalloAlAbrir] = useState(aperturaFallida)
  const [historialAbierto, setHistorialAbierto] = useState(false)
  const [lienzo, setLienzo] = useState<ContenidoLienzo | null>(null)
  // Borradas (o con el "Deshacer" todavía en pantalla): no se muestran, ni
  // aunque una búsqueda en el servidor las traiga.
  const [ocultas, setOcultas] = useState<ReadonlySet<string>>(() => new Set())
  const [ahora, setAhora] = useState(ahoraInicial)
  const chatRef = useRef<TexChatHandle>(null)
  const pedidoRef = useRef(0)
  const refrescoRef = useRef(0)
  const [borrados] = useState(() =>
    crearBorradosConDeshacer({
      mostrar: ({ descripcion, onDeshacer, onCerrar }) =>
        toast('Borraste la conversación.', {
          description: descripcion,
          duration: 5000,
          action: { label: 'Deshacer', onClick: onDeshacer },
          onAutoClose: onCerrar,
          onDismiss: onCerrar,
        }),
      cerrar: (id) => toast.dismiss(id),
      tarde: () => toast.error('Ya se borró: no se puede deshacer.'),
    }),
  )

  // El Lienzo va como columna de 520 desde 1280 px; más angosto, como hoja. Con
  // la columna abierta y menos de 1600 px, el riel se pliega: con el menú del
  // shell (256) + riel (264) + Lienzo (520), al hilo le quedarían 400 px.
  const lienzoEnColumna = useLienzoComoColumna()
  const sobraAncho = useMediaQuery('(min-width: 1600px)')
  const columnaAbierta = lienzo !== null && lienzoEnColumna
  const railVisible = !columnaAbierta || sobraAncho

  // "Hoy" / "Ayer" se mueven solos si la pantalla queda abierta de un día para otro.
  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!conversacionNoEncontrada) return
    toast.error('No encontré esa conversación. Empezá una nueva.')
    ponerConversacionEnUrl(null)
  }, [conversacionNoEncontrada])

  // Si la persona se va con un "Deshacer" pendiente, el borrado se hace igual y el aviso se cierra.
  useEffect(() => () => borrados.alSalir(), [borrados])

  // ⌘K en esta pantalla enfoca el composer (el panel lateral no se monta acá),
  // y un `abrirTex()` disparado desde un bloque pregunta en esta misma conversación.
  useEffect(() => {
    // Un pedido de otra pantalla que nadie atendió no se ejecuta acá (la
    // persona ya vino a Tex por su cuenta) ni queda para el panel de la próxima.
    tomarAperturaPendiente()
    function alTeclear(e: KeyboardEvent) {
      if (e.defaultPrevented || !esAtajoTex(e) || hayModalAbierto()) return
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return
      e.preventDefault()
      chatRef.current?.enfocar()
    }
    function alPedido(e: Event) {
      // Atendido acá: si no, el panel lo volvería a abrir al pasar a otra pantalla.
      tomarAperturaPendiente()
      const pedido = (e as CustomEvent<PedidoAbrirTex>).detail ?? {}
      const texto = pedido.pregunta?.trim()
      if (!texto) {
        chatRef.current?.enfocar()
        return
      }
      if (!(pedido.enviar && chatRef.current?.enviar(texto))) chatRef.current?.escribir(texto)
    }
    window.addEventListener('keydown', alTeclear)
    window.addEventListener(EVENTO_ABRIR_TEX, alPedido)
    return () => {
      window.removeEventListener('keydown', alTeclear)
      window.removeEventListener(EVENTO_ABRIR_TEX, alPedido)
    }
  }, [])

  async function refrescarLista() {
    const n = ++refrescoRef.current
    const mantener = activa.id
    try {
      // Tira si no pudo leer. Sin sesión devuelve [] sin tirar: eso no vacía el riel.
      const lista = await listarConversacionesTex()
      if (n !== refrescoRef.current) return
      setConversaciones((anterior) => historialRefrescado(lista, anterior, mantener))
      setHistorialError(false)
    } catch (e) {
      if (n !== refrescoRef.current) return
      // Se conserva la lista que había; el riel avisa que no se pudo actualizar.
      setHistorialError(true)
      if (esErrorDeVersion(e)) toast.error(TEXTO_RECARGA_MANUAL)
    }
  }

  /** La búsqueda del riel en todas las conversaciones (las cargadas son las más recientes). */
  async function buscarEnServidor(consulta: string): Promise<TexConversacion[]> {
    try {
      return await listarConversacionesTex({ buscar: consulta })
    } catch (e) {
      if (esErrorDeVersion(e)) toast.error(TEXTO_RECARGA_MANUAL)
      throw e
    }
  }

  function nueva() {
    pedidoRef.current++ // descarta una conversación que se estaba abriendo
    setCargandoId(null)
    setFalloAlAbrir(null)
    setActiva({ id: nuevoUuid(), mensajes: [] })
    setLienzo(null)
    setHistorialAbierto(false)
    ponerConversacionEnUrl(null)
    // En la compu el foco va directo al composer; en el celular no se abre el teclado solo.
    if (punteroFino()) requestAnimationFrame(() => chatRef.current?.enfocar())
  }

  async function abrirConversacion(id: string): Promise<Apertura> {
    const pedido = ++pedidoRef.current
    setCargandoId(id)
    try {
      const r = await cargarConversacionTex(id)
      // Otro pedido la reemplazó: no hay nada que avisar.
      if (pedido !== pedidoRef.current) return { ok: true }
      if (!r.ok) return { ok: false, mensaje: r.error || 'No pude abrir la conversación.', noEncontrada: esConversacionNoEncontrada(r) }
      setActiva({ id, mensajes: r.mensajes })
      setLienzo(null)
      setFalloAlAbrir(null)
      ponerConversacionEnUrl(id)
      return { ok: true }
    } catch (e) {
      if (pedido !== pedidoRef.current) return { ok: true }
      return { ok: false, mensaje: mensajeDeError(e, 'No pude abrir la conversación. Probá de nuevo.'), noEncontrada: false }
    } finally {
      if (pedido === pedidoRef.current) setCargandoId(null)
    }
  }

  async function elegir(c: TexConversacion) {
    setHistorialAbierto(false)
    if (c.id === activa.id && cargandoId === null && !falloAlAbrir) return
    const r = await abrirConversacion(c.id)
    if (r.ok) {
      // Una conversación abierta desde la búsqueda pasa a la lista: renombrarla, fijarla o borrarla anda igual.
      setConversaciones((lista) => cambiarEnLista(lista, c))
      return
    }
    if (r.noEncontrada) {
      // Se borró en otra pestaña o en otro dispositivo: sale de la lista.
      setConversaciones((lista) => lista.filter((x) => x.id !== c.id))
      toast.error('No encontré esa conversación: ya no existe.')
      return
    }
    toast.error(r.mensaje)
  }

  /** "Reintentar" cuando `?c=` no se pudo leer al entrar. */
  async function reintentarApertura() {
    if (!falloAlAbrir) return
    const { id } = falloAlAbrir
    const r = await abrirConversacion(id)
    if (r.ok) return
    if (r.noEncontrada) {
      setFalloAlAbrir(null)
      ponerConversacionEnUrl(null)
      toast.error('No encontré esa conversación. Empezá una nueva.')
      return
    }
    setFalloAlAbrir({ id, mensaje: r.mensaje })
  }

  function alPrimerMensaje(id: string, texto: string) {
    ponerConversacionEnUrl(id)
    const ahoraIso = new Date().toISOString()
    setConversaciones((lista) =>
      lista.some((c) => c.id === id) ? lista : [{ id, titulo: tituloProvisorio(texto), actualizada: ahoraIso, fijada: false }, ...lista],
    )
  }

  function alTitulo(id: string, titulo: string) {
    setConversaciones((lista) => lista.map((c) => (c.id === id ? { ...c, titulo } : c)))
  }

  function alTurnoTerminado(id: string) {
    const ahoraIso = new Date().toISOString()
    setConversaciones((lista) => lista.map((c) => (c.id === id ? { ...c, actualizada: ahoraIso } : c)))
    void refrescarLista()
  }

  async function renombrar(c: TexConversacion, titulo: string) {
    const anterior = c.titulo
    setConversaciones((lista) => cambiarEnLista(lista, c, { titulo }))
    let error: string | null = null
    try {
      const r = await renombrarConversacionTex(c.id, titulo)
      if (!r.ok) error = r.error || 'No pude renombrar la conversación.'
    } catch (e) {
      error = mensajeDeError(e, 'No pude renombrar la conversación.')
    }
    if (error) {
      setConversaciones((lista) => lista.map((x) => (x.id === c.id ? { ...x, titulo: anterior } : x)))
      toast.error(error)
    }
  }

  async function fijar(c: TexConversacion, fijada: boolean) {
    setConversaciones((lista) => cambiarEnLista(lista, c, { fijada }))
    let error: string | null = null
    try {
      const r = await fijarConversacionTex(c.id, fijada)
      if (!r.ok) error = r.error || 'No pude fijar la conversación.'
    } catch (e) {
      error = mensajeDeError(e, 'No pude fijar la conversación.')
    }
    if (error) {
      setConversaciones((lista) => lista.map((x) => (x.id === c.id ? { ...x, fijada: !fijada } : x)))
      toast.error(error)
    }
  }

  function mostrarOtraVez(c: TexConversacion) {
    setOcultas((prev) => {
      const sig = new Set(prev)
      sig.delete(c.id)
      return sig
    })
    setConversaciones((lista) => cambiarEnLista(lista, c))
  }

  function borrar(conversacion: TexConversacion) {
    const { id } = conversacion
    setOcultas((prev) => new Set(prev).add(id))
    if (id === activa.id) nueva()
    borrados.programar(
      id,
      conversacion.titulo,
      async () => {
        let error: string | null = null
        try {
          const r = await borrarConversacionTex(id)
          if (!r.ok) error = r.error || 'No pude borrar la conversación.'
        } catch (e) {
          error = mensajeDeError(e, 'No pude borrar la conversación.')
        }
        if (error) {
          mostrarOtraVez(conversacion)
          toast.error(`${error} Volvió a la lista.`)
          return
        }
        // Borrada: sale de la lista y sigue oculta (una búsqueda vieja no la trae de vuelta).
        setConversaciones((lista) => lista.filter((c) => c.id !== id))
      },
      () => mostrarOtraVez(conversacion),
    )
  }

  const historialProps = {
    conversaciones,
    ocultas,
    activaId: activa.id,
    cargandoId,
    ahora,
    error: historialError,
    onElegir: elegir,
    onNueva: nueva,
    onRenombrar: renombrar,
    onFijar: fijar,
    onBorrar: borrar,
    onReintentar: () => void refrescarLista(),
    onBuscar: buscarEnServidor,
  }

  return (
    <div className="-m-3 flex h-[calc(100dvh-3rem)] min-h-0 overflow-hidden lg:-m-6 lg:h-[calc(100dvh-3.5rem)]">
      <aside
        aria-label="Historial de conversaciones"
        className={cn('hidden w-[264px] shrink-0 flex-col border-r bg-sidebar/60', railVisible && 'lg:flex')}
      >
        <TexHistorial {...historialProps} />
      </aside>

      <section aria-label="Conversación con Tex" className="relative flex min-w-0 flex-1 flex-col">
        <TexChat
          key={activa.id}
          ref={chatRef}
          conversacionId={activa.id}
          mensajesIniciales={activa.mensajes}
          variante="pagina"
          orgNombre={orgNombre}
          puedeConfigurar={puedeConfigurar}
          puedeConciliacion={puedeConciliacion}
          hayClave={hayClave}
          encabezado={(info) => (
            <EncabezadoTex
              info={info}
              puedeConfigurar={puedeConfigurar}
              onNueva={nueva}
              onAbrirHistorial={() => setHistorialAbierto(true)}
            />
          )}
          vacio={({ enviar }) => (
            <ParteDelDia
              saludo={saludo}
              orgNombre={orgNombre}
              pulso={pulso}
              puedeConciliacion={puedeConciliacion}
              onPreguntar={enviar}
            />
          )}
          onPrimerMensaje={alPrimerMensaje}
          onTitulo={alTitulo}
          onTurnoTerminado={alTurnoTerminado}
          onAbrirLienzo={setLienzo}
          onNueva={nueva}
        />

        {cargandoId ? (
          // Encima del chat y no en su lugar: si la conversación no abre, la
          // actual sigue intacta (con lo que se habló en esta visita).
          <div className="absolute inset-0 z-20 flex flex-col bg-background">
            <EncabezadoTex
              info={{ estado: 'reposo', linea: 'Abriendo la conversación…', ocupado: false, vacia: true }}
              puedeConfigurar={puedeConfigurar}
              onNueva={nueva}
              onAbrirHistorial={() => setHistorialAbierto(true)}
            />
            <EsqueletoHilo />
          </div>
        ) : (
          falloAlAbrir && (
            <div className="absolute inset-0 z-20 flex flex-col bg-background">
              <EncabezadoTex
                info={{ estado: 'reposo', linea: '', ocupado: false, vacia: true }}
                puedeConfigurar={puedeConfigurar}
                onNueva={nueva}
                onAbrirHistorial={() => setHistorialAbierto(true)}
              />
              <div className="flex flex-1 items-center justify-center overflow-y-auto p-4">
                <div role="alert" className="flex w-full max-w-md items-start gap-3 rounded-[14px] border border-red-500/25 bg-red-500/[0.06] p-4">
                  <TexPose pose="ayuda" alto={56} entrada="suave" />
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="text-sm font-medium text-foreground">No pude abrir esta conversación.</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {/* "No pudimos abrir…" repetiría el título: se dice qué hacer. */}
                      {/^no pud/i.test(falloAlAbrir.mensaje.trim()) ? 'Probá de nuevo en un momento.' : falloAlAbrir.mensaje}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => void reintentarApertura()}>
                        <RotateCcw className="size-3.5" aria-hidden />
                        Reintentar
                      </Button>
                      <Button size="sm" variant="ghost" className="h-9 gap-1.5 text-muted-foreground hover:text-foreground" onClick={nueva}>
                        <SquarePen className="size-3.5" aria-hidden />
                        Empezar una nueva
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        )}
      </section>

      <Sheet open={historialAbierto} onOpenChange={setHistorialAbierto}>
        <SheetContent
          side="left"
          showCloseButton={false}
          aria-describedby={undefined}
          className="w-[88vw] max-w-[360px] gap-0 p-0 sm:max-w-[360px]"
        >
          <SheetTitle className="sr-only">Historial de conversaciones</SheetTitle>
          <TexHistorial {...historialProps} pie={<OpcionesTexMovil puedeConfigurar={puedeConfigurar} />} />
        </SheetContent>
      </Sheet>

      {columnaAbierta ? (
        <aside aria-label="Lienzo" className="flex w-[520px] shrink-0 flex-col border-l">
          <TexLienzo contenido={lienzo} onCerrar={() => setLienzo(null)} orgNombre={orgNombre} variante="columna" />
        </aside>
      ) : (
        <TexLienzo contenido={lienzo} onCerrar={() => setLienzo(null)} orgNombre={orgNombre} variante="hoja" />
      )}
    </div>
  )
}
