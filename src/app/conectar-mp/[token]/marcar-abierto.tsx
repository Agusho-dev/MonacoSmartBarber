'use client'

// Avisa que el titular abrió el link: corre en el navegador, después de
// hidratar. La vista previa que arma WhatsApp al pegar el link (o un escáner de
// enlaces) pide la página pero no corre JavaScript, así que no lo marca: el
// dueño ve "Link abierto" sólo si lo abrió una persona. No dibuja nada.

import { useEffect } from 'react'
import { marcarLinkAbierto } from './acciones'

export function MarcarAbierto({ token }: { token: string }) {
  useEffect(() => {
    // Una vez por carga. Si falla no pasa nada: el link queda como "enviado".
    marcarLinkAbierto(token).catch(() => {})
  }, [token])
  return null
}
