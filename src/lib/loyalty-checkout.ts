/**
 * Helpers PLANOS (sin 'use server') del programa de fidelización en el COBRO.
 * Los comparten los server actions (queue.ts, rewards.ts, visit-history.ts) y
 * los componentes del panel del barbero.
 *
 * Acá NO vive ninguna regla de negocio: umbrales, multiplicadores, colores y
 * nombres de categoría vienen SIEMPRE del server (`loyalty_tiers` y las RPC de
 * la mig 197). Este módulo sólo sabe parsear lo que se escanea, traducir códigos
 * de error a español y calcular el descuento que la tablet muestra ANTES de
 * confirmar (la autoridad final es la RPC dentro de completeService).
 */

// ─── QR de invitación (referidos) ───────────────────────────────────────────

/** Prefijo del QR de "Invitá a un amigo" que genera la app (mig 196, clients.referral_code). */
export const REFERRAL_QR_PREFIX = 'MNC-REF:'

/**
 * Alfabeto del código de invitación tal como lo genera `loyalty_generate_referral_code`
 * (mig 197): 8 chars, sin I / O / 0 / 1. Se usa sólo para reconocer un código
 * tipeado "pelado" (sin prefijo): un QR de beneficio son 32 hex, así que 8 chars
 * de este alfabeto nunca son un cupón.
 */
export const REFERRAL_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/

/** ¿El texto escaneado/tipeado es un QR de invitación? (prefijo, case-insensitive). */
export function isReferralQr(raw: string | null | undefined): boolean {
  return (raw ?? '').trim().toUpperCase().startsWith(REFERRAL_QR_PREFIX)
}

/**
 * Extrae el código (en MAYÚSCULAS) de un QR "MNC-REF:<código>". Devuelve null si
 * no lleva el prefijo o si lo que sigue no tiene forma de código. La validación
 * de existencia/vigencia la hace la RPC `validate_referral_for_checkout`.
 */
export function parseReferralQr(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!isReferralQr(s)) return null
  const code = s.slice(REFERRAL_QR_PREFIX.length).trim().toUpperCase()
  return /^[A-Z0-9]{4,16}$/.test(code) ? code : null
}

/** Arma el payload canónico del QR de invitación a partir de un código. */
export function buildReferralQr(code: string): string {
  return REFERRAL_QR_PREFIX + code.trim().toUpperCase()
}

/**
 * Normaliza lo que el barbero escaneó o tipeó en el diálogo:
 *  - "mnc-ref:abcd2345" → "MNC-REF:ABCD2345"
 *  - "ABCD2345" (código de invitación pelado) → "MNC-REF:ABCD2345"
 *  - cualquier otra cosa (QR hex de beneficio) → tal cual, sin tocar.
 */
export function normalizeBenefitInput(raw: string): string {
  const s = raw.trim()
  if (isReferralQr(s)) return buildReferralQr(s.slice(REFERRAL_QR_PREFIX.length))
  const up = s.toUpperCase()
  if (REFERRAL_CODE_RE.test(up)) return buildReferralQr(up)
  return s
}

// ─── Mensajes de error (códigos de las RPC → español) ───────────────────────

/** Códigos de `validate_referral_for_checkout` / `apply_referral_for_visit`. */
const REFERRAL_ERROR_MESSAGES: Record<string, string> = {
  referral_disabled: 'El programa de referidos no está activo',
  referral_expired: 'La promoción de invitaciones ya no está vigente',
  code_not_found: 'Ese código de invitación no existe',
  client_required: 'Identificá al cliente antes de escanear una invitación',
  self_referral: 'No podés usar tu propia invitación',
  not_new_client: 'Este beneficio es exclusivo para nuevos clientes',
  already_referred: 'Este cliente ya usó una invitación',
  referrer_limit: 'Quien invita ya alcanzó el máximo de invitaciones',
  no_stacking: 'Este servicio ya tiene un beneficio aplicado',
  visit_not_found: 'No se encontró la visita',
}

export function referralErrorMessage(code: string | null | undefined): string {
  return (code && REFERRAL_ERROR_MESSAGES[code]) || 'No se pudo aplicar la invitación'
}

