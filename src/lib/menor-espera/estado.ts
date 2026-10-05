/**
 * Reglas de presentación de «Menor espera por WhatsApp» que comparten la card
 * (cliente) y las server actions. Módulo puro: si la card y el servidor
 * explicaran distinto por qué no se puede prender, el dueño leería una cosa en
 * pantalla y recibiría otra en el toast.
 *
 * Las reglas espejan las precondiciones del tick (`menor_espera_ofertas_tick`,
 * migs 218/222): lo que acá bloquea prender, allá bloquea mandar.
 */

import type { PanelMenorEspera, WebhookPanel } from './tipos'

/** Tope diario de pruebas que salen (las fallidas no cuentan) y techo de intentos. */
export const LIMITE_PRUEBAS_DIA = 3
export const LIMITE_INTENTOS_DIA = 10

/** Sin una firma de Meta verificada en esta ventana no se ofrece (mig 222). */
const VENTANA_FIRMA_MS = 24 * 60 * 60 * 1000

type PanelMinimo = Pick<PanelMenorEspera, 'transporte' | 'plantilla'> & {
  ahora?: string
  config?: { acepta_marketing?: boolean } | null
  webhook?: WebhookPanel | null
}

/** Por qué la plantilla no se puede usar con su estado en Meta (o `null` si está aprobada). */
function motivoPorEstado(estado: string, nombre: string): string | null {
  switch (estado) {
    case 'approved':
      return null
    case 'pending':
    case '':
      return `Se activa cuando Meta aprueba la plantilla «${nombre}».`
    case 'in_appeal':
      return `Meta está revisando una apelación de la plantilla «${nombre}»: se activa cuando la apruebe.`
    case 'rejected':
      return `Meta rechazó la plantilla «${nombre}». Revisá el motivo en el Administrador de WhatsApp.`
    case 'paused':
      return `Meta pausó la plantilla «${nombre}» por calidad: mientras siga pausada no sale ningún aviso.`
    case 'disabled':
      return `Meta deshabilitó la plantilla «${nombre}»: no se puede usar.`
    case 'pending_deletion':
    case 'deleted':
      return `La plantilla «${nombre}» se está borrando en Meta.`
    default:
      return `Meta tiene la plantilla «${nombre}» en estado «${estado}»: se activa cuando la apruebe.`
  }
}

/**
 * Lo que impide MANDAR el aviso (también la prueba): transporte, plantilla y su
 * categoría. `estadoMeta` es lo que acaba de contestar Meta al verificar: si
 * existe, manda sobre lo guardado (puede traer un estado que la base no admite).
 */
export function motivoNoListoPrueba(panel: PanelMinimo, estadoMeta?: string | null): string | null {
  const nombre = panel.plantilla.nombre
  if (panel.transporte.baileys) {
    return 'Esta organización manda WhatsApp por el microservicio, que no admite botones. Pasá a la API oficial de Meta para usar esta función.'
  }
  if (!panel.transporte.whatsapp) {
    return 'WhatsApp no está conectado. Conectalo en Mensajería → Configuración.'
  }
  if (!panel.plantilla.existe) {
    return `Falta crear la plantilla «${nombre}» en Meta.`
  }
  const porEstado = motivoPorEstado((estadoMeta ?? panel.plantilla.estado ?? '').toLowerCase(), nombre)
  if (porEstado) return porEstado
  if (panel.plantilla.forma_ok === false) {
    return 'La plantilla cambió de forma: tiene que tener 4 variables y 2 botones de respuesta.'
  }
  if (esMarketing(panel) && panel.config?.acepta_marketing !== true) {
    return `Meta aprobó «${nombre}» como MARKETING: para usarla tenés que aceptarlo en «Plantilla de WhatsApp».`
  }
  return null
}

/**
 * Por qué todavía no se puede PRENDER en ninguna sucursal, o `null` si se puede.
 * Además de lo de la prueba, exige haber visto la firma de Meta verificada en
 * las últimas 24 h: el webhook sólo mueve a alguien con firma válida, así que
 * sin eso el «Sí» del cliente quedaría en una alerta.
 * El servidor lo vuelve a chequear al guardar: la card sólo lo anticipa.
 */
export function motivoNoListo(panel: PanelMinimo, estadoMeta?: string | null): string | null {
  return motivoNoListoPrueba(panel, estadoMeta) ?? motivoFirma(panel)
}

export function esMarketing(panel: Pick<PanelMenorEspera, 'plantilla'>): boolean {
  return (panel.plantilla.categoria ?? '').toLowerCase() === 'marketing'
}

function motivoFirma(panel: PanelMinimo): string | null {
  const w = panel.webhook
  if (!w) {
    // Fallar cerrado: sin la 222 no hay registro de firmas ni forma de saberlo.
    return 'Falta aplicar la migración 222 en la base: sin ella no podemos verificar las respuestas de WhatsApp.'
  }
  if (!w.tiene_app_secret) {
    return 'Falta el App Secret de Meta (Mensajería → Configuración): sin él no podemos verificar que las respuestas vengan de WhatsApp.'
  }
  const ahora = panel.ahora ? Date.parse(panel.ahora) : Date.now()
  const valida = w.ultima_valida_at ? Date.parse(w.ultima_valida_at) : NaN
  if (Number.isFinite(valida) && ahora - valida <= VENTANA_FIRMA_MS) return null
  const invalida = w.ultima_invalida_at ? Date.parse(w.ultima_invalida_at) : NaN
  if (Number.isFinite(invalida) && ahora - invalida <= VENTANA_FIRMA_MS) {
    return 'Los mensajes de WhatsApp llegan con una firma que no coincide con el App Secret guardado. Revisalo en Mensajería → Configuración.'
  }
  return 'Todavía no entró ningún mensaje de WhatsApp con la firma de Meta verificada (se mira el último día). Se habilita solo apenas entre uno.'
}

