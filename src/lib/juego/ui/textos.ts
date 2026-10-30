/**
 * Textos y formatos de la UI de «Corte Final». Todo en español rioplatense.
 */
import type { Atributos, Dificultad, FichaPersonaje, IconoEspecial } from '../tipos'

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

/** Consejos de la pantalla de carga: cortos, uno por idea, sirven con cualquier barbero. */
export const TIPS: readonly string[] = [
  'Tocá GOLPE tres veces seguidas: puño, patada y combo.',
  'Mantené GUARDIA para bloquear. Si te rompen el escudo, quedás regalado.',
  'La carga de la máquina se llena sola. Cuando una carta late, ya la podés usar.',
  'En los últimos 20 segundos viene el TURBO: la máquina carga el doble.',
  'ESQUIVA te saca de un apuro: sola va para atrás y, con el stick, hacia donde apuntes.',
  'El golpe pesado (MÁQUINA, REMATE…) rompe guardias y tiene más chance de crítico.',
  'El bombo y el sismo corren por el piso: saltalos. El sismo ni siquiera se puede bloquear.',
  'La onda del grito no se frena con la guardia: se pasa con la ESQUIVA.',
  'El agarre no se bloquea: si lo ves venir, alejate o saltá.',
  'Mareado no te podés cubrir: alejate hasta que se te pase.',
  'Si aparece «¡DEJALO AL CERO!», apretá cualquier golpe: son puntos extra.',
  'Pegarle a alguien congelado lo rompe con un golpe extra.',
  'Recibir golpes también carga la máquina. Nunca está todo perdido.',
  'Una ronda sin recibir daño es PERFECTA: vale 1.000 puntos.',
  'Cada barbero tiene su pasiva: mirala en su ficha antes de elegir.',
]

/**
 * Cómo sobrevivir a cada especial del RIVAL (por su ícono, que es único). `{n}` = su nombre.
 * Sale de lo que dice cada especial en su ficha: si un especial cambia de mecánica, cambia acá.
 */
const CONTRA_ESPECIAL: Partial<Record<IconoEspecial, string>> = {
  rayo: 'El Corte Relámpago de {n} cruza la pantalla y electrocuta: cubrite y castigalo cuando queda pegado.',
  tijera: 'La Tijera Tormenta de {n} pega seis veces: cubrirte todo el tornado te puede romper la guardia.',
  sillon: 'El Sillonazo de {n} rompe la guardia aunque te cubras: saltalo o esquivalo.',
  spray: 'La Fijación de {n} te congela: no te quedes adelante del spray.',
  bombo: 'El bombo de {n} rueda por el piso: saltalo, o te deja aturdido.',
  navaja: 'El Navajazo de {n} es corto pero siempre crítico: cuando tiene carga, no te quedes al lado.',
  cura: '{n} se cura tomando su bebida: pegale mientras toma y se le corta.',
  guante: 'El Modo Boxeador de {n} rompe la guardia: esquivalo en vez de cubrirte.',
  moto: 'La moto de {n} cruza toda la pantalla y te tira: saltala o esquivala.',
  pistola: 'La pistola de {n} tira tres balas seguidas: cubrite o pasalas por arriba.',
  break: 'El Break Dance de {n} no se puede cortar al principio: cubrite y castigá al final.',
  graffiti: 'El graffiti de {n} tarda un instante en estallar: salí del área cuando lo pinta.',
  trago: 'El trago de {n} te marea: mareado no te podés cubrir.',
  botella: 'Las botellas de {n} caen a distintas distancias: movete y buscá el hueco.',
  baile: 'Mientras baila, {n} atraviesa los proyectiles: cubrite del remate final.',
  grito: 'La onda del grito de {n} se pasa con la ESQUIVA.',
  gorro: 'El gorro de {n} va y vuelve: te puede pegar a la ida y a la vuelta.',
  dragon: 'La Patada del Dragón de {n} cruza la pantalla y te tira: cubrite o esquivala.',
  pelota: 'El pelotazo de {n} es rápido y recto: saltalo.',
  chilena: 'La chilena de {n} te pega aunque saltes y rompe la guardia: esquivala.',
  mamadera: 'El chorro de {n} te empuja: si le pegás a él, se corta.',
  panal: 'El pañal de {n} deja una nube en el piso: no la pises, que te pone lento.',
  mate: 'Los mates de {n} caen escalonados: movete entre uno y otro.',
  termo: 'El agua del termo de {n} quema de a poco: salí del chorro.',
  agarre: 'El agarre de {n} no se bloquea: si lo ves venir, alejate o saltá.',
  sismo: 'El Puño Sísmico de {n} corre por el piso y no se bloquea de pie: saltalo.',
}

/**
 * Los consejos de ESTA pelea (van primero en la pantalla de carga): cómo frenar los dos
 * especiales del rival y qué hace la pasiva propia.
 */
export function consejosDePelea(jugador: FichaPersonaje, rival: FichaPersonaje): string[] {
  const consejos: string[] = []
  for (const esp of rival.especiales) {
    const texto = CONTRA_ESPECIAL[esp.icono]
    if (texto) consejos.push(texto.replaceAll('{n}', rival.nombre))
  }
  consejos.push(`${jugador.nombre} · ${jugador.pasiva.nombre}: ${jugador.pasiva.descripcion}`)
  return consejos
}

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
