import { JuegoRaiz } from '@/components/juego/juego-raiz'
import { obtenerDatosEntradaJuego } from '@/lib/juego/servidor'
import type { DatosEntradaJuego } from '@/lib/juego/tipos'
import { leerPeleaDePrueba, leerQrDePrueba, type PeleaDePrueba } from '@/lib/juego/ui/prueba'
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
  // Atajos de pruebas, SÓLO en desarrollo (Next reemplaza NODE_ENV al compilar: en producción ni
  // se leen). ?prueba=<jugador>,<rival>[,<arena>[,<dificultad>]]: directo a una pelea contra la
  // CPU. ?qr=<barbero>[,<nombre>]: simula el QR de un cliente de ese barbero (ver prueba.ts).
  let prueba: PeleaDePrueba | null = null
  // Retratos y caras que todavía no están en public/ (sprites en proceso): silueta sin pedirlos.
  let faltantes: string[] = []
  if (process.env.NODE_ENV !== 'production') {
    prueba = leerPeleaDePrueba(parametro(sp.prueba))
    const qr = leerQrDePrueba(parametro(sp.qr))
    if (qr) datos = { ...datos, ...qr }
    const { recursosFaltantes } = await import('./recursos-faltantes')
    faltantes = recursosFaltantes()
  }
  return (
    <JuegoRaiz
      datos={datos}
      fuentes={{ titulo: fuenteTitulo.style.fontFamily, numeros: fuenteNumeros.style.fontFamily }}
      prueba={prueba}
      faltantes={faltantes}
    />
  )
}
