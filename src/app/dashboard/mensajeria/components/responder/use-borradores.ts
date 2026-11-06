'use client'

// Los borradores de Tex de la bandeja (6/nov/2026): uno por conversación, en
// memoria mientras dura la pantalla (son datos de clientes: nada en
// localStorage). La ruta (api/mensajeria/borrador) contesta texto plano en
// streaming y acá se va pintando a medida que llega, a lo sumo una vez por
// cuadro.
//
// Si Tex no está disponible (sin clave, sin plan con IA), se apaga para toda la
// pantalla y las tarjetas quedan para escribir a mano.

import { useCallback, useEffect, useRef, useState } from 'react'
import { limpiarBorrador, type AjusteBorrador } from '@/lib/mensajeria/borrador-prompt'

export type EstadoBorrador = 'escribiendo' | 'listo' | 'error' | 'cierre'

export interface Borrador {
  estado: EstadoBorrador
  texto: string
  /** El texto lo escribió o lo corrigió una persona: Tex no lo pisa solo. */
  editado: boolean
  error?: string
}

export type DisponibilidadTex = 'si' | 'sin_clave' | 'bloqueado'

export function useBorradores() {
  const [borradores, setBorradores] = useState<Record<string, Borrador>>({})
  const [disponible, setDisponible] = useState<DisponibilidadTex>('si')
  const controladores = useRef(new Map<string, AbortController>())
  const disponibleRef = useRef<DisponibilidadTex>('si')
  const borradoresRef = useRef(borradores)
  useEffect(() => {
    borradoresRef.current = borradores
  }, [borradores])

  const poner = useCallback((id: string, b: Borrador | ((prev: Borrador | undefined) => Borrador)) => {
    setBorradores((prev) => ({ ...prev, [id]: typeof b === 'function' ? b(prev[id]) : b }))
  }, [])

  const pedir = useCallback(
    async (id: string, opciones: { ajuste?: AjusteBorrador; forzar?: boolean } = {}) => {
      if (disponibleRef.current !== 'si') return
      controladores.current.get(id)?.abort()
      const control = new AbortController()
      controladores.current.set(id, control)
      const anterior = borradoresRef.current[id]?.texto ?? ''
      poner(id, { estado: 'escribiendo', texto: '', editado: false })

      let acumulado = ''
      let cuadro = 0
      const pintar = () => {
        cuadro = 0
        poner(id, { estado: 'escribiendo', texto: acumulado, editado: false })
      }
      try {
        const res = await fetch('/api/mensajeria/borrador', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: id,
            ajuste: opciones.ajuste ?? null,
            anterior: opciones.ajuste ? anterior : null,
            forzar: opciones.forzar ?? false,
          }),
          signal: control.signal,
        })
        if (!res.ok || !res.body) {
          const cuerpo = (await res.json().catch(() => null)) as { codigo?: string; mensaje?: string } | null
          if (cuerpo?.codigo === 'sin_clave' || cuerpo?.codigo === 'bloqueado') {
            disponibleRef.current = cuerpo.codigo
            setDisponible(cuerpo.codigo)
          }
          if (cuerpo?.codigo === 'cierre') {
            poner(id, { estado: 'cierre', texto: '', editado: false })
            return
          }
          poner(id, { estado: 'error', texto: anterior, editado: false, error: cuerpo?.mensaje ?? 'Tex no pudo escribir el borrador.' })
          return
        }
        const lector = res.body.getReader()
        const decodificar = new TextDecoder()
        for (;;) {
          const { value, done } = await lector.read()
          if (done) break
          acumulado += decodificar.decode(value, { stream: true })
          if (!cuadro) cuadro = window.requestAnimationFrame(pintar)
        }
        acumulado += decodificar.decode()
        if (cuadro) window.cancelAnimationFrame(cuadro)
        const final = limpiarBorrador(acumulado)
        poner(id, final
          ? { estado: 'listo', texto: final, editado: false }
          : { estado: 'error', texto: anterior, editado: false, error: 'Tex no escribió nada. Probá otra versión.' })
      } catch (err) {
        if (cuadro) window.cancelAnimationFrame(cuadro)
        if (control.signal.aborted) return
        const parcial = limpiarBorrador(acumulado)
        poner(id, parcial
          ? { estado: 'listo', texto: parcial, editado: false, error: 'Tex se cortó a la mitad: revisalo antes de mandarlo.' }
          : { estado: 'error', texto: anterior, editado: false, error: err instanceof Error && err.name === 'TypeError' ? 'Sin conexión: no se pudo pedir el borrador.' : 'Tex no pudo escribir el borrador.' })
      } finally {
        if (controladores.current.get(id) === control) controladores.current.delete(id)
      }
    },
    [poner],
  )

  /** Lo pide si todavía no hay nada para esa conversación. */
  const asegurar = useCallback(
    (id: string) => {
      if (disponibleRef.current !== 'si') return
      if (borradoresRef.current[id] || controladores.current.has(id)) return
      void pedir(id)
    },
    [pedir],
  )

  /** Lo que escribió la persona: Tex ya no lo cambia solo. */
  const escribir = useCallback(
    (id: string, texto: string) => {
      controladores.current.get(id)?.abort()
      controladores.current.delete(id)
      poner(id, { estado: 'listo', texto, editado: true })
    },
    [poner],
  )

  // Al salir de la pantalla se cortan los pedidos en curso.
  useEffect(() => {
    const mapa = controladores.current
    return () => {
      for (const c of mapa.values()) c.abort()
      mapa.clear()
    }
  }, [])

  return { borradores, disponible, pedir, asegurar, escribir }
}