export type TonoEstado = 'ok' | 'espera' | 'error' | 'neutro'

/**
 * Cómo se lee el estado de la plantilla. `estadoMeta` es lo que acaba de
 * contestar Meta al verificar; si no hay, manda lo que guardó el sync (desde la
 * mig 222 la base admite paused/disabled/in_appeal/pending_deletion).
 * Aprobada como MARKETING sin la aceptación del dueño NO se lee en verde: a
 * simple vista diría «lista» y no lo está (mig 222).
 */
export function estadoPlantilla(
  plantilla: PanelMenorEspera['plantilla'],
  estadoMeta?: string | null,
  aceptaMarketing?: boolean,
): { texto: string; tono: TonoEstado } {
  if (!plantilla.existe && !estadoMeta) {
    return { texto: 'Falta crear la plantilla en Meta', tono: 'neutro' }
  }
  const estado = (estadoMeta ?? plantilla.estado ?? '').toLowerCase()
  switch (estado) {
    case 'approved':
      if (plantilla.forma_ok === false) {
        return { texto: 'La plantilla cambió de forma: tiene que tener 4 variables y 2 botones', tono: 'error' }
      }
      if ((plantilla.categoria ?? '').toLowerCase() === 'marketing') {
        return aceptaMarketing
          ? { texto: 'Aprobada por Meta como marketing', tono: 'ok' }
          : { texto: 'Aprobada por Meta, pero como MARKETING', tono: 'espera' }
      }
      return { texto: 'Plantilla aprobada por Meta', tono: 'ok' }
    case 'pending':
      return { texto: 'Plantilla en revisión de Meta (suele tardar de minutos a 24 h)', tono: 'espera' }
    case 'in_appeal':
      return { texto: 'Meta está revisando una apelación de la plantilla', tono: 'espera' }
    case 'rejected':
      return { texto: 'Meta rechazó la plantilla', tono: 'error' }
    case 'paused':
      return { texto: 'Meta pausó la plantilla por calidad', tono: 'error' }
    case 'disabled':
      return { texto: 'Meta deshabilitó la plantilla', tono: 'error' }
    case 'pending_deletion':
    case 'deleted':
      return { texto: 'La plantilla se está borrando en Meta', tono: 'error' }
    default:
      return { texto: estado ? `Estado en Meta: ${estado}` : 'Estado desconocido', tono: 'neutro' }
  }
}

/**
 * Cómo se lee la verificación de la firma de Meta en el webhook (mig 222).
 * `detalle` explica qué hacer; `null` cuando no hace falta hacer nada.
 */
export function estadoFirma(
  webhook: WebhookPanel | null | undefined,
  ahoraMs: number,
): { texto: string; tono: TonoEstado; detalle: string | null } {
  if (!webhook) {
    return {
      texto: 'Sin datos de la verificación',
      tono: 'neutro',
      detalle: 'Falta aplicar la migración 222 en la base.',
    }
  }
  if (!webhook.tiene_app_secret) {
    return {
      texto: 'Falta el App Secret de Meta',
      tono: 'error',
      detalle:
        'Sin él no podemos verificar que una respuesta venga de WhatsApp, y no movemos a nadie de la fila por un mensaje que no se puede verificar. Cargalo en Mensajería → Configuración (Meta → Configuración → Básica → Clave secreta de la app).',
    }
  }
  const valida = webhook.ultima_valida_at ? Date.parse(webhook.ultima_valida_at) : NaN
  const invalida = webhook.ultima_invalida_at ? Date.parse(webhook.ultima_invalida_at) : NaN
  const validaReciente = Number.isFinite(valida) && ahoraMs - valida <= VENTANA_FIRMA_MS
  const invalidaReciente = Number.isFinite(invalida) && ahoraMs - invalida <= VENTANA_FIRMA_MS
  if (validaReciente && !(invalidaReciente && invalida > valida)) {
    return { texto: 'Respuestas verificadas con la firma de Meta', tono: 'ok', detalle: null }
  }
  if (validaReciente) {
    return {
      texto: 'Algunos mensajes llegan con una firma que no coincide',
      tono: 'espera',
      detalle:
        'La mayoría verifica, pero el último no. Si se repite, revisá que el App Secret guardado sea el de la app de Meta que manda los mensajes.',
    }
  }
  if (invalidaReciente) {
    return {
      texto: 'La firma de Meta no coincide con el App Secret guardado',
      tono: 'error',
      detalle:
        'Ningún mensaje de las últimas 24 h verificó. Revisá el App Secret en Mensajería → Configuración: tiene que ser la clave secreta de la misma app de Meta que tiene conectado el número.',
    }
  }
  return {
    texto: 'Todavía no entró ningún mensaje verificado',
    tono: 'espera',
    detalle: 'Apenas entre un mensaje de WhatsApp (o el acuse de uno que mandamos) se ve acá.',
  }
}
