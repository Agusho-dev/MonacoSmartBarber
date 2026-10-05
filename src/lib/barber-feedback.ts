/**
 * Helpers de feedback sensorial para el panel de barberos:
 * haptics (navigator.vibrate) y beeps con WebAudio API.
 *
 * Degradan silenciosamente cuando la API no está disponible
 * (iOS Safari bloquea vibrate, audio context requiere interacción previa).
 */

let sharedAudioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') return sharedAudioContext

  try {
    const Ctor = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    sharedAudioContext = new Ctor()
    return sharedAudioContext
  } catch {
    return null
  }
}

/** Despierta el AudioContext en respuesta a una interacción del usuario (para iOS). */
export function primeAudioContext(): void {
  const ctx = getAudioContext()
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {})
}

/** Vibra si la API está disponible. No hace nada en iOS. */
export function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return
  try {
    navigator.vibrate(pattern)
  } catch {
    // noop
  }
}

interface BeepOptions {
  frequency?: number
  duration?: number
  volume?: number
  type?: OscillatorType
}

export function playBeep(opts: BeepOptions = {}): void {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})

  const {
    frequency = 880,
    duration = 0.32,
    volume = 0.12,
    type = 'sine',
  } = opts

  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.frequency.value = frequency
    osc.type = type
    gain.gain.setValueAtTime(volume, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration)
  } catch {
    // noop
  }
}

/** Doble beep estilo "alerta amarilla" */
export function playWarnBeep(): void {
  playBeep({ frequency: 720, duration: 0.25, volume: 0.10 })
  setTimeout(() => playBeep({ frequency: 720, duration: 0.25, volume: 0.10 }), 180)
}

/** Triple beep estilo "alerta roja" */
export function playDangerBeep(): void {
  playBeep({ frequency: 980, duration: 0.22, volume: 0.14 })
  setTimeout(() => playBeep({ frequency: 980, duration: 0.22, volume: 0.14 }), 160)
  setTimeout(() => playBeep({ frequency: 980, duration: 0.22, volume: 0.14 }), 320)
}

/** Beep agradable de confirmación (completado, copiado, etc.). */
export function playSuccessBeep(): void {
  playBeep({ frequency: 880, duration: 0.15, volume: 0.10 })
  setTimeout(() => playBeep({ frequency: 1320, duration: 0.18, volume: 0.10 }), 90)
}

/**
 * Una nota con ataque suave (sin el "clic" de arrancar a volumen pleno),
 * agendada en el reloj del AudioContext: el intervalo entre notas es exacto
 * aunque el hilo principal esté ocupado re-dibujando la fila.
 */
function nota(
  ctx: AudioContext,
  frequency: number,
  inicio: number,
  duration: number,
  volume: number,
  type: OscillatorType,
): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = type
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, inicio)
  gain.gain.linearRampToValueAtTime(volume, inicio + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.001, inicio + duration)
  osc.start(inicio)
  osc.stop(inicio + duration + 0.02)
}

/**
 * Campanita del pedido de asesoría (mig 217): dos notas triangulares que suben
 * (sol → re). Es distinta a propósito de los beeps del cronómetro, de la alerta
 * de "tu cliente te está esperando" y de la campana de los descansos, para que
 * el barbero la reconozca sin mirar. El panel la toca sólo si el barbero está
 * libre: durante un corte no se suena (regla de active-client-card).
 */
export function playAsesoriaChime(): void {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  try {
    const t = ctx.currentTime
    nota(ctx, 784, t, 0.22, 0.08, 'triangle')
    nota(ctx, 1175, t + 0.14, 0.32, 0.07, 'triangle')
  } catch {
    // noop
  }
}