/** Nombres de los días ISO (1 = lunes … 7 = domingo), para las frases de canje. */
export const DIAS_ES = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** Frase legible de los días permitidos: [1,2,3] → "de lunes a miércoles". */
export function weekdayPhrase(days: number[]): string {
  const s = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b)
  if (s.length === 0) return 'ningún día'
  if (s.length === 1) return `los ${DIAS_ES[s[0]]}`
  const contiguo = s.every((d, i) => i === 0 || d === s[i - 1] + 1)
  if (contiguo) return `de ${DIAS_ES[s[0]]} a ${DIAS_ES[s[s.length - 1]]}`
  return s.slice(0, -1).map((d) => DIAS_ES[d]).join(', ') + ' y ' + DIAS_ES[s[s.length - 1]]
}

/**
 * Datos extra que `redeem_coupon_for_visit` adjunta a algunos rechazos: los días
 * permitidos (`wrong_weekday`) y el servicio al que aplica el premio (`wrong_service`).
 * Vienen de la RPC, no se asumen: "de lunes a miércoles" era un texto fijo que
 * mentía en cuanto el dueño cambiaba los días del premio.
 */
export interface CouponErrorExtra {
  allowed_weekdays?: number[] | null
  service_name?: string | null
}

/** Códigos de `redeem_coupon_for_visit` → texto para el barbero. */
export function couponErrorMessage(code: string | null | undefined, extra?: CouponErrorExtra): string {
  switch (code) {
    case 'wrong_client': return 'El cupón pertenece a otro cliente'
    case 'wrong_org': return 'El cupón es de otra organización'
    case 'already_redeemed': return 'El cupón ya fue canjeado'
    case 'expired': return 'El cupón está vencido'
    case 'not_found': return 'Cupón no encontrado'
    case 'not_available': return 'El cupón no está disponible'
    case 'no_discount': return 'El cupón no tiene descuento aplicable'
    case 'not_active_yet': return 'El cupón todavía no está activo (se activa un rato después de crear la cuenta)'
    case 'wrong_weekday': {
      const d = extra?.allowed_weekdays
      return Array.isArray(d) && d.length > 0
        ? `Este beneficio sólo se canjea ${weekdayPhrase(d)}`
        : 'Este beneficio no se puede canjear hoy'
    }
    case 'visit_not_found': return 'No se encontró la visita'
    // Programa de fidelización (mig 196/197): estado cancelado, servicio acotado y acumulación.
    case 'cancelled': return 'Este beneficio fue cancelado'
    case 'wrong_service':
      return extra?.service_name
        ? `Este beneficio es para ${extra.service_name}`
        : 'Este beneficio es para otro servicio'
    case 'no_stacking': return 'Este servicio ya tiene un beneficio aplicado'
    default: return 'No se pudo aplicar el cupón'
  }
}

/** Códigos de `deliver_reward_by_qr` (entrega de merch/especial sin cobro) → texto. */
const DELIVERY_ERROR_MESSAGES: Record<string, string> = {
  not_found: 'Beneficio no encontrado',
  wrong_org: 'Este beneficio es de otra organización',
  already_redeemed: 'Este beneficio ya fue usado',
  cancelled: 'Este beneficio fue cancelado',
  expired: 'El beneficio está vencido',
  not_available: 'El beneficio no está disponible',
  needs_checkout: 'Este beneficio se aplica en el cobro, no es una entrega',
}

export function deliveryErrorMessage(code: string | null | undefined): string {
  return (code && DELIVERY_ERROR_MESSAGES[code]) || 'No se pudo registrar la entrega'
}

// ─── Beneficio aplicado en el cobro (estado de la tablet) ───────────────────

/** `reward_catalog.kind` (mig 196). */
export type RewardKind = 'descuento' | 'merch' | 'especial'

/** Cupón/beneficio validado (todavía no consumido). Lo devuelve `validateCouponForCheckout`. */
export interface CheckoutCouponInfo {
  clientRewardId: string
  rewardName: string | null
  discountPct: number | null
  isFreeService: boolean
  kind: RewardKind
  /** Servicio al que aplica el descuento (null = cualquiera). */
  serviceId: string | null
  /** Nombre de ese servicio, para decir "es para Corte" antes de cobrar. */
  serviceName: string | null
  /**
   * Precio VIGENTE de ese servicio (null si el premio no está acotado). Es la base
   * del descuento en la RPC (mig 203): un "Corte gratis" descuenta el corte, no
   * la barba ni los extras. La tablet lo usa para que la previa coincida.
   */
  servicePrice: number | null
  allowStacking: boolean
}

