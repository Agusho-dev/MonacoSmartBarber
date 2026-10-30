/**
 * HUD de la pelea, actualizado imperativamente una vez por cuadro (nada de setState).
 *
 * React dibuja la estructura (hud-pelea.tsx y controles-pelea.tsx) con atributos
 * `data-hud`; esto los busca una vez y en cada cuadro escribe sólo lo que cambió:
 * transform de las barras, el número del reloj, atributos para el CSS. Los efectos
 * de una sola vez (sacudir una carta, destellar un segmento) van con Web Animations.
 */
import { PERSONAJES } from '../personajes'
import { CARGA_MAX, TPS } from '../tipos'
import type { EventoJuego, FuerzaGolpe, IdPersonaje, LuchadorEstado, Partida } from '../tipos'
import type { CapturaEntrada } from './entrada'
import { vibrar } from './vibrar'

export interface ControlHud {
  actualizar(p: Partida, eventos: readonly EventoJuego[], dtMs: number): void
}

export interface OpcionesHud {
  entrada: CapturaEntrada
  /** Costo de los dos especiales del jugador (para llenar las cartas). */
  costos: [number, number]
  /** Rutas que se sabe que no existen (desarrollo): la cara pelada que falta ni se pide. */
  faltantes?: ReadonlySet<string>
}

/** Cuánto espera el «chip» blanco antes de bajar (ms) y a qué velocidad baja (fracción/ms). */
const CHIP_ESPERA = 560
const CHIP_VELOCIDAD = 0.00075

const VIBRACION_GOLPE: Record<FuerzaGolpe, number> = { leve: 14, medio: 22, fuerte: 34, especial: 48 }

const q = (v: number) => Math.round(v * 1000) / 1000

/** Los íconos de estado del HUD (estados-hud.tsx los dibuja con `data-hud="estado-<lado>-<estado>"`). */
export const ESTADOS_HUD = [
  'congelado',
  'electrocutado',
  'guardia-rota',
  'aturdido',
  'mareado',
  'quemado',
  'lento',
  'curando',
] as const
export type EstadoHud = (typeof ESTADOS_HUD)[number]

/** ¿Ese estado está encendido? (los efectos nuevos con `?? 0`: una partida vieja no los trae). */
function estadoActivo(L: LuchadorEstado, e: EstadoHud): boolean {
  const ef = L.efectos
  switch (e) {
    case 'congelado':
      return ef.congelado > 0 || L.estado === 'congelado'
    case 'electrocutado':
      return ef.electrocutado > 0 || L.estado === 'electrocutado'
    case 'guardia-rota':
      return ef.guardiaRota > 0 || L.estado === 'guardia_rota'
    case 'aturdido':
      return (ef.aturdido ?? 0) > 0
    case 'mareado':
      return (ef.mareado ?? 0) > 0
    case 'quemado':
      return (ef.quemado ?? 0) > 0
    case 'lento':
      return (ef.lento ?? 0) > 0
    case 'curando':
      return (ef.curando ?? 0) > 0
  }
}

