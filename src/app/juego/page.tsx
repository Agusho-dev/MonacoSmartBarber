import { JuegoRaiz } from '@/components/juego/juego-raiz'
import { obtenerDatosEntradaJuego } from '@/lib/juego/servidor'
import type { DatosEntradaJuego } from '@/lib/juego/tipos'
import { fuenteNumeros, fuenteTitulo } from './fuentes'

export const dynamic = 'force-dynamic'

const SIN_DATOS: DatosEntradaJuego = {
  token: null,
  sucursal: null,
  cliente: null,
  arenaInicial: 'rondeau',
  barberoAsignado: null,
}

/** ?t=<token del QR> y ?s=<slug de sucursal>: un valor, recortado, o nada. */
function parametro(valor: string | string[] | undefined): string | undefined {
  const v = Array.isArray(valor) ? valor[0] : valor
  if (typeof v !== 'string') return undefined
  const limpio = v.trim()
  return limpio && limpio.length <= 512 ? limpio : undefined
}

export default async function PaginaJuego({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  let datos: DatosEntradaJuego
  try {
    datos = await obtenerDatosEntradaJuego({ t: parametro(sp.t), s: parametro(sp.s) })
  } catch (error) {
    // Un QR vencido o la base lenta no pueden dejar a nadie sin jugar: entra sin turno.
    console.error('[juego] no se pudieron leer los datos de entrada', error)
    datos = SIN_DATOS
  }
  return (
    <JuegoRaiz
      datos={datos}
      fuentes={{ titulo: fuenteTitulo.style.fontFamily, numeros: fuenteNumeros.style.fontFamily }}
    />
  )
}
