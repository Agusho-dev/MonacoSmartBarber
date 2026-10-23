'use client'

// "Nuevo chat", como en WhatsApp (23/oct/2026): en el celular, la hoja de iOS
// de pantalla entera con el buscador en píldora y los clientes como filas (foto,
// nombre y teléfono); en la compu, el diálogo de WhatsApp para Mac. Tocar un
// cliente abre su chat (lo crea si no existía), como en WhatsApp: ya no hay que
// elegirlo y después apretar "Abrir chat".
//
// Los clientes se buscan en la base a medida que se escribe (searchClients, 2
// letras o más): traer los 10.000 de una vez en cada carga era lo de antes.

import { useEffect, useRef, useState, type RefObject } from 'react'
import { AlertCircle, Loader2, Search, SearchX, UsersRound, X } from 'lucide-react'
import { searchClients } from '@/lib/actions/clients'
import { cn } from '@/lib/utils'
import { Avatar } from '../shared/avatar'
import { formatearTelefonoAr } from '../shared/helpers'
import { useMensajeria } from '../shared/mensajeria-context'
import { HojaWhatsApp } from './hoja-whatsapp'

type ClienteEncontrado = { id: string; name: string; phone: string }

export function NewChatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <HojaWhatsApp
      open={open}
      onOpenChange={onOpenChange}
      titulo="Nuevo chat"
      descripcion="Buscá un cliente por nombre o teléfono para abrir su chat."
      // En la compu el foco va al buscador (no a "Cancelar"): es lo único que
      // hay para hacer. Con pantalla táctil va a la hoja (HojaWhatsApp).
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        inputRef.current?.focus()
      }}
    >
      {/* Se monta con la hoja abierta: cada vez arranca con el buscador vacío. */}
      <BuscadorDeClientes inputRef={inputRef} onElegido={() => onOpenChange(false)} />
    </HojaWhatsApp>
  )
}