/** Invitación validada (todavía no aplicada). Lo devuelve `validateBenefitQrForCheckout`. */
export interface CheckoutReferralInfo {
  code: string
  referrerFirstName: string | null
  discountPct: number
  referredPoints: number
  referrerPoints: number
}

/**
 * Lo que la tablet tiene "aplicado" mientras arma el cobro. `qrCode` es lo que
 * viaja a `completeService` como `couponQrCode`: el hex del beneficio, o el raw
 * "MNC-REF:CODIGO" de la invitación (el server lo distingue por prefijo).
 */
export type AppliedBenefit =
  | {
      kind: 'coupon'
      qrCode: string
      clientRewardId: string
      rewardName: string | null
      discountPct: number | null
      isFreeService: boolean
      rewardKind: RewardKind
      /** Servicio al que está acotado el premio (null = cualquiera). */
      serviceId: string | null
      serviceName: string | null
      /** Precio vigente del servicio acotado: base del descuento (mig 203). */
      servicePrice: number | null
      allowStacking: boolean
    }
  | {
      kind: 'referral'
      qrCode: string
      code: string
      referrerFirstName: string | null
      discountPct: number
      referredPoints: number
      referrerPoints: number
    }

/** % de descuento que aplica el beneficio sobre los SERVICIOS (merch/especial = 0). */
export function benefitDiscountPct(b: AppliedBenefit | null | undefined): number {
  if (!b) return 0
  if (b.kind === 'referral') return Math.max(0, Math.min(100, b.discountPct))
  if (b.rewardKind !== 'descuento') return 0
  if (b.isFreeService) return 100
  return Math.max(0, Math.min(100, b.discountPct ?? 0))
}

/**
 * Descuento en pesos que la tablet muestra antes de confirmar. Misma fórmula que
 * las RPC (`round(base * pct / 100)`), sobre el subtotal de SERVICIOS: nunca
 * productos ni propina. Si el premio está acotado a un servicio, la base es el
 * precio vigente de ESE servicio (mig 203), con tope en el subtotal.
 */
export function benefitDiscountAmount(
  b: AppliedBenefit | null | undefined,
  serviceSubtotal: number,
  // Precio del servicio LOCAL que matchea (homónimos entre sucursales, mig 205):
  // si viene, es la base real del descuento en esta sucursal y le gana al precio
  // del servicio del catálogo.
  basePrecioLocal?: number | null,
): number {
  const pct = benefitDiscountPct(b)
  if (pct <= 0 || serviceSubtotal <= 0) return 0
  // Precio 0 es un dato, no "sin dato": base 0 → descuento $0, igual que la RPC
  // (v_base = LEAST(precio, subtotal) → no_discount, sólo el NULL tiene fallback).
  // Descartarlo con `> 0` hacía caer la previa al subtotal y prometía un
  // descuento que la RPC después rechaza cobrando el precio lleno.
  const local = basePrecioLocal ?? null
  const scoped = local ?? (b?.kind === 'coupon' && b.servicePrice != null ? b.servicePrice : null)
  const base = scoped != null ? Math.min(serviceSubtotal, scoped) : serviceSubtotal
  return Math.min(Math.round(base * (pct / 100)), serviceSubtotal)
}

/**
 * ¿El beneficio aplica a los servicios elegidos? Espeja el guard `wrong_service`
 * de `redeem_coupon_for_visit`: sólo se rechaza cuando el premio está acotado a
 * un servicio, hay servicio principal, y ese servicio no es ni el principal ni
 * un extra. Sin servicio principal la RPC no chequea (tampoco acá).
 */
/** Pliega un nombre de servicio para comparar homónimos entre sucursales:
 *  minúsculas + sin acentos + trim. OJO: `norm_text` en SQL es lower(unaccent(t))
 *  y NO trimea — el criterio compartido con `redeem_coupon_for_visit` es
 *  `norm_text(btrim(…))`, y el .trim() de acá espeja ese btrim del lado de la
 *  RPC (sin el btrim en SQL, un nombre con espacio final —hay dos en Rondeau—
 *  matchea en la previa y la RPC contesta wrong_service). */
