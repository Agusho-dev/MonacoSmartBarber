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