function BuscadorDeClientes({
  inputRef,
  onElegido,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  onElegido: () => void
}) {
  const { isConfigured, handleStartConversation } = useMensajeria()
  const [texto, setTexto] = useState('')
  const [resultado, setResultado] = useState<{ buscado: string; clientes: ClienteEncontrado[]; error?: string } | null>(null)
  const buscado = texto.trim()
  const alcanza = buscado.length >= 2
  // Lo que se ve es la respuesta a lo que está escrito: mientras llega la de
  // lo último que se tecleó, "Buscando…".
  const buscando = alcanza && resultado?.buscado !== buscado
  const clientes = alcanza && !buscando ? (resultado?.clientes ?? []) : []
  const errorBusqueda = alcanza && !buscando ? resultado?.error : undefined

  // Busca en la base 300 ms después de la última tecla. Una respuesta vieja que
  // llega tarde no pisa a la nueva (se descarta al cambiar el texto).
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

  const elegir = (cliente: ClienteEncontrado) => {
    if (!isConfigured) return
    handleStartConversation(cliente.id)
    onElegido()
  }

  return (
    <>
      <div className="shrink-0 px-4 pb-3 pt-1 lg:px-5 lg:pb-3 lg:pt-4">
        <div className="relative flex h-10 items-center rounded-full bg-[var(--wa-field)] lg:h-9 lg:focus-within:ring-1 lg:focus-within:ring-white/15">
          <span aria-hidden className="pointer-events-none absolute left-3.5 flex text-[var(--wa-text-2)] lg:left-3">
            {buscando ? <Loader2 className="size-[18px] animate-spin lg:size-4" /> : <Search className="size-[18px] lg:size-4" />}
          </span>
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Buscar un cliente por nombre o teléfono"
            placeholder="Buscar nombre o teléfono"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            // 16 px en lo táctil: iOS agranda la pantalla al enfocar un campo de menos.
            className="h-full w-full appearance-none rounded-full bg-transparent pl-10 pr-10 text-base text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-text-2)] lg:pl-9 lg:pointer-fine:text-[14px] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
          />
          {texto && (
            <button
              type="button"
              onClick={() => {
                setTexto('')
                inputRef.current?.focus()
              }}
              aria-label="Borrar la búsqueda"
              className="absolute right-1.5 flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
            >
              <span className="flex size-[18px] items-center justify-center rounded-full bg-[var(--wa-text-3)]">
                <X aria-hidden className="size-3 text-[var(--wa-bg)]" strokeWidth={3} />
              </span>
            </button>
          )}
        </div>
        {!isConfigured && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-400/10 px-3 py-2.5 text-[14px] leading-snug text-amber-300 lg:text-[13px]">
            <AlertCircle aria-hidden className="mt-px size-4 shrink-0" />
            Para abrir un chat, primero conectá WhatsApp en Configuración.
          </p>
        )}
      </div>

      <div
        className="wa-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain lg:min-h-[280px] lg:pb-2"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
        aria-busy={buscando || undefined}
      >
        {!alcanza ? (
          <Aviso icono={UsersRound} titulo="Buscá un cliente" texto="Escribí al menos dos letras del nombre o del teléfono." />
        ) : buscando ? (
          <p role="status" className="flex items-center justify-center gap-2 px-6 py-10 text-[15px] text-[var(--wa-text-2)] lg:text-[13px]">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Buscando…
          </p>
        ) : errorBusqueda ? (
          <Aviso icono={AlertCircle} titulo="No pudimos buscar" texto={errorBusqueda} />
        ) : clientes.length === 0 ? (
          <Aviso icono={SearchX} titulo={`Sin resultados para “${buscado}”`} texto="Probá con otra parte del nombre o con el teléfono." />
        ) : (
          <>
            <h3 className="px-4 pb-1 pt-1 text-[13px] font-semibold text-[var(--wa-text-2)] lg:px-5 lg:text-[12px]">Clientes</h3>
            <ul>
              {clientes.map((c, i) => {
                const telefono = c.phone ? (formatearTelefonoAr(c.phone) ?? c.phone) : 'Sin teléfono'
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => elegir(c)}
                      disabled={!isConfigured}
                      className={cn(
                        'flex w-full items-center gap-3 pl-4 text-left outline-none [-webkit-tap-highlight-color:transparent]',
                        'transition-colors duration-100 active:bg-[var(--wa-hover)] disabled:opacity-50 focus-visible:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--wa-accent)]',
                        'lg:mx-2 lg:w-[calc(100%-1rem)] lg:rounded-xl lg:pl-3 lg:enabled:hover:bg-[var(--wa-hover)]',
                      )}
                    >
                      <Avatar name={c.name} size={44} className="lg:size-10 lg:text-sm" />
                      <span
                        className={cn(
                          'flex min-h-[60px] min-w-0 flex-1 flex-col justify-center border-b-[0.5px] pr-4 lg:min-h-[56px] lg:border-transparent lg:pr-3',
                          i === clientes.length - 1 ? 'border-transparent' : 'border-[var(--wa-divider)]',
                        )}
                      >
                        <span className="truncate text-[17px] font-medium text-[var(--wa-text)] lg:text-[15px]">{c.name}</span>
                        <span className="truncate text-[14px] tabular-nums text-[var(--wa-text-2)] lg:text-[13px]">{telefono}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </>
  )
}

function Aviso({ icono: Icono, titulo, texto }: { icono: typeof Search; titulo: string; texto: string }) {
  return (
    <div className="flex flex-col items-center px-8 pb-6 pt-12 text-center lg:pt-10">
      <span className="flex size-14 items-center justify-center rounded-full bg-[var(--wa-field)]">
        <Icono aria-hidden className="size-6 text-[var(--wa-text-2)]" strokeWidth={1.8} />
      </span>
      <p className="mt-3.5 max-w-xs break-words text-[17px] font-semibold text-[var(--wa-text)] lg:text-[15px]">{titulo}</p>
      <p className="mt-1 max-w-xs text-[15px] leading-5 text-[var(--wa-text-2)] lg:text-[13px] lg:leading-[18px]">{texto}</p>
    </div>
  )
}
