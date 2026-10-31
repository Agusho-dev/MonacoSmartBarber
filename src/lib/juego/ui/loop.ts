/**
 * El loop de la pelea (requestAnimationFrame) con paso fijo.
 *
 *  - Acumulador de 1000/TPS ms escalado por `p.escalaTiempo` (cámara lenta del K.O.):
 *    el motor siempre avanza de a un tick, el tiempo de pantalla decide cuántos.
 *  - Máximo 5 pasos por cuadro: si el celular se trabó, se descarta el atraso en vez de
 *    entrar en la espiral de «cada cuadro tarda más porque recupera más».
 *  - Lado 0 = lo que tocó el jugador (con latch, ver entrada.ts); lado 1 = ENTRADA_VACIA
 *    (lo maneja la CPU del motor).
 *  - Los eventos se drenan UNA vez por cuadro (`p.eventos.splice(0)`) y van al render y a
 *    `alCuadro` (HUD y audio).
 *  - Con `fin_partida`, espera `esperaFinMs` de pantalla (el festejo) y avisa.
 *  - Online (lockstep, src/lib/juego/online): `tomarEntradas` da las DOS entradas del tick
 *    que sigue, o null si todavía falta la del rival. Entonces el loop no avanza (sigue
 *    dibujando) y reintenta en el cuadro siguiente, sin juntar atraso para después salir
 *    corriendo. `ritmo` frena o apura apenas para quedar parejo con el otro celular.
 *
 * Sin React: lo maneja la pantalla de pelea desde un efecto.
 */
import { ENTRADA_VACIA, TPS } from '../tipos'
import type { EntradaJugador, EventoJuego, Partida, Renderizador } from '../tipos'

const PASO_MS = 1000 / TPS
const MAX_PASOS = 5
/**
 * Escalones de calidad que se pueden pedir en una pelea: alta → media → baja. Con uno solo, un
 * celular sin canvas acelerado bajaba a «media» y se quedaba a 39 fps sin llegar nunca a «baja».
 */
const MAX_AVISOS = 2
/** Un cuadro más largo que esto (pestaña dormida, GC) se cuenta como este máximo. */
const DT_MAX_MS = 100
const SIN_EVENTOS: readonly EventoJuego[] = []

export interface OpcionesLoop {
  partida: Partida
  renderizador: Renderizador
  avanzar: (p: Partida, entradas: readonly [EntradaJugador, EntradaJugador]) => void
  tomarEntrada: () => EntradaJugador
  /** Después de dibujar cada cuadro: HUD y audio. */
  alCuadro?: (p: Partida, eventos: readonly EventoJuego[], dtMs: number) => void
  alFinPartida?: (p: Partida) => void
  /** Cuánto se ve el festejo antes de pasar al resultado (ms de pantalla). */
  esperaFinMs?: number
  /**
   * Si el celular no llega a ~40 fps sostenidos en plena pelea. Hasta MAX_AVISOS veces por pelea
   * (alta → media → baja), midiendo de cero después de cada una.
   */
  alRendimientoBajo?: () => void
  /** Un error del motor o del render: el loop se detiene y avisa. */
  alError?: (error: unknown) => void
  /**
   * Online: las entradas de los dos lados para el tick que sigue, o null si falta la del
   * rival (el loop espera sin avanzar). Si está, reemplaza a `tomarEntrada`.
   */
  tomarEntradas?: () => readonly [EntradaJugador, EntradaJugador] | null
  /** Online: multiplicador del ritmo de este cuadro (≈1; lo acota el loop a 0,5–1,5). */
  ritmo?: () => number
  /** Después de cada tick simulado (online: el hash del estado). */
  alPaso?: (p: Partida) => void
}

export interface ControlLoop {
  iniciar(): void
  pausar(): void
  reanudar(): void
  detener(): void
  /** Dibuja el estado actual sin avanzar (después de un resize en pausa). */
  redibujar(): void
  cambiarRenderizador(r: Renderizador): void
  estaPausado(): boolean
}

