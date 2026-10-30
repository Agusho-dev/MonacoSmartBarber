/**
 * Textos de la sala y de las peleas online. Todo en español rioplatense.
 */
import type { EstadoDuelo, ResultadoDuelo } from './duelo'
import type { EstadoJugador } from './protocolo'
import type { EstadoSaliente, JugadorSala } from './sala'

export function textoEstadoJugador(j: JugadorSala): string {
  if (!j.compatible) return 'Con otra versión'
  const t: Record<EstadoJugador, string> = {
    libre: 'Libre para pelear',
    eligiendo: 'Eligiendo barbero',
    peleando: 'Peleando',
  }
  return t[j.estado]
}

/** Lo que pasó con el desafío que mandé (null mientras espera). Va en la fila del jugador: sin repetir el nombre. */
export function textoSaliente(estado: EstadoSaliente, nombre: string): string | null {
  switch (estado) {
    case 'esperando':
      return null
    case 'no':
      return 'Dijo que ahora no'
    case 'ocupado':
      return 'Está ocupado'
    case 'version':
      return `Actualizá la página para pelear con ${nombre}`
    case 'vencido':
      return 'No respondió'
    case 'se_fue':
      return 'Se fue de la sala'
  }
}

/** Para el aviso cuando el duelo se corta antes o fuera de una pelea. null = sin aviso. */
export function textoCierre(e: EstadoDuelo): string | null {
  const n = e.rival.nombre
  switch (e.cierre) {
    case 'rival_turno':
      return `${n} fue llamado a cortarse`
    case 'rival_salio':
      return `${n} volvió a la sala`
    case 'rival_cerro':
      return `${n} cerró el juego`
    case 'sin_conexion':
      return `Se cortó la conexión con ${n}`
    case 'version':
      return `Actualizá la página para pelear con ${n}`
    case 'error':
      return `No se pudo armar la pelea con ${n}`
    default:
      return null
  }
}

export function tituloResultado(r: ResultadoDuelo, rival: string): string {
  if (r.ganador === null) return 'Pelea anulada'
  if (r.ganador === 'yo') {
    if (r.motivo === 'pelea') return `¡Le ganaste a ${rival}!`
    return '¡Ganaste por abandono!'
  }
  if (r.motivo === 'abandone' || r.motivo === 'ausente') return `${rival} ganó por abandono`
  return `${rival} te ganó`
}

export function bajadaResultado(r: ResultadoDuelo, rival: string, seFue: EstadoDuelo['rivalSeFue'] = null): string | null {
  switch (r.motivo) {
    case 'turno_rival':
      return `${rival} fue llamado a cortarse`
    case 'abandono_rival':
      if (seFue === 'abandono') return `${rival} abandonó la pelea`
      if (seFue === 'cerro') return `${rival} cerró el juego`
      if (seFue === 'salir') return `${rival} se fue de la pelea`
      return `${rival} se quedó sin conexión`
    case 'abandone':
      return 'Te desconectaste en el medio de la pelea'
    case 'ausente':
      return 'Te fuiste del juego más de 10 segundos'
    case 'desync':
      return 'Los dos celulares dejaron de ver la misma pelea. No cuenta para nadie.'
    case 'corte':
      return 'Se cortó la conexión de los dos. No cuenta para nadie.'
    default:
      return null
  }
}
