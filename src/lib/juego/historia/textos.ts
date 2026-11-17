/**
 * Los textos del modo historia (16/nov/2026): la intro, lo que dice cada Boss y el final de cada
 * barbero. Nacho NO es dueño: es el programador y admin del sistema; el que programó el torneo. Los
 * apodos de los Bosses los eligió el usuario (16/nov): el Admin, el Ghost, el Sabio y el Jefe (son los
 * de su ficha, personajes.ts). Los barberos de los pisos de abajo hablan con las `frases` de su ficha:
 * no hay texto nuevo para ellos.
 *
 * Sin `@/`: lo importan las pantallas y se puede revisar desde Node.
 */
import type { IdPersonaje } from '../tipos'
import type { IdJefe } from './jefes'

/** Una viñeta de la intro. `escena` elige el dibujo (historia/intro-historia.tsx). */
export interface Vineta {
  escena: 'plantel' | 'maquina' | 'jefes' | 'torre'
  titulo: string
  texto: string
}

export const INTRO: readonly Vineta[] = [
  {
    escena: 'plantel',
    titulo: 'Monaco Barber Studio',
    texto: 'Cuatro sucursales. Diecisiete barberos. Y una pregunta que nadie se anima a contestar: ¿quién es el mejor?',
  },
  {
    escena: 'maquina',
    titulo: 'El Torneo de Monaco',
    texto: 'Esta noche, con las persianas bajas, arranca el torneo. El premio es uno solo: la Máquina de Oro.',
  },
  {
    escena: 'jefes',
    titulo: 'Los Bosses',
    texto:
      'La Máquina de Oro no está sola. La cuidan los Bosses: Nacho, el Admin; Nehuen, el Ghost; Nico, el Sabio; y arriba de todo, Tony, el Jefe.',
  },
  {
    escena: 'torre',
    titulo: 'Nueve peleas',
    texto: 'Cinco barberos y cuatro Bosses. Elegí a tu barbero y empezá a subir.',
  },
]

export interface TextosJefe {
  /** Su lema, debajo del nombre y el apodo (en la torre y en su presentación). */
  titulo: string
  /** Lo que dice antes de pelear (una línea por toque). */
  antes: readonly string[]
  /** Cuando le ganás. */
  derrota: string
  /** Cuando te gana (en «¿Continuar?»). */
  victoria: string
}

export const TEXTOS_JEFES: Readonly<Record<IdJefe, TextosJefe>> = {
  nacho: {
    titulo: 'El que programó el torneo',
    antes: [
      'Bienvenido a mi torneo. Lo programé yo: cada golpe que tirás pasa por mi código.',
      'Si perdés, no es un bug. Es una feature.',
    ],
    derrota: 'Error 404: victoria no encontrada… Bien jugado. Subí, que arriba no perdonan.',
    victoria: 'Reiniciá y probá de nuevo. Tengo el log de todos tus errores.',
  },
  nehuen: {
    titulo: 'Nadie lo ve llegar',
    antes: ['¿Me viste llegar? Nadie me ve llegar.', 'En Caseros me dicen El Ghost. Ya vas a entender por qué.'],
    derrota: 'Me viste… Pocos me ven. Seguí, que lo que viene es peor.',
    victoria: 'Ni me viste pasar. Volvé cuando aprendas a mirar.',
  },
  nico_m: {
    titulo: 'Siempre sabe qué vas a hacer',
    antes: ['Llegaste lejos. Lástima que yo ya sé cómo termina esto.', 'Me dicen El Sabio: tu próximo golpe ya lo vi venir.'],
    derrota: 'No lo vi venir… Primera vez que me pasa. Arriba te espera el Jefe.',
    victoria: 'Te avisé que ya sabía cómo terminaba. Estudiá un poco y volvé.',
  },
  tony: {
    titulo: 'El dueño de la Máquina de Oro',
    antes: [
      'Así que vos sos el que subió toda la torre.',
      'La Máquina de Oro está en Monaco desde el primer día. Si la querés, vas a tener que sacármela.',
    ],
    derrota: 'Está bien, está bien… Te la ganaste. La Máquina de Oro es tuya.',
    victoria: 'Estás despedido. Volvé cuando estés listo.',
  },
}

/** El final de cada uno de los 17 barberos (después de ganarle a Tony). */
export const FINALES: Readonly<Partial<Record<IdPersonaje, string>>> = {
  simon: 'Simón levantó la Máquina de Oro y le saltó una chispa. Desde esa noche, en Rondeau los degradés salen a la velocidad del rayo.',
  chipi: 'Chipi apoyó la Máquina de Oro en su sillón y la fijó con gel para que nadie se la saque. Dicen que sigue ahí, sin moverse un milímetro.',
  nico_u: 'Nico U. sacó el bombo y dio la vuelta olímpica por las cuatro sucursales. La Máquina de Oro ya tiene los colores azul y oro.',
  fabri: 'Fabri se acomodó el pelo antes de la foto con la Máquina de Oro. Salió perfecta: la primera de cien selfies.',
  luciano: 'Luciano ató la Máquina de Oro atrás de la moto y salió a dar una vuelta por la ciudad. Todavía nadie lo pudo alcanzar.',
  gabriel: 'Gabriel festejó con un molino arriba del mostrador y pintó la Máquina de Oro en una pared de Caseros. Es el graffiti más fotografiado del barrio.',
  guillermo: 'Guillermo hizo malabares con la Máquina de Oro como si fuera una botella y no se le cayó ni una vez. Esa noche, la ronda la pagó él.',
  rodrigo: 'Rodrigo agarró el micrófono y le dedicó un cuarteto a la Máquina de Oro. El baile siguió hasta que abrió el local al otro día.',
  joaquin: 'Cham-poo hizo una reverencia, guardó la Máquina de Oro debajo del gorro y volvió a entrenar. «La disciplina no se festeja: se practica.»',
  nahuel: 'Nahuel levantó la Máquina de Oro como una copa del mundo y se la dedicó a la tribuna. El 10 siempre aparece en las finales.',
  lucas: 'Lucas llegó a casa con la Máquina de Oro y la dejó al lado de la cuna. «Papá ganó», dijo bajito, para no despertar a nadie.',
  stefano: 'Stefano cebó el primer mate de campeón y se lo convidó a Tony. Amargo, como la derrota de todos los que subieron la torre.',
  brian: 'Brian abrazó la Máquina de Oro tan fuerte que casi la dobla. Desde entonces, en Paraná nadie le discute un turno.',
  chino: 'Chino apostó todo a una sola mano y se llevó la Máquina de Oro. «La casa siempre gana», dijo, y volvió a barajar.',
  fran: 'Fran miró la Máquina de Oro a los ojos y la Máquina de Oro se fue con él. En Pueyrredón dicen que los clientes salen hipnotizados del sillón.',
  lautaro: 'Lautaro levantó la Máquina de Oro tan alto que tocó el techo de Pueyrredón. Desde allá arriba, ahora sí, todos se ven chiquitos.',
  leo: 'Leo sumó la Máquina de Oro a su cinturón de herramientas. «Ahora sí está completo», dijo, y se fue a cortar.',
}

/** Si algún día entra un barbero sin final escrito. */
export function finalDe(id: IdPersonaje, nombre: string): string {
  return FINALES[id] ?? `${nombre} levantó la Máquina de Oro arriba de la torre. Desde esa noche, todo Monaco sabe quién es el mejor.`
}
