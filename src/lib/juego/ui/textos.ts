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
  // Desde la quinta tanda hay un agarre que también agarra en el aire (Lautaro): agacharse es una defensa.
  'Los agarres no se bloquean: si ves venir uno, alejate. Saltar sirve contra casi todos; agacharte, contra el que va al cuello.',
  'Agacharte esquiva lo que va a la cara: la mirada de los lentes y el agarre del cuello.',
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
  // El sillón tapa de 60 a 500 px a la altura del cuerpo: ni saltarlo ni esquivar para atrás lo pasan
  // de cerca (medido el 31/oct); sólo cruzarlo con la esquiva hacia adelante cuando sale.
  sillon: 'El Sillonazo de {n} rompe la guardia y tapa casi toda la pantalla: no te cubras; cruzalo con la ESQUIVA hacia él justo cuando sale, o alejate bien.',
  spray: 'La Fijación de {n} te congela un segundo: no te quedes adelante del spray.',
  bombo: 'El bombo de {n} rueda por el piso: saltalo, o te deja aturdido.',
  navaja: 'El Navajazo de {n} es corto pero siempre crítico: cuando tiene carga, no te quedes al lado.',
  cura: '{n} se cura tomando su bebida (sólo si le falta vida): cortásela con un golpe fuerte o un especial; los golpes leves no alcanzan.',
  // Igual que el sillón: para atrás no alcanza a menos de 280 px.
  guante: 'El Modo Boxeador de {n} rompe la guardia: no te cubras; cruzalo con la ESQUIVA hacia él justo cuando sale.',
  moto: 'La moto de {n} cruza toda la pantalla y te tira: cubrite y castigala cuando frena.',
  pistola: 'La pistola de {n} tira tres balas seguidas: cubrite o pasalas por arriba.',
  break: 'El Break Dance de {n} no se puede cortar al principio: saltalo por encima, o esquivalo para atrás si estás lejos.',
  graffiti: 'El graffiti de {n} tarda un instante en estallar: salí del área o cubrite (te come casi toda la guardia).',
  trago: 'El trago de {n} te marea un segundo: mareado no te podés cubrir.',
  botella: 'Las botellas de {n} caen a distintas distancias: movete y buscá el hueco.',
  baile: 'Mientras baila, {n} atraviesa los proyectiles: cubrite cuando se te acerca bailando.',
  grito: 'La onda del grito de {n} se pasa con la ESQUIVA.',
  gorro: 'El gorro de {n} va y vuelve: te puede pegar a la ida y a la vuelta.',
  dragon: 'La Patada del Dragón de {n} cruza la pantalla y te tira: cubrite o esquivala.',
  pelota: 'El pelotazo de {n} es rápido y recto: saltalo.',
  chilena: 'La chilena de {n} te pega aunque saltes y rompe la guardia: esquivala.',
  mamadera: 'El chorro de {n} te pega varias veces y el último te empuja: si le pegás a él, se corta.',
  panal: 'El pañal de {n} deja una nube en el piso: no la pises, que te pone lento.',
  mate: 'Los mates de {n} caen escalonados: movete entre uno y otro.',
  termo: 'El agua del termo de {n} quema de a poco: salí del chorro.',
  agarre: 'El agarre de {n} no se bloquea: si lo ves venir, alejate o saltá.',
  sismo: 'El Puño Sísmico de {n} corre por el piso y no se bloquea de pie: saltalo.',
  // Quinta tanda (14/nov).
  cartas: 'Las Cartas Malditas de {n} salen en abanico: alta, al medio y al ras del piso. Saltando o agachado alguna te alcanza: cubrite.',
  dominio: 'En el All In, {n} espera tu golpe: si le pegás o le tirás algo, te contesta con todo. No le pegues: esperá, y saltá o cubrite la embestida del final.',
  lentes: 'Los Lentes Hipnóticos de {n} van a la altura de los ojos: agachate o cubrite. Si te alcanzan de lejos, caminás hacia él sin poder hacer nada.',
  corte: 'El Corte de Precisión de {n} es crítico con la punta de la tijera: pegate a él o alejate del todo.',
  gigante: 'Mientras {n} crece, los golpes leves no lo frenan y el aplastón llega lejos: alejate, cortalo con un golpe fuerte o un especial, o cubrite (te gasta mucha guardia).',
  lanzamiento: 'El Lanzamiento Aéreo de {n} te agarra del cuello aunque saltes y no se bloquea: agachate o esquivalo.',
  herramientas: 'Las herramientas de {n} van adonde estás, aunque saltes: cubrite.',
  aerosol: 'El Spray Cegador de {n} te deja un segundo sin poder pegar: cubrite y no te ciega; si te ciega, cubrite o alejate hasta que se te pase.',
  ejecucion: 'El agarre de {n} te alcanza desde media distancia y no se bloquea: saltá, esquivalo o pegate a él, que de cerca no llega.',
  codigo: 'El Terremoto de {n} levanta columnas de código cada vez más lejos: cubrite, o cruzalo con la ESQUIVA hacia él y castigalo arrodillado.',
  fantasma: 'Cuando {n} desaparece no lo podés tocar: cubrite, que reaparece delante tuyo y te pega con la pelota.',
  padel: 'El Smash de {n} te devuelve lo que le tirás mientras remata, y más rápido: no le tires cosas cuando tiene carga; la pelota se cubre o se salta.',
  orden: 'La Orden Final de {n} cruza casi toda la pantalla y no se salta: cubrite apenas te señala.',
  espinas: 'Las Espinas de {n} que no te pegan quedan clavadas en el piso: saltalas o esperá que se apaguen; pisarlas te tira.',
  monopatin: 'El Monopatín de {n} sale despacio y acelera: cubrí el revoleo de cerca y saltá el monopatín antes de que agarre velocidad.',
  despido: 'Si {n} te muestra el papel del Despido y no te cubriste, te arrodillás y te come una patada voladora: cubrite y castigalo, que queda regalado.',
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

/**
 * 0–100, redondeado. Topeado en 100 por las dudas: la «Precisión» del resultado (CPU y online)
 * daba más de 100 con los multigolpes hasta que el motor contó un intento por golpe posible
 * (30/oct); simular.mts chequea que los aciertos no pasen de los intentos.
 */
export function porcentaje(parte: number, total: number): number {
  if (!total || !Number.isFinite(parte) || !Number.isFinite(total)) return 0
  return Math.min(100, Math.round((parte / total) * 100))
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
