/**
 * Textos y formatos de la UI de «Corte Final». Todo en español rioplatense.
 */
import type { Atributos, Dificultad } from '../tipos'

export const NOMBRE_DIFICULTAD: Record<Dificultad, string> = {
  facil: 'Fácil',
  normal: 'Normal',
  dificil: 'Difícil',
}

export const DETALLE_DIFICULTAD: Record<Dificultad, string> = {
  facil: 'Para arrancar',
  normal: 'Pelea pareja',
  dificil: 'Sin piedad',
}

export const ORDEN_DIFICULTAD: readonly Dificultad[] = ['facil', 'normal', 'dificil']

export const ETIQUETA_ATRIBUTO: Record<keyof Atributos, string> = {
  fuerza: 'Fuerza',
  velocidad: 'Velocidad',
  defensa: 'Defensa',
  tecnica: 'Técnica',
  alcance: 'Alcance',
}

export const ORDEN_ATRIBUTOS: readonly (keyof Atributos)[] = [
  'fuerza',
  'velocidad',
  'defensa',
  'tecnica',
  'alcance',
]

/** Consejos de la pantalla de carga: cortos, uno por idea. */
export const TIPS: readonly string[] = [
  'Tocá GOLPE tres veces seguidas: puño, patada y combo.',
  'Mantené GUARDIA para bloquear. Si te rompen el escudo, quedás regalado.',
  'La carga de la máquina se llena sola. Cuando una carta late, ya la podés usar.',
  'En los últimos 20 segundos viene el TURBO: la máquina carga el doble.',
  'Deslizá dos veces rápido para un costado y hacés un dash.',
  'La HERRAMIENTA pega más fuerte, rompe guardias y tiene más chance de crítico.',
  'Si aparece «¡DEJALO AL CERO!», apretá cualquier golpe: son puntos extra.',
  'Pegarle a alguien congelado lo rompe con un golpe extra.',
  'Simón mete más críticos, y cada crítico le devuelve carga.',
  'Chipi aguanta más: recibe menos daño que nadie.',
  'Recibir golpes también carga la máquina. Nunca está todo perdido.',
  'Una ronda sin recibir daño es PERFECTA: vale 1.000 puntos.',
]

/** 12345 → «12.345». */
export function formatearPuntos(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('es-AR')
}

/** 134 → «2:14». */
export function formatearDuracion(segundos: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(segundos) ? segundos : 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Nombre corto para la carta del especial: la palabra más larga del nombre.
 * «Corte Relámpago» → «Relámpago», «Sillonazo Brutal» → «Sillonazo».
 */
export function nombreCortoEspecial(nombre: string): string {
  const partes = nombre.split(/\s+/).filter(Boolean)
  if (partes.length === 0) return nombre
  return partes.reduce((a, b) => (b.length > a.length ? b : a), partes[0])
}

export function porcentaje(parte: number, total: number): number {
  if (!total || !Number.isFinite(parte) || !Number.isFinite(total)) return 0
  return Math.round((parte / total) * 100)
}

/** «hace 5 min», «ayer», «12 oct». `ahora` viene de afuera: nada de Date.now() en el render. */
export function fechaRelativa(iso: string, ahora: number): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const minutos = Math.max(0, Math.round((ahora - t) / 60000))
  if (minutos < 1) return 'recién'
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.round(minutos / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.round(horas / 24)
  if (dias === 1) return 'ayer'
  if (dias < 7) return `hace ${dias} días`
  return new Date(t).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}

export const APODO_MAX = 16

/** Letras (con tildes y ñ), números, espacios y . _ - ; máximo 16. */
export function sanearApodo(texto: string): string {
  return texto
    .replace(/[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, APODO_MAX)
}
