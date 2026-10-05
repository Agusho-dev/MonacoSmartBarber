'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { listarProductosParaCobro } from '@/lib/actions/sales'
import { avisarYRecargarPorVersion, esErrorDeVersion, TEXTO_RECARGA_MANUAL } from '@/lib/recarga-version'
import type { ProductoParaCobro, ResultadoProductosParaCobro } from '@/lib/productos/reglas'

/**
 * Los productos de una sucursal para el cobro y la venta directa.
 *
 * Reemplaza la lectura con la anon key desde el browser, que desde el 4/9/2026
 * fallaba con 42501 y se tragaba: `if (data) setProducts(...)` dejaba la lista
 * vacía, la sección ni se dibujaba y durante un mes no se registró una venta.
 * Por eso cada estado es explícito: cargando, error (con reintentar), vacío
 * (lista de verdad vacía) y listo.
 */
export type EstadoProductos =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | {
      tipo: 'listo'
      productos: ProductoParaCobro[]
      /** Se está pidiendo de nuevo (al reabrir o al reintentar): la lista sigue usable. */
      actualizando: boolean
      /** El último refresco falló: se sigue mostrando la lista anterior, y se dice. */
      errorAlActualizar: string | null
    }

interface Guardado {
  branchId: string
  estado: EstadoProductos
}

const MENSAJE_SIN_CONEXION = 'No pudimos cargar los productos de la sucursal.'

/**
 * `habilitado` = el diálogo está abierto. Cada apertura vuelve a pedir la lista
 * (precio y stock pueden haber cambiado), pero si ya había una de esta sucursal
 * se sigue mostrando mientras tanto: el barbero no ve un esqueleto cada vez que
 * abre el cobro.
 *
 * Una respuesta que llega tarde —el diálogo se cerró, cambió la sucursal o se
 * pidió de nuevo— se descarta: nunca pisa la lista vigente.
 */
export function useProductosDeSucursal(branchId: string | null | undefined, habilitado: boolean) {
  const [guardado, setGuardado] = useState<Guardado | null>(null)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    if (!habilitado || !branchId) return
    let vigente = true

    // Diferido: un setState síncrono en el cuerpo del efecto encadena renders
    // (react-hooks/set-state-in-effect). Mismo patrón que el resto del panel.
    queueMicrotask(() => {
      if (!vigente) return
      setGuardado((prev) =>
        prev && prev.branchId === branchId && prev.estado.tipo === 'listo'
          ? { branchId, estado: { ...prev.estado, actualizando: true } }
          : { branchId, estado: { tipo: 'cargando' } },
      )
    })

    const aplicar = (r: ResultadoProductosParaCobro) => {
      setGuardado((prev) => {
        if (r.ok) {
          return {
            branchId,
            estado: { tipo: 'listo', productos: r.productos, actualizando: false, errorAlActualizar: null },
          }
        }
        // Falló un refresco con una lista de esta sucursal en pantalla: se
        // conserva (el servidor igual revalida todo al cobrar) y se avisa.
        if (prev && prev.branchId === branchId && prev.estado.tipo === 'listo') {
          return { branchId, estado: { ...prev.estado, actualizando: false, errorAlActualizar: r.error } }
        }
        return { branchId, estado: { tipo: 'error', mensaje: r.error } }
      })
    }

    listarProductosParaCobro(branchId)
      .then((r) => {
        if (!vigente) return
        if (!r.ok) console.error('[useProductosDeSucursal]', r.error)
        aplicar(r)
      })
      .catch((e: unknown) => {
        // Un corte de red rechaza la promesa del server action: sin este catch
        // la sección se quedaba "cargando" para siempre.
        if (!vigente) return
        console.error('[useProductosDeSucursal]', e)
        aplicar({ ok: false, error: MENSAJE_SIN_CONEXION })
        // Deploy nuevo con el panel en el bundle anterior: «Reintentar» no
        // sirve (la acción ya no existe en el servidor) y tampoco se va a poder
        // cobrar ni vender. Se avisa y se recarga (src/lib/recarga-version.ts);
        // con el cobro abierto fallan varias cargas juntas y el id deja un aviso.
        if (esErrorDeVersion(e)) {
          if (!avisarYRecargarPorVersion()) toast.error(TEXTO_RECARGA_MANUAL, { id: 'recarga-manual' })
        }
      })

    return () => {
      vigente = false
    }
  }, [branchId, habilitado, intento])

  // Lo guardado para OTRA sucursal no se muestra nunca, ni por un render.
  const estado: EstadoProductos =
    guardado && branchId && guardado.branchId === branchId ? guardado.estado : { tipo: 'cargando' }

  return {
    estado,
    /** Los productos vigentes ([] mientras carga o si falló). */
    productos: estado.tipo === 'listo' ? estado.productos : [],
    reintentar: () => setIntento((n) => n + 1),
  }
}
