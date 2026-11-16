'use client'

import { Check, Crown, Delete, KeyRound, Loader2, X } from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'
import { canjearPinDuenos } from '@/lib/actions/juego'
import { adoptarPase, quitarPase } from '@/lib/juego/ui/pase-duenos'
import { alTocar } from '@/lib/juego/ui/toque'
import { Capa } from './capa'

/**
 * El modo dueño desde adentro del juego (mig 239). 5 toques al logo de Monaco en la portada
 * (pantalla-inicio.tsx) abren esta capa, sin ninguna pista a la vista:
 *  - sin pase: un teclado propio (botones del juego, no un <input>: no sale el teclado del celular).
 *    El PIN va a `canjearPinDuenos` (src/lib/actions/juego.ts), que devuelve el mismo pase que
 *    «Jugar como dueño» del dashboard; se guarda como el del link (`adoptarPase`,
 *    ui/pase-duenos.ts) y el grupo «Dueños» aparece en «Elegí tu barbero» sin recargar.
 *  - con el pase confirmado: «Modo dueño activo», hasta cuándo vale y «Quitar de este celular».
 *
 * Mouse, dedo (también un segundo dedo: `alTocar`) y teclado: los números, Borrar (Backspace o
 * Supr), Enter y Escape para salir. Va en `Capa` (touch-action: none). Con el PIN mal, la capa
 * tiembla y dice «PIN incorrecto»; con el tope, cuántos minutos faltan.
 */

export type VistaPin =
  | { tipo: 'teclado' }
  | { tipo: 'listo'; vence: number }
  | { tipo: 'activo'; vence: number | null }
  | { tipo: 'quitado' }

const LARGO_MINIMO = 4
const LARGO_MAXIMO = 8
const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

function fecha(vence: number): string {
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(vence * 1000))
}

function minutos(seg: number | undefined): number {
  return Math.max(1, Math.ceil((typeof seg === 'number' && Number.isFinite(seg) ? seg : 600) / 60))
}

