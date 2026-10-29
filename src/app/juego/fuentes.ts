import { Anton, Teko } from 'next/font/google'

/**
 * Fuentes de «Corte Final». Las usa el layout (variables CSS) y la página se las pasa
 * al render del canvas como font-family (OpcionesRender.fuentes).
 *  - Anton: display condensada y pesada para títulos («VICTORIA», «K.O.», el logo).
 *  - Teko: condensada de números y rótulos (reloj, puntajes, botones).
 */
export const fuenteTitulo = Anton({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--cf-fuente-titulo',
})

export const fuenteNumeros = Teko({
  subsets: ['latin'],
  display: 'swap',
  variable: '--cf-fuente-numeros',
})
