import 'server-only'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { IDS_PERSONAJES, PERSONAJES } from '@/lib/juego/personajes'

/**
 * SÓLO EN DESARROLLO (page.tsx lo importa dentro de un `NODE_ENV !== 'production'`, así que en
 * producción ni se compila ni se rastrea `public/`): qué retratos y caras del catálogo todavía
 * no existen en `public/`. Mientras los agentes de sprites trabajan en paralelo, la UI dibuja
 * la silueta de reserva sin pedir el archivo (cada pedido fallido era un error 404 en la
 * consola). En producción se asume que están todos; si faltara uno, `ImagenJuego` cae igual en
 * la silueta.
 */
export function recursosFaltantes(): string[] {
  try {
    const base = path.join(process.cwd(), 'public')
    if (!existsSync(path.join(base, 'juego', 'personajes'))) return []
    const faltan: string[] = []
    for (const id of IDS_PERSONAJES) {
      const r = PERSONAJES[id].rutas
      // Los pelados sólo si la ficha dice que existen (sin `rapado` nadie los pide).
      const rutas = [r.retrato, r.cara, ...(r.rapado ? [r.rapado.retrato, r.rapado.cara] : [])]
      for (const url of rutas) {
        if (url.startsWith('/') && !existsSync(path.join(base, url))) faltan.push(url)
      }
    }
    return faltan
  } catch {
    return []
  }
}
