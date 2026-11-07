'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fichasDeLaFila } from '@/lib/actions/ficha-asesoria'
import { fichaVacia, titularDeFicha, type CampoFicha } from '@/lib/asesoria/ficha'
import {
  cambiarCampoFicha,
  cargarFichaAsesoria,
  guardarFichaYa,
  useFichaAsesoriaStore,
} from '@/stores/ficha-asesoria-store'

/**
 * La ficha de asesoría de un cliente (mig 238) desde el store compartido del
 * panel. `entradaId` es la entrada de la fila desde la que se mira: sin ella
 * se puede ver pero no editar (el servidor guarda cada visita con su entrada).
 * `activo` = false no pide nada (una hoja cerrada).
 */
export function useFichaAsesoria(
  clienteId: string | null | undefined,
  entradaId: string | null | undefined,
  activo = true,
) {
  const ficha = useFichaAsesoriaStore((s) => (clienteId ? s.fichas[clienteId] : undefined))

  useEffect(() => {
    if (!activo || !clienteId) return
    void cargarFichaAsesoria(clienteId, entradaId ?? null)
  }, [activo, clienteId, entradaId])

  const cambiar = useCallback(
    (campo: CampoFicha, valor: unknown) => {
      if (!clienteId || !entradaId) return
      cambiarCampoFicha(clienteId, entradaId, campo, valor)
    },
    [clienteId, entradaId],
  )

  const carga = ficha?.carga.tipo
  const reintentar = useCallback(() => {
    if (!clienteId) return
    if (carga === 'error') void cargarFichaAsesoria(clienteId, entradaId ?? null, { forzar: true })
    else guardarFichaYa(clienteId)
  }, [clienteId, entradaId, carga])

  return { ficha, cambiar, reintentar, editable: !!clienteId && !!entradaId }
}

/** Cuánto se espera a que la fila se quede quieta antes de preguntar por las fichas. */
const RESPIRO_FILA_MS = 700

/** Lo que la fila necesita de una ficha: que exista y su receta en un renglón. */
export interface FichaEnFila {
  titular: string | null
}

/**
 * Qué clientes de la fila tienen ficha de asesoría (para el sello «Ficha» y la
 * receta del que sigue). Se pregunta UNA vez por cada conjunto de clientes, no
 * en cada evento de Realtime, y lo que el panel ya tiene cargado (la ficha que
 * se acaba de completar) manda sobre lo que contestó el servidor.
 *
 * Del store se lee sólo una firma de texto (quién tiene ficha y su titular): la
 * fila entera no se vuelve a dibujar con cada tecla que se escribe en la hoja.
 *
 * Es una pista: si la pregunta falla, la fila se ve sin sellos (y queda en la
 * consola); la ficha del que está en la silla se pide aparte, con sus errores
 * a la vista.
 */
export function useFichasDeLaFila(branchId: string, clienteIds: readonly string[]): Record<string, FichaEnFila> {
  const clave = useMemo(() => [...new Set(clienteIds)].sort().join(','), [clienteIds])
  const [remotas, setRemotas] = useState<Record<string, FichaEnFila>>({})

  useEffect(() => {
    if (!clave) return
    let vivo = true
    const temporizador = setTimeout(() => {
      fichasDeLaFila(branchId, clave.split(','))
        .then((r) => {
          if (!vivo) return
          if (!r.ok) {
            console.error('[useFichasDeLaFila]', r.error)
            return
          }
          const fichas: Record<string, FichaEnFila> = {}
          for (const [id, f] of Object.entries(r.fichas)) fichas[id] = { titular: titularDeFicha(f.datos) }
          setRemotas(fichas)
        })
        .catch((e: unknown) => console.error('[useFichasDeLaFila]', e))
    }, RESPIRO_FILA_MS)
    return () => {
      vivo = false
      clearTimeout(temporizador)
    }
  }, [branchId, clave])

  // «id=titular» por cliente con la ficha ya cargada en el panel; «id=» si la
  // tiene vacía. Un string: cambia sólo si cambia algo que la fila muestra.
  const firmaLocal = useFichaAsesoriaStore((s) => {
    if (!clave) return ''
    const partes: string[] = []
    for (const id of clave.split(',')) {
      const f = s.fichas[id]
      if (!f || f.carga.tipo !== 'lista') continue
      partes.push(`${id}=${fichaVacia(f.datos) ? '' : `+${titularDeFicha(f.datos) ?? ''}`}`)
    }
    return partes.join('\n')
  })

  return useMemo(() => {
    const locales = new Map<string, FichaEnFila | null>()
    for (const parte of firmaLocal ? firmaLocal.split('\n') : []) {
      const i = parte.indexOf('=')
      const id = parte.slice(0, i)
      const resto = parte.slice(i + 1)
      locales.set(id, resto.startsWith('+') ? { titular: resto.slice(1) || null } : null)
    }
    const salida: Record<string, FichaEnFila> = {}
    for (const id of clave ? clave.split(',') : []) {
      if (locales.has(id)) {
        const local = locales.get(id)
        if (local) salida[id] = local
      } else if (remotas[id]) {
        salida[id] = remotas[id]
      }
    }
    return salida
  }, [clave, firmaLocal, remotas])
}