export function normalizarNombreServicio(nombre: string | null | undefined): string {
  return (nombre ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

export interface ServicioDelCobro {
  id: string
  name: string
  price: number | null
}

/**
 * Resuelve el servicio del cobro al que aplica un beneficio acotado. Los
 * servicios HOMÓNIMOS de otra sucursal cuentan como el mismo servicio (el
 * editor del catálogo los agrupa por nombre y la RPC `redeem_coupon_for_visit`
 * los acepta desde la mig 205): primero se busca por id exacto y después por
 *  nombre normalizado. Devuelve el servicio local que matchea (su precio es la
 * base real del descuento en ESTA sucursal) o null si el beneficio no aplica.
 */
export function servicioQueMatcheaBeneficio(
  b: AppliedBenefit | null | undefined,
  servicios: readonly ServicioDelCobro[],
): ServicioDelCobro | null {
  if (!b || b.kind !== 'coupon' || !b.serviceId) return null
  const porId = servicios.find((s) => s.id === b.serviceId)
  if (porId) return porId
  const objetivo = normalizarNombreServicio(b.serviceName)
  if (!objetivo) return null
  return servicios.find((s) => normalizarNombreServicio(s.name) === objetivo) ?? null
}

export function benefitAppliesToServices(
  b: AppliedBenefit | null | undefined,
  mainServiceId: string | null | undefined,
  extraServiceIds: readonly string[],
  servicios?: readonly ServicioDelCobro[],
): boolean {
  if (!b || b.kind !== 'coupon' || !b.serviceId || !mainServiceId) return true
  if (b.serviceId === mainServiceId || extraServiceIds.includes(b.serviceId)) return true
  // Homónimos entre sucursales (mig 205): si tenemos los nombres, un servicio
  // con el mismo nombre normalizado también cuenta.
  if (servicios && servicios.length > 0) return servicioQueMatcheaBeneficio(b, servicios) !== null
  return false
}

// ─── Resultado de loyalty_finalize_visit (jsonb, mig 197) ───────────────────

export type LoyaltyTierChange = 'up' | 'enrolled' | 'grace' | 'down' | 'recovered'

const TIER_CHANGES: readonly LoyaltyTierChange[] = ['up', 'enrolled', 'grace', 'down', 'recovered']

/**
 * Normaliza lo que trae `tier_changed`: desde la mig 203 la RPC lo deriva de los
 * eventos de la visita (el trigger ya había hecho la transición antes de que
 * finalize corriera), así que puede venir cualquiera de los cinco valores. Todo
 * lo que no sea uno de ellos se trata como "visita normal".
 */
export function asTierChange(value: unknown): LoyaltyTierChange | null {
  return typeof value === 'string' && (TIER_CHANGES as readonly string[]).includes(value)
    ? (value as LoyaltyTierChange)
    : null
}

export interface LoyaltyFinalizeResult {
  enabled: boolean
  /** Sólo cuando enabled = false: 'no_client' | 'disabled' | 'not_qualifying'. */
  reason?: string | null
  points_earned?: number | null
  balance?: number | null
  tier_code?: string | null
  tier_name?: string | null
  tier_color_primary?: string | null
  tier_color_secondary?: string | null
  tier_text_color?: string | null
  tier_changed?: LoyaltyTierChange | null
  visits_in_window?: number | null
  next_tier_name?: string | null
  visits_to_next?: number | null
  multiplier_pct?: number | null
  /**
   * Agregados en TS por completeService cuando tier_changed = 'grace': la RPC no
   * devuelve la fecha límite y la tablet tiene que decir "le quedan X días".
   */
  grace_until?: string | null
  grace_days_left?: number | null
}

// ─── Categorías (lo mínimo que necesita la tablet para pintar un chip) ──────

/** Subconjunto de `loyalty_tiers` que lee la tablet (policy pública `loyalty_tiers_public_read`). */
export interface LoyaltyTierLite {
  code: string
  name: string
  color_primary: string
  color_secondary: string
  text_color: string
}

export function findLoyaltyTier(
  tiers: LoyaltyTierLite[] | null | undefined,
  code: string | null | undefined,
): LoyaltyTierLite | null {
  if (!tiers || !code) return null
  return tiers.find((t) => t.code === code) ?? null
}

/** Gradiente de la tarjeta/chip de categoría: 135°, primario → secundario. */
export function tierGradient(primary: string, secondary: string): string {
  return `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`
}

/** "7 visitas recientes" / "1 visita reciente". */
export function visitasRecientesLabel(n: number | null | undefined): string {
  const v = Math.max(0, Math.floor(n ?? 0))
  return v === 1 ? '1 visita reciente' : `${v} visitas recientes`
}
