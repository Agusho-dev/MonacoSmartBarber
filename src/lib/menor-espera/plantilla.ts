/**
 * La plantilla de WhatsApp de «Menor espera» y cómo se reconocen sus botones.
 *
 * Módulo plano (sin 'use server'): lo consumen el webhook (también estático,
 * como salvavidas), las server actions, la card del dashboard y el sync de
 * plantillas del inbox (`estadoPlantillaParaBase`).
 *
 * ── Una sola fuente para el texto ──
 * El BODY que le llega al cliente se renderiza en SQL desde
 * `message_templates.components` (migración 218, `menor_espera_render`), o sea
 * desde lo que Meta tiene aprobado. Lo de acá se usa sólo para CREAR la
 * plantilla en una org que no la tiene y como vista previa mientras no existe.
 * Si el dueño la edita en Business Manager, manda lo de Meta.
 *
 * ── Por qué los botones van SIN payload propio ──
 * La edge function deployada (`process-scheduled-messages` v16) arma cada
 * componente como {type, parameters} y descarta `sub_type`/`index`: un botón
 * con payload hace fallar el envío entero. Sin payload, Meta devuelve en el
 * webhook `button.text` = `button.payload` = el texto del botón, y eso más el
 * teléfono alcanza para correlacionar (verificado con las reseñas, 3/10/2026).
 */

/** Nombre por defecto. Configurable por org (`app_settings.menor_espera_plantilla`). */
export const PLANTILLA_MENOR_ESPERA_NOMBRE = 'fila_menor_espera'

/** Minutos que ofrece la card. La base acepta 20..120 (CHECK de la 218). */
export const MINUTOS_OPCIONES = [30, 45, 60, 75, 90] as const

/** Lo mismo que se creó en la WABA de Monaco el 3/10/2026, al carácter. */
export const PLANTILLA_POR_DEFECTO = {
  idioma: 'es',
  categoria: 'UTILITY',
  cuerpo:
    'Hola {{1}}, hace {{2}} minutos que esperás a {{3}}. En este momento hay un barbero libre en {{4}}.\n\n' +
    '¿Querés pasarte a Menor espera? Te atiende el primero que se libere y conservás tu lugar en la fila.',
  ejemplo: ['Juan', '45', 'Nico', 'Rondeau'],
  pie: 'Si no respondés, seguís esperando como hasta ahora.',
  botones: ['Sí, pasarme', 'No, sigo esperando'] as [string, string],
} as const

/**
 * Estados que admite `message_templates.status` (CHECK ampliado en la mig 222).
 * Antes sólo entraban pending/approved/rejected: con una plantilla pausada el
 * upsert del sync fallaba y la fila quedaba 'approved' para siempre.
 */
const ESTADOS_PLANTILLA_EN_BASE = new Set([
  'pending', 'approved', 'rejected', 'paused', 'disabled', 'in_appeal', 'pending_deletion',
])

/**
 * El estado de Meta (en minúsculas) tal como se puede guardar. Lo que Meta
 * agregue y la base no admita (deleted, archived, limit_exceeded…) se guarda
 * como NO usable: dejar la fila como estaba podía dejarla «approved» con una
 * plantilla que ya no se puede mandar. Lo usan el sync del inbox y la creación
 * de la plantilla de Menor espera.
 */
export function estadoPlantillaParaBase(estadoMeta: string | null | undefined): string {
  const e = (estadoMeta ?? '').toLowerCase()
  if (ESTADOS_PLANTILLA_EN_BASE.has(e)) return e
  if (e === 'deleted') return 'pending_deletion'
  return e ? 'disabled' : 'pending'
}

/** Categorías que admite `message_templates.category`; otra cosa cae en la que se pidió. */
export function categoriaPlantillaParaBase(categoriaMeta: string | null | undefined, porDefecto: string): string {
  const c = (categoriaMeta ?? '').toLowerCase()
  return c === 'marketing' || c === 'utility' || c === 'authentication' ? c : porDefecto.toLowerCase()
}

/** Componentes listos para `POST /{waba}/message_templates`. */
export function componentesParaMeta(): Array<Record<string, unknown>> {
  return [
    {
      type: 'BODY',
      text: PLANTILLA_POR_DEFECTO.cuerpo,
      example: { body_text: [[...PLANTILLA_POR_DEFECTO.ejemplo]] },
    },
    { type: 'FOOTER', text: PLANTILLA_POR_DEFECTO.pie },
    {
      type: 'BUTTONS',
      buttons: PLANTILLA_POR_DEFECTO.botones.map(text => ({ type: 'QUICK_REPLY', text })),
    },
  ]
}

/**
 * Minúsculas, sin acentos, sin signos ni emojis, espacios colapsados.
 * «Sí, pasarme» y «si pasarme» son lo mismo; «Si» (la Bienvenida) no.
 */
export function normalizarTexto(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * ¿Este botón de plantilla es uno de los nuestros? Compara el texto Y el
 * payload (con nuestra forma de envío son iguales) contra los textos de los
 * QUICK_REPLY de la plantilla configurada. `null` = es de otra plantilla (una
 * reseña, por ejemplo): el mensaje sigue su camino normal.
 */
export function respuestaDeBoton(
  boton: { text?: string | null; payload?: string | null } | null | undefined,
  botones: readonly string[] | null | undefined,
): 'si' | 'no' | null {
  if (!boton) return null
  const [si, no] = botones && botones.length >= 2 ? botones : PLANTILLA_POR_DEFECTO.botones
  const nSi = normalizarTexto(si)
  const nNo = normalizarTexto(no)
  for (const candidato of [boton.text, boton.payload]) {
    const n = normalizarTexto(candidato)
    if (!n) continue
    if (n === nSi) return 'si'
    if (n === nNo) return 'no'
  }
  return null
}

/** El mismo chequeo con los textos por defecto: para cuando la base no contestó. */
export function pareceBotonMenorEspera(
  message: { type?: string; button?: { text?: string | null; payload?: string | null } | null },
): boolean {
  return message.type === 'button' && respuestaDeBoton(message.button, null) !== null
}

/** El BODY con las variables reemplazadas (vista previa de la card). */
export function renderizarCuerpo(cuerpo: string, variables: readonly string[]): string {
  return variables.reduce((txt, valor, i) => txt.split(`{{${i + 1}}}`).join(valor), cuerpo)
}