export function CapaPinDuenos({ inicial, onCerrar }: { inicial: VistaPin; onCerrar: () => void }) {
  const [vista, setVista] = useState<VistaPin>(inicial)
  const [digitos, setDigitos] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  /** Cuántas veces tembló: alterna la animación para que vuelva a arrancar en cada error. */
  const [temblores, setTemblores] = useState(0)

  const sumar = (d: string) => {
    if (enviando) return
    setAviso(null)
    setDigitos((v) => (v.length >= LARGO_MAXIMO ? v : v + d))
  }
  const borrar = () => {
    if (enviando) return
    setDigitos((v) => v.slice(0, -1))
  }

  const fallar = (texto: string, temblar: boolean) => {
    setAviso(texto)
    setDigitos('')
    if (temblar) setTemblores((n) => n + 1)
  }

  const entrar = async () => {
    if (enviando || digitos.length < LARGO_MINIMO) return
    setEnviando(true)
    setAviso(null)
    try {
      const r = await canjearPinDuenos(digitos)
      if (r.ok) {
        if (adoptarPase(r.pase, r.venceEn)) {
          setDigitos('')
          setVista({ tipo: 'listo', vence: r.venceEn })
        } else {
          fallar('No pudimos guardar el pase. Probá de nuevo.', true)
        }
      } else if (r.motivo === 'tope') {
        fallar(`Demasiados intentos. Probá en ${minutos(r.esperarSeg)} min`, false)
      } else {
        fallar('PIN incorrecto', true)
      }
    } catch {
      fallar('No pudimos revisar el PIN. Revisá la conexión.', true)
    } finally {
      setEnviando(false)
    }
  }

  const quitar = () => {
    quitarPase()
    setVista({ tipo: 'quitado' })
  }

  // Teclado de la compu. Con preventDefault, el Enter no aprieta además el botón que tenga el foco.
  const alTeclear = useEffectEvent((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onCerrar()
      return
    }
    if (vista.tipo !== 'teclado') return
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault()
      if (!e.repeat) sumar(e.key)
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      borrar()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!e.repeat) void entrar()
    }
  })
  useEffect(() => {
    const f = (e: KeyboardEvent) => alTeclear(e)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])

  const cerrar = (
    <button type="button" className="cf-pin__cerrar" aria-label="Cerrar" {...alTocar(onCerrar)}>
      <X aria-hidden="true" />
    </button>
  )

  if (vista.tipo !== 'teclado') {
    const titulo = vista.tipo === 'activo' ? 'Modo Boss activo' : 'Listo'
    return (
      <Capa titulo="cf-pin-titulo" className="cf-capa--pin">
        <div className="cf-pin cf-pin--estado" data-vista={vista.tipo}>
          {cerrar}
          <Crown className="cf-pin__corona" aria-hidden="true" />
          <h2 id="cf-pin-titulo" className="cf-titulo cf-pin__titulo">
            {titulo}
          </h2>
          <p className="cf-pin__texto" role="status">
            {vista.tipo === 'listo' && `Listo: los Bosses quedan en este celular hasta el ${fecha(vista.vence)}.`}
            {vista.tipo === 'activo' &&
              (vista.vence ? `Los Bosses están en este celular hasta el ${fecha(vista.vence)}.` : 'Los Bosses están en este celular.')}
            {vista.tipo === 'quitado' && 'Listo: los Bosses ya no están en este celular.'}
          </p>
          <div className="cf-pin__acciones">
            {vista.tipo === 'activo' && (
              <button type="button" className="cf-btn cf-btn--sec" {...alTocar(quitar)}>
                Quitar de este celular
              </button>
            )}
            <button type="button" className="cf-btn" {...alTocar(onCerrar)} autoFocus>
              {vista.tipo === 'quitado' ? 'Cerrar' : 'Listo'}
            </button>
          </div>
        </div>
      </Capa>
    )
  }

  const puedeEntrar = digitos.length >= LARGO_MINIMO && !enviando
  return (
    <Capa titulo="cf-pin-titulo" className="cf-capa--pin">
      <div className="cf-pin" data-tiembla={temblores === 0 ? undefined : temblores % 2 === 0 ? 'a' : 'b'}>
        {cerrar}
        <div className="cf-pin__cabeza">
          <KeyRound className="cf-pin__corona" aria-hidden="true" />
          <h2 id="cf-pin-titulo" className="cf-titulo cf-pin__titulo">
            Modo Boss
          </h2>
          <div className="cf-pin__puntos" aria-label={`${digitos.length} de ${LARGO_MAXIMO} números`} role="img">
            {digitos.length === 0 ? (
              <span className="cf-pin__vacio">Poné el PIN</span>
            ) : (
              Array.from({ length: digitos.length }, (_, i) => <span key={i} className="cf-pin__punto" />)
            )}
          </div>
          <p className={`cf-pin__aviso${aviso ? ' cf-pin__aviso--error' : ''}`} role="alert" aria-live="assertive">
            {enviando ? 'Revisando…' : (aviso ?? ' ')}
          </p>
        </div>
        <div className="cf-pin__teclado" role="group" aria-label="Teclado">
          {TECLAS.map((d) => (
            <button key={d} type="button" className="cf-pin__tecla" disabled={enviando} {...alTocar(() => sumar(d))}>
              {d}
            </button>
          ))}
          <button
            type="button"
            className="cf-pin__tecla cf-pin__tecla--accion"
            aria-label="Borrar"
            disabled={enviando || digitos.length === 0}
            {...alTocar(borrar)}
          >
            <Delete aria-hidden="true" />
          </button>
          <button type="button" className="cf-pin__tecla" disabled={enviando} {...alTocar(() => sumar('0'))}>
            0
          </button>
          <button
            type="button"
            className="cf-pin__tecla cf-pin__tecla--entrar"
            aria-label="Entrar"
            disabled={!puedeEntrar}
            {...alTocar(() => void entrar())}
          >
            {enviando ? <Loader2 className="cf-pin__girando" aria-hidden="true" /> : <Check aria-hidden="true" />}
          </button>
        </div>
      </div>
    </Capa>
  )
}
