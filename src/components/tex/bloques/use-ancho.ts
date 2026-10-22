'use client'

// Las medidas reales del lugar donde se dibuja un gráfico. Se mide el
// contenedor y no la ventana: el mismo bloque vive en el hilo (720 px), en el
// panel lateral (420 px) y en el Lienzo (520 px), y lo que cambia el dibujo
// (torta → barras, cuántas etiquetas entran) depende del lugar, no del monitor.
// El alto lo fija el CSS (container queries), así la primera pintada ya ocupa
// lo que va a ocupar: nada salta cuando llega la medida.
//
// Callback ref con limpieza (React 19): el ResizeObserver nace y muere con el
// nodo. Antes de la primera medida devuelve null y el gráfico deja su lugar
// vacío del alto justo.

import { useCallback, useState } from 'react'

export interface Medidas {
  ancho: number
  alto: number
}

export function useMedidas<T extends HTMLElement>(): [(nodo: T | null) => (() => void) | void, Medidas | null] {
  const [medidas, setMedidas] = useState<Medidas | null>(null)
  const ref = useCallback((nodo: T | null) => {
    if (!nodo || typeof ResizeObserver === 'undefined') return
    const observador = new ResizeObserver((entradas) => {
      const caja = entradas[0]?.contentRect
      if (!caja || caja.width <= 0 || caja.height <= 0) return
      // Redondeado: los subpíxeles de un scroll no tienen que volver a dibujar.
      const ancho = Math.round(caja.width)
      const alto = Math.round(caja.height)
      setMedidas((previas) => (previas && previas.ancho === ancho && previas.alto === alto ? previas : { ancho, alto }))
    })
    observador.observe(nodo)
    return () => observador.disconnect()
  }, [])
  return [ref, medidas]
}
