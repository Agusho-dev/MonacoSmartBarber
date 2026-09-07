'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, Copy, Loader2, Send, Undo2 } from 'lucide-react'
import { registrarArrepentimiento } from './acciones'

interface Props {
  /** Slug de la sucursal, si el visitante llegó desde el turnero (`?suc=`). */
  sucursal: string | null
  contactEmail: string
}

/**
 * El formulario del botón de arrepentimiento.
 *
 * Tres decisiones que parecen de forma y son de fondo:
 *
 *  · **No pide cuenta ni login.** La Disposición 954/2025 lo exige
 *    explícitamente ("sin necesidad de registro previo"). Cualquier gate acá
 *    —aunque fuera "verificá tu teléfono con un código"— convierte un derecho
 *    en un trámite.
 *  · **El teléfono es el único campo realmente obligatorio junto al nombre**, y
 *    se explica para qué: es la dirección por la que se responde, no un dato
 *    que juntamos. El número de operación es opcional porque nadie lo tiene a
 *    mano, y su ausencia no puede frenar el pedido.
 *  · **El código de identificación se muestra en pantalla y se puede copiar.**
 *    La disposición pide "un código de identificación"; un código que sólo
 *    existe en un mail que quizás no llega no cumple nada.
 */
export function FormularioArrepentimiento({ sucursal, contactEmail }: Props) {
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [operacion, setOperacion] = useState('')
  const [detalle, setDetalle] = useState('')
  const [error, setError] = useState('')
  const [enviando, startTransition] = useTransition()
  const [enviado, setEnviado] = useState<{ codigo: string; respuestaAntesDe: string } | null>(null)
  const [copiado, setCopiado] = useState(false)

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    startTransition(async () => {
      const r = await registrarArrepentimiento({
        nombre,
        telefono,
        operacion,
        detalle,
        sucursal: sucursal ?? undefined,
      })

      if (!r.ok) {
        setError(r.error)
        return
      }
      setEnviado({ codigo: r.codigo, respuestaAntesDe: r.respuestaAntesDe })
    })
  }

  async function copiarCodigo() {
    if (!enviado) return
    try {
      await navigator.clipboard.writeText(enviado.codigo)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Sin permiso de portapapeles el código igual está a la vista y se puede
      // seleccionar: no hay nada que arreglar.
    }
  }

  if (enviado) {
    return (
      <div className="rounded-2xl border-2 border-gray-900 p-6">
        <span className="flex size-12 items-center justify-center rounded-full bg-gray-900 text-white">
          <Check className="size-6" />
        </span>
        <h2 className="mt-4 text-xl font-bold text-gray-900">Recibimos tu pedido</h2>
        <p className="mt-1.5 text-gray-600 leading-relaxed">
          Te respondemos por WhatsApp al número que dejaste, antes del{' '}
          <strong className="text-gray-900">{enviado.respuestaAntesDe}</strong>.
        </p>

        <div className="mt-5 rounded-xl bg-gray-100 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Tu código de identificación
          </p>
          <div className="mt-1.5 flex items-center gap-3">
            <p className="flex-1 text-2xl font-bold tracking-wider text-gray-900">
              {enviado.codigo}
            </p>
            <button
              type="button"
              onClick={copiarCodigo}
              aria-label="Copiar el código de identificación"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-white"
            >
              {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            Guardalo o sacale una foto. Con ese código podemos encontrar tu pedido si nos escribís
            por cualquier otra vía.
          </p>
        </div>

        <p className="mt-5 text-sm text-gray-500 leading-relaxed">
          Si no tenés novedades en 24 horas, escribinos a{' '}
          <a href={`mailto:${contactEmail}`} className="text-blue-600 hover:underline">
            {contactEmail}
          </a>{' '}
          o acercate a cualquiera de nuestros locales con este código. Tu derecho corre desde este
          momento, no desde que te respondamos.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={enviar} className="space-y-5">
      {error && (
        <div
          className="rounded-xl bg-red-50 p-4 text-sm font-medium leading-relaxed text-red-800"
          role="alert"
        >
          {error}
        </div>
      )}

      <div>
        <label htmlFor="arr-nombre" className="block text-sm font-semibold text-gray-900">
          Tu nombre
        </label>
        <input
          id="arr-nombre"
          type="text"
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          required
          minLength={2}
          maxLength={80}
          // `autoComplete="off"` y un `name` no estándar: con `given-name`,
          // Chrome rellena el perfil guardado del dueño del teléfono, que en una
          // tablet compartida no es quien está reclamando.
          autoComplete="off"
          name="arr-nombre-persona"
          className="mt-1.5 h-12 w-full rounded-xl border border-gray-300 px-3.5 text-base text-gray-900 outline-none focus:border-gray-900"
          placeholder="Nombre y apellido"
        />
      </div>

      <div>
        <label htmlFor="arr-telefono" className="block text-sm font-semibold text-gray-900">
          Tu teléfono
        </label>
        <input
          id="arr-telefono"
          type="tel"
          inputMode="tel"
          value={telefono}
          onChange={e => setTelefono(e.target.value)}
          required
          maxLength={20}
          autoComplete="off"
          name="arr-telefono-contacto"
          className="mt-1.5 h-12 w-full rounded-xl border border-gray-300 px-3.5 text-base text-gray-900 outline-none focus:border-gray-900"
          placeholder="351 212 5249"
        />
        <p className="mt-1.5 text-sm text-gray-500">
          Es por donde te respondemos, dentro de las 24 horas. Poné el mismo con el que reservaste.
        </p>
      </div>

      <div>
        <label htmlFor="arr-operacion" className="block text-sm font-semibold text-gray-900">
          Número de operación de Mercado Pago{' '}
          <span className="font-normal text-gray-500">(opcional)</span>
        </label>
        <input
          id="arr-operacion"
          type="text"
          inputMode="numeric"
          value={operacion}
          onChange={e => setOperacion(e.target.value)}
          maxLength={32}
          autoComplete="off"
          name="arr-operacion-pago"
          className="mt-1.5 h-12 w-full rounded-xl border border-gray-300 px-3.5 text-base text-gray-900 outline-none focus:border-gray-900"
          placeholder="Lo encontrás en el comprobante de Mercado Pago"
        />
        <p className="mt-1.5 text-sm text-gray-500">
          Si lo tenés a mano, encontramos tu pago más rápido. Si no, no importa: lo buscamos por el
          teléfono.
        </p>
      </div>

      <div>
        <label htmlFor="arr-detalle" className="block text-sm font-semibold text-gray-900">
          ¿Querés contarnos algo? <span className="font-normal text-gray-500">(opcional)</span>
        </label>
        <textarea
          id="arr-detalle"
          value={detalle}
          onChange={e => setDetalle(e.target.value)}
          rows={3}
          maxLength={2000}
          className="mt-1.5 w-full rounded-xl border border-gray-300 p-3.5 text-base text-gray-900 outline-none focus:border-gray-900"
          placeholder="Qué turno era, o cualquier cosa que nos ayude a encontrarlo."
        />
        <p className="mt-1.5 text-sm text-gray-500">
          No tenés que justificar nada: el arrepentimiento no necesita motivo.
        </p>
      </div>

      <button
        type="submit"
        disabled={enviando}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-gray-900 text-base font-bold text-white disabled:opacity-60"
      >
        {enviando ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Enviando…
          </>
        ) : (
          <>
            <Send className="size-4" />
            Enviar mi pedido
          </>
        )}
      </button>

      <p className="text-center text-sm text-gray-500 leading-relaxed">
        Al enviarlo aceptás que usemos tu nombre y teléfono para responderte, según nuestra{' '}
        <Link href="/privacidad" className="text-blue-600 hover:underline">
          Política de Privacidad
        </Link>
        . Podés leer el detalle del derecho en el punto 5 de los{' '}
        <Link href="/terminos" className="text-blue-600 hover:underline">
          términos y condiciones
        </Link>
        .
      </p>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-gray-400">
        <Undo2 className="size-3" />
        Arts. 1110 a 1116 del Código Civil y Comercial · Art. 34 Ley 24.240 · Disp. 954/2025
      </p>
    </form>
  )
}
