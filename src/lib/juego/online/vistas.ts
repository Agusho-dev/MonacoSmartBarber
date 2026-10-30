/**
 * Vistas de la partida «desde el lado del jugador», para las piezas que asumen que el
 * jugador es el lado 0 (el HUD) o que deciden quién es humano por `config.cpu` (el audio).
 *
 * El mundo NO se espeja: el lado 0 (el que desafió) pelea a la izquierda en los dos celulares
 * y el render dibuja la partida real. Estas vistas son objetos vivos (heredan de la partida
 * con Object.create y leen sus campos al momento), sin copiar nada por cuadro.
 *
 * Sin React ni `@/`.
 */
import type { EventoJuego, Lado, Partida } from '../tipos'

const otro = (l: Lado): Lado => (l === 0 ? 1 : 0)
const otroONulo = (l: Lado | null): Lado | null => (l === null ? null : otro(l))

/**
 * Para el HUD: la partida con los lados dados vuelta cuando el jugador es el lado 1 (el HUD
 * lee `luchadores[0]` como «yo»). Con el lado 0 devuelve la misma partida.
 */
export function vistaParaHud(p: Partida, lado: Lado): Partida {
  if (lado === 0) return p
  const v = Object.create(p) as Partida
  Object.defineProperties(v, {
    luchadores: { get: () => [p.luchadores[1], p.luchadores[0]] },
    rondasGanadas: { get: () => [p.rondasGanadas[1], p.rondasGanadas[0]] },
    estadisticas: { get: () => [p.estadisticas[1], p.estadisticas[0]] },
    ganadorRound: { get: () => otroONulo(p.ganadorRound) },
    ganadorPartida: { get: () => otroONulo(p.ganadorPartida) },
  })
  return v
}

function espejarEvento(e: EventoJuego): EventoJuego {
  switch (e.tipo) {
    case 'golpe':
      return { ...e, atacante: otro(e.atacante), victima: otro(e.victima) }
    case 'ko':
      return { ...e, ganador: otro(e.ganador), perdedor: otro(e.perdedor) }
    case 'tiempo':
    case 'fin_round':
      return { ...e, ganador: otroONulo(e.ganador) }
    case 'final_disponible':
    case 'final_al_cero':
    case 'fin_partida':
      return { ...e, ganador: otro(e.ganador) }
    default:
      return 'quien' in e ? ({ ...e, quien: otro(e.quien) } as EventoJuego) : e
  }
}

/** Los eventos del cuadro con los lados dados vuelta (para el HUD del lado 1). */
export function eventosParaHud(eventos: readonly EventoJuego[], lado: Lado): readonly EventoJuego[] {
  if (lado === 0 || eventos.length === 0) return eventos
  return eventos.map(espejarEvento)
}

/**
 * Para el audio: decide quién es «el humano» por `config.cpu` (jingle del round, el «ding» de
 * la carga y el «sin carga» sólo del jugador). Online los dos son humanos: se le dice que el
 * otro es la CPU para que suene como en este celular corresponde.
 */
export function vistaParaAudio(p: Partida, lado: Lado): Partida {
  const v = Object.create(p) as Partida
  const cpu: [boolean, boolean] = lado === 0 ? [false, true] : [true, false]
  Object.defineProperty(v, 'config', { value: { ...p.config, cpu }, enumerable: true })
  return v
}
