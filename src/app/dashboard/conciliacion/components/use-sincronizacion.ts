'use client'

// Traer los movimientos de Mercado Pago desde la pantalla: de a UNA cuenta por
// vez (no en paralelo: cada lectura puede tardar hasta ~45 s y abrir 16 a la
// vez satura la función y la API de MP), mostrando en cada tarjeta en qué va.
// Al terminar avisa para que la pantalla vuelva a pedir la conciliación.
//
// Mientras tanto lo que ya estaba en pantalla sigue visible: nada de spinners
// que la reemplacen, y nada de veredictos parciales (se recalcula UNA vez, al
// final de la cola).

import { useEffect, useRef, useState } from 'react'
import { cuentasParaSincronizar, sincronizarCuentaMP } from '@/lib/actions/conciliacion-mp'
import { llamar } from './llamar'
import type { ErrorDeLectura } from './logica'

export type FaseSync = 'en_cola' | 'leyendo' | 'listo' | 'omitida' | 'error'

export interface EstadoSyncCuenta {
  fase: FaseSync
  detalle: string | null
  /** Lugar en la cola (1 = la primera). */
  posicion: number
}

/** Una cuenta que no se pudo leer en esta corrida (con la hora del fallo: deja de valer cuando se lee bien). */
export type ErrorSync = ErrorDeLectura

export interface EstadoSync {
  activo: boolean
  origen: 'auto' | 'manual' | null
  total: number
  hechas: number
  cuentas: Record<string, EstadoSyncCuenta>
  errores: ErrorSync[]
}

const QUIETO: EstadoSync = { activo: false, origen: null, total: 0, hechas: 0, cuentas: {}, errores: [] }

export interface FinSync {
  origen: 'auto' | 'manual'
  leidas: number
  errores: ErrorSync[]
}

/**
 * `onTerminar` recalcula la pantalla. Si devuelve (o resuelve) `true` —el
 * recálculo salió bien—, las tarjetas dejan "Leída recién · 3 nuevos" y vuelven
 * a mostrar el estado del servidor; los errores quedan a la vista.
 */
export function useSincronizacion(onTerminar: (fin: FinSync) => Promise<boolean> | boolean | void) {
  const [estado, setEstado] = useState<EstadoSync>(QUIETO)
  const corriendo = useRef(false)
  const montado = useRef(true)
  const onTerminarRef = useRef(onTerminar)

  useEffect(() => {
    onTerminarRef.current = onTerminar
  })

  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  async function correr(cola: { cuentaMpId: string; alias: string | null }[], origen: 'auto' | 'manual') {
    corriendo.current = true
    setEstado({
      activo: true,
      origen,
      total: cola.length,
      hechas: 0,
      errores: [],
      cuentas: Object.fromEntries(cola.map((c, i) => [c.cuentaMpId, { fase: 'en_cola' as const, detalle: null, posicion: i + 1 }])),
    })
    const errores: ErrorSync[] = []
    for (let i = 0; i < cola.length; i++) {
      if (!montado.current) break
      const { cuentaMpId, alias } = cola[i]
      setEstado((e) => ({ ...e, cuentas: { ...e.cuentas, [cuentaMpId]: { ...e.cuentas[cuentaMpId], fase: 'leyendo' } } }))
      const r = await llamar(() => sincronizarCuentaMP(cuentaMpId, { origen }))
      let fase: FaseSync
      let detalle: string | null
      if (r.ok !== true) {
        fase = 'error'
        detalle = r.error || 'No se pudo leer.'
        errores.push({ cuentaMpId, alias: ('alias' in r ? r.alias : null) ?? alias, error: detalle, en: Date.now() })
      } else if (r.omitida) {
        fase = 'omitida'
        detalle = r.omitida === 'candado' ? 'Ya se estaba leyendo' : 'Leída hace un momento'
      } else {
        fase = 'listo'
        detalle = r.nuevos > 0 ? `${r.nuevos} ${r.nuevos === 1 ? 'nuevo' : 'nuevos'}` : 'sin novedades'
      }
      setEstado((e) => ({
        ...e,
        hechas: i + 1,
        errores: [...errores],
        cuentas: { ...e.cuentas, [cuentaMpId]: { ...e.cuentas[cuentaMpId], fase, detalle } },
      }))
    }
    corriendo.current = false
    if (!montado.current) return
    setEstado((e) => ({ ...e, activo: false }))
    const recalculada = await onTerminarRef.current({ origen, leidas: cola.length, errores })
    if (recalculada === true && montado.current) limpiarListas()
  }

  /**
   * Al abrir la pantalla (y al volver a ella): sólo las cuentas cuya última
   * lectura tiene más de 10 min. Devuelve si la pantalla se va a recalcular sola
   * (corrió la cola, o ya había otra corrida que lo va a hacer al terminar). Si
   * devuelve false no se leyó nada —el cron u otra pestaña ya las tenía al día,
   * o no se pudo pedir la lista— y quien llama recalcula: si no, quedaban los
   * números de hace horas presentándose como actuales.
   */
  async function auto(): Promise<boolean> {
    if (corriendo.current) return true
    const r = await llamar(() => cuentasParaSincronizar())
    if (!montado.current) return true
    if (corriendo.current) return true
    if (!r.ok) return false
    const cola = r.cuentas.filter((c) => c.necesita)
    if (!cola.length) return false
    await correr(cola, 'auto')
    return true
  }

  /** [Sincronizar]: todas las conectadas del alcance (o las pedidas), aunque estén al día. */
  async function manual(ids?: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
    if (corriendo.current) return { ok: false, error: 'Ya se está leyendo Mercado Pago.' }
    const r = await llamar(() => cuentasParaSincronizar())
    if (!r.ok) return { ok: false, error: r.error }
    if (!montado.current || corriendo.current) return { ok: true }
    const cola = ids ? r.cuentas.filter((c) => ids.includes(c.cuentaMpId)) : r.cuentas
    if (!cola.length) return { ok: false, error: 'No hay cuentas conectadas para leer.' }
    await correr(cola, 'manual')
    return { ok: true }
  }

  /**
   * Después de recalcular: lo que salió bien ya lo dice la tarjeta (con el
   * estado del servidor: "Al día", "Atrasada", "Error"); los errores quedan a la
   * vista. Sin esto la tarjeta seguía en "Leída recién" toda la sesión.
   */
  function limpiarListas() {
    setEstado((e) => {
      if (e.activo) return e
      const cuentas: Record<string, EstadoSyncCuenta> = {}
      for (const [id, c] of Object.entries(e.cuentas)) if (c.fase === 'error') cuentas[id] = c
      return { ...e, cuentas }
    })
  }

  /**
   * Saca los errores que ya no valen (la cuenta se volvió a leer bien después:
   * el cron, otra pestaña). Sin esto la banda roja y el "No se pudo leer" de la
   * tarjeta quedaban fijos hasta la próxima corrida desde esta pantalla.
   */
  function podarErrores(resuelto: (e: ErrorSync) => boolean) {
    setEstado((e) => {
      if (e.activo) return e
      const quedan = e.errores.filter((x) => !resuelto(x))
      if (quedan.length === e.errores.length) return e
      const vivos = new Set(quedan.map((x) => x.cuentaMpId))
      const cuentas: Record<string, EstadoSyncCuenta> = {}
      for (const [id, c] of Object.entries(e.cuentas)) if (c.fase !== 'error' || vivos.has(id)) cuentas[id] = c
      return { ...e, errores: quedan, cuentas }
    })
  }

  return { estado, auto, manual, limpiarListas, podarErrores }
}
