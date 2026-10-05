'use client'

import { useEffect } from 'react'

/**
 * Contrato con la recarga por versión (`src/lib/recarga-version.ts`): después
 * de un deploy, el kiosko se recarga solo ÚNICAMENTE si
 * `<html data-kiosko-en-reposo="true">`. Sin la marca nunca se recarga solo, y
 * con la marca puesta de más se recargaría con un cliente a mitad del check-in.
 *
 * Cada pantalla raíz del kiosko (`CheckinWalkIn`, `TurnosCheckinFlow`) declara
 * cuándo está en reposo: su pantalla inicial, sin nada en vuelo. La marca se
 * saca apenas deja de estarlo (el cliente tocó «Sí», empezó a tipear, se está
 * mandando algo) y al desmontar. El motor igual exige un minuto sin toques,
 * ningún diálogo abierto y red.
 *
 * Cuenta pedidos en vez de escribir el atributo a ciegas: si algún día dos
 * pantallas lo pidieran a la vez, la que se desmonta no le borra la marca a la
 * que sigue en reposo.
 */

let pedidosDeReposo = 0

function aplicarMarca() {
  const raiz = document.documentElement
  if (pedidosDeReposo > 0) raiz.dataset.kioskoEnReposo = 'true'
  else delete raiz.dataset.kioskoEnReposo
}

export function useKioskoEnReposo(enReposo: boolean) {
  useEffect(() => {
    if (!enReposo) return
    pedidosDeReposo += 1
    aplicarMarca()
    return () => {
      pedidosDeReposo = Math.max(0, pedidosDeReposo - 1)
      aplicarMarca()
    }
  }, [enReposo])
}