export function crearLoop(op: OpcionesLoop): ControlLoop {
  const p = op.partida
  let render = op.renderizador
  let raf = 0
  let corriendo = false
  let detenido = false
  let ultimo = -1
  let acumulado = 0

  let finVisto = false
  let finAvisado = false
  let finRestante = 0

  // Rendimiento: media móvil del dt durante la pelea.
  let media = PASO_MS
  let msEnPelea = 0
  let msLento = 0
  let avisos = 0

  function medir(dt: number) {
    if (avisos >= MAX_AVISOS || p.fase !== 'pelea' || dt <= 0) return
    media = media * 0.94 + dt * 0.06
    msEnPelea += dt
    if (msEnPelea > 2500 && media > 25) msLento += dt
    else msLento = 0
    if (msLento > 3000) {
      avisos++
      // Se vuelve a medir de cero: el renderizador nuevo necesita unos cuadros para estabilizarse
      // (cachés, la arena a la resolución nueva) antes de decidir si hace falta otro escalón.
      media = PASO_MS
      msEnPelea = 0
      msLento = 0
      op.alRendimientoBajo?.()
    }
  }

  function ritmoDelCuadro(): number {
    if (!op.ritmo) return 1
    const r = op.ritmo()
    return Number.isFinite(r) ? Math.max(0.5, Math.min(1.5, r)) : 1
  }

  function cuadro(ahora: number) {
    if (!corriendo) return
    raf = requestAnimationFrame(cuadro)
    let dt = ultimo < 0 ? PASO_MS : ahora - ultimo
    ultimo = ahora
    if (dt > DT_MAX_MS) dt = DT_MAX_MS
    if (dt < 0) dt = 0
    try {
      const escala = Number.isFinite(p.escalaTiempo) ? Math.max(0, Math.min(2, p.escalaTiempo)) : 1
      acumulado += dt * escala * ritmoDelCuadro()
      let pasos = 0
      const dos = op.tomarEntradas
      if (dos) {
        while (acumulado >= PASO_MS && pasos < MAX_PASOS) {
          const entradas = dos()
          if (!entradas) {
            // Falta la del rival: no se avanza ni se junta atraso (sería salir corriendo después).
            acumulado = Math.min(acumulado, PASO_MS)
            break
          }
          op.avanzar(p, entradas)
          op.alPaso?.(p)
          acumulado -= PASO_MS
          pasos++
        }
      } else {
        while (acumulado >= PASO_MS && pasos < MAX_PASOS) {
          op.avanzar(p, [op.tomarEntrada(), ENTRADA_VACIA])
          acumulado -= PASO_MS
          pasos++
        }
      }
      if (pasos === MAX_PASOS && acumulado >= PASO_MS) acumulado = 0

      const eventos = p.eventos.length > 0 ? p.eventos.splice(0) : SIN_EVENTOS
      render.dibujar(p, eventos, dt)
      op.alCuadro?.(p, eventos, dt)

      if (!finVisto) {
        for (const e of eventos) {
          if (e.tipo === 'fin_partida') {
            finVisto = true
            finRestante = op.esperaFinMs ?? 2500
            break
          }
        }
      } else if (!finAvisado) {
        finRestante -= dt
        if (finRestante <= 0) {
          finAvisado = true
          op.alFinPartida?.(p)
        }
      }
      medir(dt)
    } catch (error) {
      detener()
      op.alError?.(error)
    }
  }

  function reanudar() {
    if (detenido || corriendo) return
    corriendo = true
    ultimo = -1
    raf = requestAnimationFrame(cuadro)
  }

  function pausar() {
    corriendo = false
    cancelAnimationFrame(raf)
  }

  function detener() {
    detenido = true
    pausar()
  }

  return {
    iniciar: reanudar,
    reanudar,
    pausar,
    detener,
    redibujar() {
      if (corriendo || detenido) return
      try {
        render.dibujar(p, SIN_EVENTOS, 0)
      } catch {
        // Un cuadro que no se pudo redibujar en pausa no es grave.
      }
    },
    cambiarRenderizador(r) {
      render = r
    },
    estaPausado() {
      return !corriendo
    },
  }
}
