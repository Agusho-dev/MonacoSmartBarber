'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getUltimosCortesDelCliente } from '@/lib/actions/visit-history'
import { esVersionDesactualizada, TEXTO_VERSION_NUEVA } from '@/lib/fotos-corte/subida'
import type { UltimosCortesResultado } from '@/lib/types/fotos-corte'

export type UltimosCortesOk = Extract<UltimosCortesResultado, { ok: true }>

/**
 * - `inactivo`: no hay cliente (walk-in sin ficha): no se pide nada.
 * - `cargando`: la primera vez para ese cliente.
 * - `error`: no pudimos leerlo (NO es "no tiene historial").
 * - `listo`: los datos, aunque estén vacíos (primera visita o sin fotos).
 */
export type EstadoUltimosCortes =
  | { tipo: 'inactivo' }
  | { tipo: 'cargando' }
  | { tipo: 'error'; error: string }
  | { tipo: 'listo'; datos: UltimosCortesOk }

/*
 * Caché por cliente compartida por todo el panel. La fila monta la tarjeta
 * activa DOS veces (escritorio y celular, una oculta por CSS) y se re-dibuja
 * con cada evento de Realtime: sin esto serían varias server actions por
 * cliente, encoladas con el cobro (Next 16 las ejecuta de a una). Con esto es
 * UNA por cliente, y otra recién si pasa un minuto o alguien toca Reintentar.
 */
const VIGENCIA_MS = 60_000
const cache = new Map<string, { promesa: Promise<UltimosCortesResultado>; desde: number; resultado?: UltimosCortesResultado }>()

function pedir(clientId: string, limite: number, forzar: boolean): Promise<UltimosCortesResultado> {
  const clave = `${clientId}:${limite}`
  const previa = cache.get(clave)
  if (previa && !forzar) {
    const enVuelo = !previa.resultado
    const vigenteOk = previa.resultado?.ok === true && Date.now() - previa.desde < VIGENCIA_MS
    if (enVuelo || vigenteOk) return previa.promesa
  }
  const promesa = getUltimosCortesDelCliente(clientId, { limite }).catch(
    (e: unknown): UltimosCortesResultado => {
      // El server action rechazó (red, deploy nuevo): se dice como error, nunca como "sin historial".
      console.error('[useUltimosCortes]', e)
      return {
        ok: false,
        motivo: 'error',
        error: esVersionDesactualizada(e) ? TEXTO_VERSION_NUEVA : 'No pudimos cargar su historial.',
      }
    },
  )
  const entrada: { promesa: Promise<UltimosCortesResultado>; desde: number; resultado?: UltimosCortesResultado } = {
    promesa,
    desde: Date.now(),
  }
  cache.set(clave, entrada)
  void promesa.then((r) => {
    entrada.resultado = r
    // Un error no se guarda: la próxima vista lo vuelve a intentar.
    if (!r.ok && cache.get(clave) === entrada) cache.delete(clave)
  })
  return promesa
}

/** Después de un cobro, el historial de ese cliente cambió: la próxima vista lo pide de nuevo. */
export function invalidarUltimosCortes(clientId: string | null | undefined) {
  if (!clientId) return
  for (const clave of [...cache.keys()]) {
    if (clave.startsWith(`${clientId}:`)) cache.delete(clave)
  }
}

/**
 * Los últimos cortes de un cliente (getUltimosCortesDelCliente) con estados
 * explícitos. Una respuesta que llega tarde —cambió el cliente— se descarta.
 * `clientId` null = inactivo (no pide nada).
 */
export function useUltimosCortes(clientId: string | null | undefined, opciones?: { limite?: number }) {
  const limite = opciones?.limite ?? 6
  const clave = clientId ? `${clientId}:${limite}` : null
  const [guardado, setGuardado] = useState<{ clave: string; estado: EstadoUltimosCortes } | null>(null)
  const [intento, setIntento] = useState(0)
  const intentoUsado = useRef(0)

  useEffect(() => {
    if (!clientId || !clave) return
    let vigente = true
    const forzar = intento !== intentoUsado.current
    intentoUsado.current = intento

    // Diferido: un setState síncrono en el cuerpo del efecto encadena renders.
    queueMicrotask(() => {
      if (!vigente) return
      setGuardado((prev) =>
        prev && prev.clave === clave && prev.estado.tipo === 'listo' && !forzar
          ? prev
          : { clave, estado: { tipo: 'cargando' } },
      )
    })

    void pedir(clientId, limite, forzar).then((r) => {
      if (!vigente) return
      setGuardado({ clave, estado: r.ok ? { tipo: 'listo', datos: r } : { tipo: 'error', error: r.error } })
    })
    return () => {
      vigente = false
    }
  }, [clientId, clave, limite, intento])

  const estado: EstadoUltimosCortes = !clave
    ? { tipo: 'inactivo' }
    : guardado && guardado.clave === clave
      ? guardado.estado
      : { tipo: 'cargando' }

  const reintentar = useCallback(() => setIntento((n) => n + 1), [])
  return { estado, reintentar }
}
