'use client'

// Una hoja abierta en el celular (Nuevo chat, Programar, las plantillas, la
// nueva difusión, una respuesta rápida, una automatización nueva,
// Configuración y cada una de sus pantallas, y los diálogos de turnos del
// chat) también es una entrada del historial, como las capas
// (historial-capas.ts): el «atrás» del sistema (el
// borde de la pantalla en el iPhone, el botón o el gesto de Android) la cierra
// a ella. Sin entrada, ese «atrás» cerraba la capa de abajo y dejaba la hoja
// abierta sobre la lista, o sacaba de Mensajería y se perdía lo cargado.
//
// Sin gesto propio (una hoja de iOS no se cierra deslizando desde el borde) y
// sin paralaje: la lista de abajo no se corre. Cerrarla por la interfaz
// («Cancelar», la X, «Listo», al guardar) saca su entrada, igual que una capa.
//
// En el iPhone el sistema ya mostró, mientras se deslizaba, la foto de la
// pantalla de abajo (sin la hoja): la hoja se va de una, sin su animación de
// salida, que si no la volvía a mostrar para bajarla. Lo mismo si el navegador
// avisa que ya animó su «atrás» (hasUAVisualTransition). Para eso, mientras se
// cierra, <html data-hoja-sin-salida> le saca la animación de salida al
// Dialog y a la Sheet (globals.css): Radix ve que no hay animación y la
// desmonta en el mismo commit.
//
// En la compu no hay entradas (como las capas).

import { useEffectEvent, useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { useEsCelular } from '@/hooks/use-es-celular'
import { abrirCapa, montarHistorial, sistemaConAtrasDeslizando } from './historial-capas'

const SIN_SALIDA = 'data-hoja-sin-salida'

/**
 * Mientras `abierta` (en el celular), la hoja es una entrada del historial y
 * el «atrás» del sistema la cierra con `cerrar`. `deUna`: se cierra sin
 * animar (el sistema ya animó), para quien tenga una animación propia que no
 * es la del Dialog o la Sheet. `nombre` es el de su marcador (#/hoja;
 * Configuración usa los suyos).
 */
export function useEntradaDeHoja(abierta: boolean, cerrar: (deUna: boolean) => void, nombre = 'hoja'): void {
  const esCelular = useEsCelular()
  const alCerrar = useEffectEvent(cerrar)

  // Que el historial escuche aunque no haya ninguna capa montada.
  useLayoutEffect(() => montarHistorial(), [])

  // De layout, como las capas: la entrada se empuja antes de que se pinte la
  // hoja, así la foto que guarda iOS de la entrada de abajo es la pantalla sin
  // ella.
  useLayoutEffect(() => {
    if (!abierta || !esCelular) return
    const registro = abrirCapa(
      nombre,
      (yaAnimado) => {
        if (!sistemaConAtrasDeslizando() && !yaAnimado) {
          alCerrar(false)
          return
        }
        const html = document.documentElement
        html.setAttribute(SIN_SALIDA, '')
        try {
          flushSync(() => alCerrar(true))
        } finally {
          html.removeAttribute(SIN_SALIDA)
        }
      },
      { mueveLista: false },
    )
    return () => registro.quitar()
  }, [abierta, esCelular, nombre])
}
