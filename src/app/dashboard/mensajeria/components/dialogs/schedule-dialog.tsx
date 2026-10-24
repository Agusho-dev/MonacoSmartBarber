'use client'

// Programar un mensaje, con la hoja de WhatsApp (hoja-whatsapp.tsx): en el
// celular la hoja de iOS de pantalla entera, en la compu el diálogo de la Mac.
// Desde Programados se abre sin cliente; desde la info. del contacto, con el
// cliente de esa conversación ya elegido (clienteInicial).
//
// Programa él mismo (scheduleMessageAuto) en vez de pasar por handleSchedule
// del contexto, que no devuelve nada: así sabe si salió bien, y entonces se
// cierra y relee Programados (la lista y el contador de pendientes se
// actualizan solos); si falló, queda abierto con lo escrito. Valida y avisa con
// los mismos textos que handleSchedule.

import { useEffect, useState, useTransition } from 'react'
import { AlertCircle, Loader2, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { scheduleMessageAuto } from '@/lib/actions/conversations'
import { obtenerProgramados } from '@/lib/actions/programados'
import { searchClients } from '@/lib/actions/clients'
import { avisarYRecargarPorVersion, esErrorDeVersion, TEXTO_RECARGA_MANUAL } from '@/lib/recarga-version'
import { cn } from '@/lib/utils'
import { Avatar } from '../shared/avatar'
import { formatearTelefonoAr } from '../shared/helpers'
import { WhatsAppIcon } from '../shared/icons'
import { useMensajeria } from '../shared/mensajeria-context'
import { CampoFechaHora } from './campo-fecha-hora'
import { HojaWhatsApp } from './hoja-whatsapp'

/** El cliente con el que se abre el diálogo (la info. del contacto lo pasa). */
export interface ClienteInicial {
  id: string
  nombre: string
  /**
   * La foto de perfil de la conversación (la de Instagram), si la hay: «Para»
   * la muestra, como la info. del contacto. Sin ella, las iniciales.
   */
  foto?: string | null
}

type ClienteEncontrado = { id: string; name: string; phone: string }

export function ScheduleDialog({
  open,
  onOpenChange,
  clienteInicial = null,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  clienteInicial?: ClienteInicial | null
}) {
  const { setScheduled } = useMensajeria()
  const [cliente, setCliente] = useState<ClienteInicial | null>(clienteInicial)
  const [mensaje, setMensaje] = useState('')
  const [cuando, setCuando] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [resultado, setResultado] = useState<{ buscado: string; clientes: ClienteEncontrado[]; error?: string } | null>(null)
  const [programando, startProgramando] = useTransition()

  // Cada vez que se abre, arranca de cero con el cliente que le pasan (o sin
  // ninguno). Se resuelve al dibujar, sin efecto: el formulario ya aparece
  // bien en el primer cuadro.
  const [abiertoAntes, setAbiertoAntes] = useState(open)
  if (open !== abiertoAntes) {
    setAbiertoAntes(open)
    if (open) {
      setCliente(clienteInicial)
      setMensaje('')
      setCuando('')
      setBusqueda('')
      setResultado(null)
    }
  }

  const buscado = busqueda.trim()
  const alcanza = !cliente && buscado.length >= 2
  const buscando = alcanza && resultado?.buscado !== buscado
  const clientes = alcanza && !buscando ? (resultado?.clientes ?? []) : []
  const errorBusqueda = alcanza && !buscando ? resultado?.error : undefined

  // Busca en la base 300 ms después de la última tecla (2 letras o más).
  useEffect(() => {
    if (!alcanza) return
    let vigente = true
    const reloj = setTimeout(async () => {
      try {
        const r = await searchClients(buscado)
        if (vigente) setResultado({ buscado, clientes: r.data ?? [], error: r.error })
      } catch {
        if (vigente) setResultado({ buscado, clientes: [], error: 'No pudimos buscar. Revisá la conexión.' })
      }
    }, 300)
    return () => {
      vigente = false
      clearTimeout(reloj)
    }
  }, [alcanza, buscado])

  const programar = () => {
    if (!cliente || !mensaje.trim() || !cuando) {
      toast.error('Completá todos los campos')
      return
    }
    // Ningún rechazo puede salir de la transición: en React 19 sube al error
    // boundary y se llevaba toda Mensajería («Algo salió mal»), aunque el
    // mensaje ya hubiera quedado programado.
    startProgramando(async () => {
      let r: Awaited<ReturnType<typeof scheduleMessageAuto>>
      try {
        r = await scheduleMessageAuto({
          clientId: cliente.id,
          content: mensaje.trim(),
          scheduledFor: new Date(cuando).toISOString(),
        })
      } catch (e) {
        if (esErrorDeVersion(e) && avisarYRecargarPorVersion()) return
        toast.error(esErrorDeVersion(e) ? TEXTO_RECARGA_MANUAL : 'No se pudo programar el mensaje. Revisá la conexión y probá de nuevo.')
        return
      }
      if (r.error) {
        toast.error(r.error)
        return
      }
      toast.success('Mensaje programado')
      onOpenChange(false)
      // La lista de Programados (y el contador de pendientes) con el nuevo. Si
      // la relectura falla no se avisa: Programados vuelve a leer al abrirse.
      try {
        const lista = await obtenerProgramados()
        if (!lista.error) setScheduled(lista.data)
      } catch {
        // nada
      }
    })
  }

  const etiqueta = 'mb-1.5 px-1 text-[13px] font-semibold text-[var(--wa-text-2)] lg:text-[12px]'
  const campo =
    'w-full rounded-xl bg-[var(--wa-field)] px-3.5 text-[16px] text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-text-2)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/50 lg:pointer-fine:text-[14px]'

  return (
    <HojaWhatsApp
      open={open}
      onOpenChange={onOpenChange}
      titulo="Programar mensaje"
      descripcion="Elegí el cliente, escribí el mensaje y el día y la hora en que sale por WhatsApp."
      // En la compu, el foco a lo que falta: el mensaje si el cliente ya vino
      // elegido (desde la info. del contacto); si no, el buscador de clientes.
      // Con pantalla táctil va a la hoja (HojaWhatsApp).
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        document.getElementById(clienteInicial ? 'programar-mensaje' : 'programar-buscar')?.focus()
      }}
      accion={{
        texto: 'Programar',
        textoCargando: 'Programando…',
        onClick: programar,
        deshabilitada: !cliente || !mensaje.trim() || !cuando,
        cargando: programando,
      }}
    >
      <div
        className="wa-scroll min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-y-contain px-4 pt-2 lg:px-5 lg:pt-4"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
      >
        {/* Para quién */}
        <div>
          <p id="programar-para" className={etiqueta}>Para</p>
          {cliente ? (
            <div className="flex items-center gap-3 rounded-xl bg-[var(--wa-field)] py-2 pl-2.5 pr-1.5">
              <Avatar name={cliente.nombre} size={40} avatarUrl={cliente.foto} />
              <span className="min-w-0 flex-1 truncate text-[16px] font-medium text-[var(--wa-text)] lg:text-[14px]">
                {cliente.nombre}
              </span>
              <button
                type="button"
                onClick={() => {
                  setCliente(null)
                  setBusqueda('')
                  setResultado(null)
                }}
                className="h-9 shrink-0 rounded-full px-3 text-[15px] font-medium text-[var(--wa-accent)] outline-none transition-colors hover:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:h-8 lg:text-[13px]"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <div className="relative flex h-10 items-center rounded-full bg-[var(--wa-field)] lg:h-9 lg:focus-within:ring-1 lg:focus-within:ring-white/15">
                <span aria-hidden className="pointer-events-none absolute left-3.5 flex text-[var(--wa-text-2)] lg:left-3">
                  {buscando ? <Loader2 className="size-[18px] animate-spin lg:size-4" /> : <Search className="size-[18px] lg:size-4" />}
                </span>
                <input
                  id="programar-buscar"
                  type="search"
                  inputMode="search"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-labelledby="programar-para"
                  placeholder="Buscar nombre o teléfono"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="h-full w-full appearance-none rounded-full bg-transparent pl-10 pr-10 text-base text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-text-2)] lg:pl-9 lg:pointer-fine:text-[14px] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                />
                {busqueda && (
                  <button
                    type="button"
                    onClick={() => setBusqueda('')}
                    aria-label="Borrar la búsqueda"
                    className="absolute right-1.5 flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
                  >
                    <span className="flex size-[18px] items-center justify-center rounded-full bg-[var(--wa-text-3)]">
                      <X aria-hidden className="size-3 text-[var(--wa-bg)]" strokeWidth={3} />
                    </span>
                  </button>
                )}
              </div>
              {errorBusqueda ? (
                <p className="mt-2 flex items-center gap-2 px-1 text-[14px] text-[var(--wa-danger)] lg:text-[13px]">
                  <AlertCircle aria-hidden className="size-4 shrink-0" />
                  {errorBusqueda}
                </p>
              ) : alcanza && !buscando && clientes.length === 0 ? (
                <p className="mt-2 px-1 text-[14px] text-[var(--wa-text-2)] lg:text-[13px]">Sin resultados para “{buscado}”</p>
              ) : clientes.length > 0 ? (
                <ul className="mt-2 overflow-hidden rounded-xl bg-[var(--wa-field)]">
                  {clientes.map((c, i) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setCliente({ id: c.id, nombre: c.name })}
                        className="flex w-full items-center gap-3 pl-3 text-left outline-none transition-colors hover:bg-[var(--wa-hover)] active:bg-[var(--wa-hover)] focus-visible:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--wa-accent)]"
                      >
                        <Avatar name={c.name} size={36} />
                        <span
                          className={cn(
                            'flex min-h-[52px] min-w-0 flex-1 flex-col justify-center border-b-[0.5px] pr-3',
                            i === clientes.length - 1 ? 'border-transparent' : 'border-[var(--wa-divider)]',
                          )}
                        >
                          <span className="truncate text-[16px] font-medium text-[var(--wa-text)] lg:text-[14px]">{c.name}</span>
                          <span className="truncate text-[13px] tabular-nums text-[var(--wa-text-2)] lg:text-[12px]">
                            {c.phone ? (formatearTelefonoAr(c.phone) ?? c.phone) : 'Sin teléfono'}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>

        {/* El mensaje */}
        <div>
          <label htmlFor="programar-mensaje" className={cn('block', etiqueta)}>Mensaje</label>
          <textarea
            id="programar-mensaje"
            rows={4}
            placeholder="Escribí el mensaje…"
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            className={cn(campo, 'block resize-none py-2.5 leading-[22px] lg:leading-5')}
          />
        </div>

        {/* Cuándo */}
        <div>
          <label htmlFor="programar-cuando" className={cn('block', etiqueta)}>Día y hora</label>
          {/* De 24 h: el datetime-local del navegador salía "05:30 p. m." (campo-fecha-hora.tsx). */}
          <CampoFechaHora id="programar-cuando" valor={cuando} onCambio={setCuando} claseCampo={cn(campo, 'h-11 lg:h-10')} />
        </div>

        <p className="flex items-start gap-2 px-1 text-[13px] leading-snug text-[var(--wa-text-2)] lg:text-[12px]">
          <WhatsAppIcon className="mt-px size-4 shrink-0 text-[var(--wa-accent)]" />
          Sale solo por WhatsApp Business, el día y a la hora que elijas.
        </p>
      </div>
    </HojaWhatsApp>
  )
}