export function crearHud(raiz: HTMLElement, op: OpcionesHud): ControlHud {
  const uno = (sel: string) => raiz.querySelector<HTMLElement>(sel)
  const todos = (sel: string) => Array.from(raiz.querySelectorAll<HTMLElement>(sel))

  const lados = ([0, 1] as const).map((l) => ({
    barra: uno(`[data-hud="barra-vida-${l}"]`),
    vida: uno(`[data-hud="vida-${l}"]`),
    chip: uno(`[data-hud="chip-${l}"]`),
    guardia: uno(`[data-hud="guardia-${l}"]`),
    barraGuardia: uno(`[data-hud="barra-guardia-${l}"]`),
    rondas: todos(`[data-hud="ronda-${l}"]`),
    estados: ESTADOS_HUD.map((e) => uno(`[data-hud="estado-${l}-${e}"]`)),
    cara: uno(`[data-hud="cara-${l}"]`),
  }))
  const reloj = uno('[data-hud="reloj"]')
  const marcoReloj = uno('[data-hud="marco-reloj"]')
  const turbo = uno('[data-hud="turbo"]')
  const segmentos = todos('[data-hud="carga-seg"]').map((seg) => ({
    relleno: seg.querySelector<HTMLElement>('[data-parte="relleno"]'),
    destello: seg.querySelector<HTMLElement>('[data-parte="destello"]'),
  }))
  const cargaNum = uno('[data-hud="carga-num"]')
  const cargaRival = uno('[data-hud="carga-rival"]')
  const cargaRivalNum = uno('[data-hud="carga-rival-num"]')
  const cartas = [uno('[data-carta="1"]'), uno('[data-carta="2"]')]
  const llenados = [uno('[data-hud="carta-llenado-1"]'), uno('[data-hud="carta-llenado-2"]')]

  const ult = {
    vida: [-1, -1],
    chip: [-1, -1],
    guardia: [-1, -1],
    nivel: ['', ''],
    guardiaBaja: [false, false],
    rondas: [-1, -1],
    estados: [ESTADOS_HUD.map(() => false), ESTADOS_HUD.map(() => false)],
    reloj: '',
    urgente: false,
    turbo: false,
    final: false,
    segs: segmentos.map(() => -1),
    cargaNum: -1,
    cargaRival: -1,
    cargaRivalNum: -1,
    llenado: [-1, -1],
    lista: [false, false],
  }
  const chip = [1, 1]
  const esperaChip = [0, 0]
  let ganadorFinal: 0 | 1 | null = null

  const atributo = (el: HTMLElement | null, nombre: string, valor: boolean) => {
    if (!el) return
    if (valor) el.setAttribute(nombre, '')
    else el.removeAttribute(nombre)
  }
  const escalaX = (el: HTMLElement | null, v: number) => {
    if (el) el.style.transform = `scaleX(${v})`
  }

  const animar = (el: HTMLElement | null | undefined, cuadros: Keyframe[], ms: number) => {
    if (!el || typeof el.animate !== 'function') return
    try {
      el.animate(cuadros, { duration: ms, easing: 'cubic-bezier(.2,.8,.3,1)' })
    } catch {
      // Navegador viejo sin Web Animations: el efecto es decorativo.
    }
  }

  const sacudirCarta = (n: 1 | 2 | null) => {
    const indices = n ? [n - 1] : [0, 1].filter((i) => !ult.lista[i])
    for (const i of indices) {
      animar(
        cartas[i],
        [
          { transform: 'translateX(0) rotate(0)' },
          { transform: 'translateX(-8px) rotate(-4deg)' },
          { transform: 'translateX(7px) rotate(3deg)' },
          { transform: 'translateX(-5px) rotate(-2deg)' },
          { transform: 'translateX(3px) rotate(1deg)' },
          { transform: 'translateX(0) rotate(0)' },
        ],
        380,
      )
    }
  }

  /** ¡AL CERO!: la cara del HUD del que lo recibió pasa a la pelada (si el barbero la tiene). */
  const raparCara = (lado: 0 | 1, id: IdPersonaje) => {
    const img = lados[lado].cara?.querySelector('img')
    const rapada = PERSONAJES[id]?.rutas.rapado?.cara
    if (!img || !rapada) return
    if (op.faltantes?.has(rapada)) return
    const nueva = new Image()
    nueva.onload = () => {
      img.src = nueva.src
    }
    nueva.src = rapada
  }

  const destellarSegmento = (indice: number) => {
    const s = segmentos[Math.max(0, Math.min(segmentos.length - 1, indice))]
    animar(s?.destello, [{ opacity: 0.95 }, { opacity: 0 }], 520)
    animar(cargaNum, [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], 380)
  }

  const procesarEventos = (eventos: readonly EventoJuego[], p: Partida) => {
    for (const e of eventos) {
      switch (e.tipo) {
        case 'carga':
          if (e.quien === 0) destellarSegmento(e.nivel - 1)
          break
        case 'sin_carga':
          if (e.quien === 0) {
            sacudirCarta(op.entrada.ultimoEspecial())
            vibrar([12, 40, 12])
          }
          break
        case 'golpe':
          if (e.victima === 0) {
            vibrar(e.bloqueado ? 8 : VIBRACION_GOLPE[e.fuerza] + (e.critico ? 16 : 0))
            animar(lados[0].cara, [{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], 200)
          } else if (e.atacante === 0 && e.critico) {
            vibrar(16)
          }
          if (e.victima === 1 && !e.bloqueado) {
            animar(lados[1].cara, [{ transform: 'translateX(3px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], 200)
          }
          break
        case 'guardia_rota':
          if (e.quien === 0) vibrar([30, 40, 30])
          animar(lados[e.quien].barraGuardia, [{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], 600)
          break
        case 'especial':
          if (e.quien === 0) vibrar(22)
          break
        case 'ko':
          vibrar(e.perdedor === 0 ? [60, 50, 110] : 50)
          break
        case 'turbo':
          // `scale` (no `transform`): el CSS ya usa transform para centrar la cinta.
          animar(turbo, [{ scale: '1.7', opacity: 0 }, { scale: '1', opacity: 1 }], 480)
          break
        case 'final_disponible':
          ganadorFinal = e.ganador
          break
        case 'final_al_cero': {
          if (e.ganador === 0) vibrar([40, 30, 90])
          ganadorFinal = null
          const perdedor = e.ganador === 0 ? 1 : 0
          raparCara(perdedor, p.luchadores[perdedor].id)
          break
        }
        case 'fin_partida':
          ganadorFinal = null
          break
        default:
          break
      }
    }
  }

  return {
    actualizar(p, eventos, dtMs) {
      if (eventos.length > 0) procesarEventos(eventos, p)

      for (const l of [0, 1] as const) {
        const L = p.luchadores[l]
        const el = lados[l]
        const vidaMax = L.vidaMax > 0 ? L.vidaMax : 1
        const vida = q(Math.max(0, Math.min(1, L.vida / vidaMax)))

        // Chip blanco que baja tarde: espera mientras sigue el combo y después alcanza.
        if (vida < ult.vida[l] && ult.vida[l] >= 0) esperaChip[l] = CHIP_ESPERA
        if (vida >= chip[l]) {
          chip[l] = vida
          esperaChip[l] = 0
        } else if (esperaChip[l] > 0) {
          esperaChip[l] -= dtMs
        } else {
          const distancia = chip[l] - vida
          chip[l] = Math.max(vida, chip[l] - dtMs * CHIP_VELOCIDAD * (1 + distancia * 4))
        }

        if (vida !== ult.vida[l]) {
          ult.vida[l] = vida
          escalaX(el.vida, vida)
        }
        const c = q(chip[l])
        if (c !== ult.chip[l]) {
          ult.chip[l] = c
          escalaX(el.chip, c)
        }
        const nivel = vida <= 0.25 ? 'baja' : vida <= 0.5 ? 'media' : 'alta'
        if (nivel !== ult.nivel[l]) {
          ult.nivel[l] = nivel
          if (el.barra) el.barra.dataset.nivel = nivel
        }

        const gMax = L.guardiaMax > 0 ? L.guardiaMax : 1
        const g = q(Math.max(0, Math.min(1, L.guardia / gMax)))
        if (g !== ult.guardia[l]) {
          ult.guardia[l] = g
          escalaX(el.guardia, g)
        }
        const gBaja = g < 0.3
        if (gBaja !== ult.guardiaBaja[l]) {
          ult.guardiaBaja[l] = gBaja
          atributo(el.barraGuardia, 'data-baja', gBaja)
        }

        const rondas = p.rondasGanadas[l]
        if (rondas !== ult.rondas[l]) {
          ult.rondas[l] = rondas
          el.rondas.forEach((r, i) => atributo(r, 'data-ganada', i < rondas))
        }

        for (let i = 0; i < ESTADOS_HUD.length; i++) {
          const on = estadoActivo(L, ESTADOS_HUD[i])
          if (on !== ult.estados[l][i]) {
            ult.estados[l][i] = on
            atributo(el.estados[i], 'data-on', on)
          }
        }
      }

      // Reloj (segundos enteros que quedan) y urgencia en los últimos 10.
      const segundos = Math.max(0, Math.ceil(p.tiempoRestante / TPS))
      const textoReloj = String(Math.min(99, segundos))
      if (textoReloj !== ult.reloj) {
        ult.reloj = textoReloj
        if (reloj) reloj.textContent = textoReloj
      }
      const urgente = p.fase === 'pelea' && segundos <= 10
      if (urgente !== ult.urgente) {
        ult.urgente = urgente
        atributo(marcoReloj, 'data-urgente', urgente)
      }

      if (p.turbo !== ult.turbo) {
        ult.turbo = p.turbo
        atributo(raiz, 'data-turbo', p.turbo)
      }

      const final = p.fase === 'final' && ganadorFinal === 0
      if (final !== ult.final) {
        ult.final = final
        atributo(raiz, 'data-final', final)
      }

      // Carga de la máquina del jugador: 10 segmentos, el último a medio llenar.
      const carga = Math.max(0, Math.min(CARGA_MAX, p.luchadores[0].carga))
      for (let i = 0; i < segmentos.length; i++) {
        const v = q(Math.max(0, Math.min(1, carga - i)))
        if (v !== ult.segs[i]) {
          ult.segs[i] = v
          const s = segmentos[i]
          if (s.relleno) {
            s.relleno.style.transform = `scaleX(${v})`
            if (v >= 1) s.relleno.setAttribute('data-lleno', '')
            else s.relleno.removeAttribute('data-lleno')
          }
        }
      }
      const entero = Math.floor(carga + 1e-6)
      if (entero !== ult.cargaNum) {
        ult.cargaNum = entero
        if (cargaNum) cargaNum.textContent = String(entero)
      }

      for (const i of [0, 1] as const) {
        const costo = op.costos[i] > 0 ? op.costos[i] : 1
        const llenado = q(Math.min(1, carga / costo))
        if (llenado !== ult.llenado[i]) {
          ult.llenado[i] = llenado
          const ll = llenados[i]
          if (ll) ll.style.transform = `scaleY(${llenado})`
        }
        const lista = carga + 1e-6 >= costo
        if (lista !== ult.lista[i]) {
          ult.lista[i] = lista
          atributo(cartas[i], 'data-lista', lista)
          if (lista) animar(cartas[i], [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], 360)
        }
      }

      const cr = Math.max(0, Math.min(CARGA_MAX, p.luchadores[1].carga))
      const crq = q(cr / CARGA_MAX)
      if (crq !== ult.cargaRival) {
        ult.cargaRival = crq
        escalaX(cargaRival, crq)
      }
      const crEntero = Math.floor(cr + 1e-6)
      if (crEntero !== ult.cargaRivalNum) {
        ult.cargaRivalNum = crEntero
        if (cargaRivalNum) cargaRivalNum.textContent = String(crEntero)
      }
    },
  }
}
