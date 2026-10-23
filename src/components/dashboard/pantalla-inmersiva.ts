'use client'

// Una pantalla "inmersiva" en el celular: la página muestra una CAPA que tapa
// el shell entero, como las pantallas que iOS "empuja" desde la lista de chats
// de WhatsApp. La pide Mensajería con un chat, la info. del contacto, una
// sección (Difusiones, Workflows, Alertas, Casos, Respuestas rápidas) o
// Programados abiertos.
//
// El modelo de capas (23/oct/2026), contrato entre el shell y la página:
// - La capa es `fixed inset-0 z-[41]`: encima de la barra de vidrio (z-40) y
//   debajo del panel de Tex (z-45), de las hojas (z-50), del perfil (z-60) y de
//   los diálogos y menús (z-110). Entra desde la derecha y se vuelve deslizando
//   desde el borde izquierdo.
// - Debajo queda TODO montado y quieto: el encabezado del shell con sus
//   pestañas, la lista de chats y la barra. El shell NO pliega el encabezado ni
//   esconde la barra: los deja `inert` y con aria-hidden (sin toques, sin el
//   teclado, sin el lector de pantalla) y apaga el deslizar entre pestañas. Al
//   volver deslizando se ve la pantalla de verdad, no un hueco.
// - --alto-barra-inferior sigue valiendo la huella de la barra (la usa la
//   lista de abajo).
// - Ningún ancestro de la capa puede crear un bloque contenedor o un contexto
//   de apilamiento (transform, filter, contain, will-change, isolation…): la
//   atraparía debajo del encabezado y de la barra.
//
// Es un store externo y no un estado del shell porque la decide la página: el
// shell no ve el estado de Mensajería. Cada pedido es un token, y con dos
// pedidos a la vez la pantalla sigue inmersiva hasta que se van los dos.
//
// Sólo rige en el celular: quien la pide la pide sólo debajo de lg
// (useEsCelular), porque `inert` y el aria-hidden del encabezado no se pueden
// poner por media query. En la compu (lg+) nada de esto aplica.
//
// También marca <html data-pantalla-inmersiva>, para lo que se acomoda por CSS
// (los avisos de sonner, que viven fuera del shell: arriba del composer o del
// área segura, no arriba de la barra tapada).

import { useEffect, useId, useSyncExternalStore } from 'react'

const pedidos = new Set<string>()
const oyentes = new Set<() => void>()

function avisar() {
  document.documentElement.toggleAttribute('data-pantalla-inmersiva', pedidos.size > 0)
  for (const oyente of oyentes) oyente()
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

const leer = () => pedidos.size > 0
// El servidor y la hidratación dibujan el shell normal; el pedido llega después.
const leerEnServidor = () => false

/** El shell: ¿alguna página pidió la pantalla entera en el celular? */
export function useHayPantallaInmersiva(): boolean {
  return useSyncExternalStore(suscribir, leer, leerEnServidor)
}

/** La página: mientras `activa` sea true y esté montada, pide la pantalla entera en el celular. */
export function usePantallaInmersiva(activa: boolean): void {
  const id = useId()
  useEffect(() => {
    if (!activa) return
    pedidos.add(id)
    avisar()
    return () => {
      pedidos.delete(id)
      avisar()
    }
  }, [activa, id])
}
