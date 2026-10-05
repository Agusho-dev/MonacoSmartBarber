import 'server-only'

import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { isValidUUID } from '@/lib/validation'
import {
  BYTES_MAXIMOS_FOTO,
  MINUTOS_GRACIA_TRAS_COBRO,
  MINUTOS_SESION_FOTOS,
  TIPOS_FOTO_SUBIBLES,
  TOPE_FOTOS_POR_CORTE,
  type ErrorFotos,
  type EstadoSesionFotos,
  type FotoDeSesion,
  type FotosDeEntrada,
  type MotivoErrorFotos,
  type OrigenFoto,
  type RespuestaAbrirSesion,
  type RespuestaConfirmarSubida,
  type RespuestaEstadoFotos,
  type RespuestaPedirSubida,
  type RespuestaQuitarFoto,
  type RespuestaVincularFotos,
  type ResultadoFotosDelCobro,
  type SesionDeFotos,
} from '@/lib/types/fotos-corte'
import { TEXTO_CERRADA_SIN_VISITA, type EstadoCelular, type RespuestaDescartarFotos } from './contrato'
import { nombreCorto, primerNombre } from './textos'

/*
 * Fotos del corte, lado servidor (mig 219). Módulo plano —NO 'use server'—: lo
 * usan la ruta de la tablet (/api/fotos-corte/entradas/[id]), los server
 * actions de la página del celular y completeService. Un export de un archivo
 * 'use server' es un endpoint HTTP; nada de esto tiene que serlo por sí solo.
 *
 * El diseño, en una línea: los BYTES van del navegador directo a Storage con
 * una URL firmada (nunca por un server action: Next 16 los serializa y el cobro
 * quedaba esperando detrás de las fotos; además Vercel corta los cuerpos de más
 * de 4,5 MB), y todo lo que se ESCRIBE en la base pasa por las RPC de la 219,
 * que se serializan por entrada: una foto que llega durante el cobro no se
 * pierde, y una confirmación repetida no duplica nada.
 */

const BUCKET = 'visit-photos'

type Admin = ReturnType<typeof createAdminClient>

/** Un error con el HTTP status que tiene que devolver la ruta. */
export type ErrorFotosHttp = ErrorFotos & { status: number }

const TEXTO_SIN_ACCESO = 'No tenés acceso a esta sucursal.'
const TEXTO_SERVIDOR = 'No pudimos guardar la foto. Probá de nuevo.'

function falla(motivo: MotivoErrorFotos, error: string): ErrorFotos {
  return { ok: false, error, motivo }
}

/**
 * El mensaje de "sesión vencida" depende de por dónde entró: el panel del
 * barbero es PIN + cookie, el dashboard es email y contraseña (el cobro se usa
 * en los dos). Decirle "volvé a entrar con tu PIN" a alguien del dashboard lo
 * deja buscando un PIN que no tiene.
 */
async function mensajeDeSesionVencida(): Promise<string> {
  const cookieStore = await cookies()
  return cookieStore.get('barber_session')
    ? 'Tu sesión venció. Volvé a entrar con tu PIN.'
    : 'Tu sesión venció. Volvé a iniciar sesión.'
}

/** PostgREST/Postgres: la función todavía no existe (falta aplicar la 219). */
function esFuncionInexistente(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883'
}

/** PostgREST/Postgres: la columna todavía no existe (falta aplicar la 219). */
function esColumnaInexistente(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204'
}

// ─── Sesiones ────────────────────────────────────────────────────────────────

interface FilaSesion {
  id: string
  token: string
  organization_id: string
  queue_entry_id: string | null
  staff_id: string | null
  visit_id: string | null
  is_active: boolean | null
  expires_at: string | null
  closed_at: string | null
  proposito: string | null
  created_at: string | null
}

const COLUMNAS_SESION =
  'id, token, organization_id, queue_entry_id, staff_id, visit_id, is_active, expires_at, closed_at, proposito, created_at'

interface EstadoDeSesion {
  estado: EstadoSesionFotos
  aceptaFotos: boolean
  /** Cerrada SIN visita: el corte se cerró sin cobro (solo asesoría o cancelado). */
  sinVisita: boolean
}

/**
 * Estado de una sesión. Es la MISMA regla que aplica fotos_registrar_subida
 * (mig 219/219g) para aceptar o rechazar una foto; si cambia allá, cambia acá.
 * expires_at NULL cuenta como vencida.
 *
 * `entradaCancelada`: la entrada de la fila está cancelada (la asesoría que se
 * cierra sin cobro, o un corte cancelado). Sin visita no hay ficha donde
 * guardar nada: es "cerrada sin visita", que no es lo mismo que "venció" (se
 * arregla con otro QR) ni que "cerrada" con visita (¡Listo!). Se mira la
 * ENTRADA y no la sesión porque cerrarSoloAsesoria puede cerrar el corte sin
 * tocar la sesión (sigue activa) o desactivándola (parece vencida).
 */
function estadoDeSesion(fila: FilaSesion, entradaCancelada = false, ahora = Date.now()): EstadoDeSesion {
  if (fila.visit_id) {
    const cerradaEn = fila.closed_at ? new Date(fila.closed_at).getTime() : 0
    return { estado: 'cerrada', aceptaFotos: cerradaEn > ahora - MINUTOS_GRACIA_TRAS_COBRO * 60_000, sinVisita: false }
  }
  if (entradaCancelada) return { estado: 'cerrada', aceptaFotos: false, sinVisita: true }
  const vence = fila.expires_at ? new Date(fila.expires_at).getTime() : 0
  if (fila.is_active && vence > ahora) return { estado: 'activa', aceptaFotos: true, sinVisita: false }
  return { estado: 'vencida', aceptaFotos: false, sinVisita: false }
}

function aSesionDeFotos(fila: FilaSesion, entradaCancelada = false): SesionDeFotos {
  const { estado, aceptaFotos } = estadoDeSesion(fila, entradaCancelada)
  return {
    id: fila.id,
    // El token es la llave del celular: sólo viaja mientras sirve para algo.
    token: estado === 'activa' ? fila.token : null,
    estado,
    venceEn: fila.expires_at,
    aceptaFotos,
  }
}

/** La sesión que hay que mostrar / usar: la activa; si no, la cerrada que todavía acepta; si no, la última. */
function sesionVigente(filas: FilaSesion[], entradaCancelada = false): FilaSesion | null {
  if (filas.length === 0) return null
  const ordenadas = [...filas].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  return (
    ordenadas.find((f) => estadoDeSesion(f, entradaCancelada).estado === 'activa') ??
    ordenadas.find((f) => estadoDeSesion(f, entradaCancelada).aceptaFotos) ??
    ordenadas[0]
  )
}

/** queue_entries.status de una entrada cancelada (la asesoría cerrada sin cobro usa éste). */
const ESTADO_CANCELADA = 'cancelled'

/** La ruta de una foto de ESTA sesión: `<org>/<sesión>/…`, la única forma que firma el servidor. */
function esRutaDeLaSesion(ruta: string, organizationId: string, sesionId: string): boolean {
  return ruta.startsWith(`${organizationId}/${sesionId}/`)
}

function urlPublica(admin: Admin, ruta: string): string {
  return admin.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl
}

// ─── Acceso desde la tablet o el dashboard (cookies) ─────────────────────────

export interface EntradaFotos {
  id: string
  organizationId: string
  branchId: string
  clientId: string | null
  barberId: string | null
  status: string
}

/**
 * La misma puerta para el panel (cookie firmada del barbero) y el dashboard
 * (Supabase Auth): el diálogo de cobro se usa en las dos superficies. No exige
 * fichada abierta (getBarberSession sí): la org la resuelve getCurrentOrgId
 * contra `staff`, que corta a un empleado dado de baja, y el alcance de
 * sucursal lo da getScopedBranchIds (la cookie del barbero vale sólo para la suya).
 */
export async function resolverEntradaConAcceso(
  entradaId: string,
): Promise<{ ok: true; entrada: EntradaFotos; admin: Admin } | ErrorFotosHttp> {
  if (!isValidUUID(entradaId)) return { ...falla('datos', 'Corte inválido.'), status: 400 }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { ...falla('sesion', await mensajeDeSesionVencida()), status: 401 }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('queue_entries')
    .select('id, organization_id, branch_id, client_id, barber_id, status')
    .eq('id', entradaId)
    .maybeSingle()

  if (error) {
    console.error('[fotos-corte] leer entrada', { entradaId, message: error.message })
    return { ...falla('servidor', 'No pudimos leer el corte. Probá de nuevo.'), status: 503 }
  }
  if (!data || data.organization_id !== orgId) {
    return { ...falla('entrada', 'No encontramos ese corte.'), status: 404 }
  }

  const permitidas = await getScopedBranchIds()
  if (!permitidas.includes(data.branch_id as string)) {
    return { ...falla('acceso', TEXTO_SIN_ACCESO), status: 403 }
  }

  return {
    ok: true,
    admin,
    entrada: {
      id: data.id as string,
      organizationId: data.organization_id as string,
      branchId: data.branch_id as string,
      clientId: (data.client_id as string | null) ?? null,
      barberId: (data.barber_id as string | null) ?? null,
      status: String(data.status),
    },
  }
}

async function sesionesDeEntrada(
  admin: Admin,
  entrada: EntradaFotos,
): Promise<{ ok: true; filas: FilaSesion[] } | ErrorFotos> {
  const { data, error } = await admin
    .from('qr_photo_sessions')
    .select(COLUMNAS_SESION)
    .eq('queue_entry_id', entrada.id)
    .eq('proposito', 'fotos')
    .eq('organization_id', entrada.organizationId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[fotos-corte] leer sesiones', { entradaId: entrada.id, code: error.code, message: error.message })
    return falla('servidor', 'No pudimos leer las fotos de este corte. Probá de nuevo.')
  }
  return { ok: true, filas: (data ?? []) as FilaSesion[] }
}

interface FilaSubida {
  id: string
  session_id: string
  storage_path: string
  origen: string | null
  created_at: string
}

function aFotoDeSesion(admin: Admin, fila: FilaSubida): FotoDeSesion {
  return {
    id: fila.id,
    ruta: fila.storage_path,
    url: urlPublica(admin, fila.storage_path),
    origen: fila.origen === 'tablet' ? 'tablet' : 'celular',
    creadaEn: fila.created_at,
  }
}

/**
 * Las subidas de las sesiones de un cobro, sólo las que tienen la forma que
 * firma el servidor (`<org>/<su sesión>/…`). Una fila con otra forma no la
 * escribió ninguna RPC (la plantaba la anon key antes de la 219f): ni se
 * muestra en la tira ni se cuenta como foto del corte.
 */
async function subidasDeSesiones(
  admin: Admin,
  entrada: EntradaFotos,
  sesiones: FilaSesion[],
): Promise<{ ok: true; filas: FilaSubida[] } | ErrorFotos> {
  if (sesiones.length === 0) return { ok: true, filas: [] }
  const { data, error } = await admin
    .from('qr_photo_uploads')
    .select('id, session_id, storage_path, origen, created_at')
    .in('session_id', sesiones.map((s) => s.id))
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[fotos-corte] leer fotos', { entradaId: entrada.id, message: error.message })
    return falla('servidor', 'No pudimos leer las fotos de este corte. Probá de nuevo.')
  }
  const orgDeSesion = new Map(sesiones.map((s) => [s.id, s.organization_id]))
  const filas = ((data ?? []) as FilaSubida[]).filter((f) => {
    const org = orgDeSesion.get(f.session_id)
    return !!org && esRutaDeLaSesion(String(f.storage_path ?? ''), org, f.session_id)
  })
  return { ok: true, filas }
}

/** Las fotos de un cobro: la sesión vigente y todas las fotos de todas sus sesiones. */
export async function fotosDeEntrada(admin: Admin, entrada: EntradaFotos): Promise<RespuestaEstadoFotos> {
  const sesiones = await sesionesDeEntrada(admin, entrada)
  if (!sesiones.ok) return sesiones

  const subidas = await subidasDeSesiones(admin, entrada, sesiones.filas)
  if (!subidas.ok) return subidas
  const fotos: FotoDeSesion[] = subidas.filas.map((f) => aFotoDeSesion(admin, f))

  const cancelada = entrada.status === ESTADO_CANCELADA
  const vigente = sesionVigente(sesiones.filas, cancelada)
  const datos: FotosDeEntrada = {
    sesion: vigente ? aSesionDeFotos(vigente, cancelada) : null,
    fotos,
    tope: TOPE_FOTOS_POR_CORTE,
  }
  return { ok: true, datos }
}

/** Traduce el `motivo` de las RPC de la 219 a un error para la pantalla. */
function errorDeMotivo(motivo: unknown, contexto: 'tablet' | 'celular'): ErrorFotos {
  switch (motivo) {
    case 'entrada_inexistente':
      return falla('entrada', 'No encontramos ese corte.')
    case 'cobro_cerrado':
      return falla('cobro_cerrado', 'Este cobro ya se cerró: no se pueden sumar más fotos.')
    case 'cerrada_sin_cobro':
      // El corte se cerró sin cobro (solo asesoría): para la pantalla es un
      // cobro cerrado (no reintentable), con el texto que corresponde.
      return falla('cobro_cerrado', TEXTO_CERRADA_SIN_VISITA)
    case 'vencida':
      return falla(
        'vencida',
        contexto === 'celular'
          ? 'Este código venció. Generá uno nuevo desde la tablet.'
          : 'La sesión de fotos venció. Volvé a intentar.',
      )
    case 'tope':
      return falla('tope', `Llegaste al máximo de ${TOPE_FOTOS_POR_CORTE} fotos por corte.`)
    default:
      return falla('datos', 'La foto no corresponde a este corte.')
  }
}

/**
 * Abre la sesión de fotos del cobro, o retoma la que ya está activa (RPC de la
 * 219). Desde la 219g, retomar también la RENUEVA (vence MINUTOS_SESION_FOTOS
 * desde ahora): el QR que se muestra nunca sale con segundos de vida.
 */
export async function abrirSesionDeFotos(admin: Admin, entrada: EntradaFotos): Promise<RespuestaAbrirSesion> {
  const r = await abrirFila(admin, entrada)
  if (!r.ok) return r
  return { ok: true, sesion: aSesionDeFotos(r.fila) }
}

async function abrirFila(admin: Admin, entrada: EntradaFotos): Promise<{ ok: true; fila: FilaSesion } | ErrorFotos> {
  if (entrada.status === ESTADO_CANCELADA) return errorDeMotivo('cerrada_sin_cobro', 'tablet')

  const { data, error } = await admin.rpc('fotos_abrir_sesion', {
    p_organization_id: entrada.organizationId,
    p_queue_entry_id: entrada.id,
    p_minutos: MINUTOS_SESION_FOTOS,
    p_gracia_minutos: MINUTOS_GRACIA_TRAS_COBRO,
  })

  if (error) {
    console.error('[fotos-corte] fotos_abrir_sesion', {
      entradaId: entrada.id,
      code: error.code,
      message: error.message,
      faltaMigracion: esFuncionInexistente(error),
    })
    return falla('servidor', 'No pudimos preparar las fotos. Probá de nuevo.')
  }

  const r = (data ?? {}) as { ok?: boolean; motivo?: string; sesion?: Partial<FilaSesion> }
  if (!r.ok || !r.sesion?.id) return errorDeMotivo(r.motivo, 'tablet')

  // La 219g devuelve la org de la sesión: tiene que ser la de la entrada (la
  // ruta de cada foto se arma con ella). Antes de la 219g no viene.
  if (r.sesion.organization_id && r.sesion.organization_id !== entrada.organizationId) {
    console.error('[fotos-corte] fotos_abrir_sesion devolvió una sesión de otra organización', {
      entradaId: entrada.id,
      sesionId: r.sesion.id,
    })
    return falla('servidor', 'No pudimos preparar las fotos. Probá de nuevo.')
  }

  const fila: FilaSesion = {
    id: String(r.sesion.id),
    token: String(r.sesion.token ?? ''),
    organization_id: entrada.organizationId,
    queue_entry_id: entrada.id,
    staff_id: entrada.barberId,
    visit_id: (r.sesion.visit_id as string | null) ?? null,
    is_active: (r.sesion.is_active as boolean | null) ?? null,
    expires_at: (r.sesion.expires_at as string | null) ?? null,
    closed_at: (r.sesion.closed_at as string | null) ?? null,
    proposito: 'fotos',
    created_at: null,
  }
  return { ok: true, fila }
}

// ─── Subida: URL firmada ─────────────────────────────────────────────────────

/** Lo que el navegador declara de la foto ya comprimida. */
export interface ArchivoDeclarado {
  contentType: string
  bytes: number
}

function validarArchivo(archivo: ArchivoDeclarado): ErrorFotos | null {
  const tipo = String(archivo?.contentType ?? '').toLowerCase()
  if (!(TIPOS_FOTO_SUBIBLES as readonly string[]).includes(tipo)) {
    return falla('formato', 'Ese formato no se puede subir. Sacá la foto con la cámara o elegí otra.')
  }
  const bytes = Number(archivo?.bytes)
  if (!Number.isFinite(bytes) || bytes <= 0) return falla('datos', 'La foto llegó vacía. Probá de nuevo.')
  if (bytes > BYTES_MAXIMOS_FOTO) return falla('pesada', 'La foto es muy pesada. Probá con otra.')
  return null
}

function extensionDeTipo(tipo: string): 'webp' | 'jpg' {
  return tipo === 'image/webp' ? 'webp' : 'jpg'
}

async function contarFotosDeEntrada(admin: Admin, entradaId: string): Promise<number | null> {
  const { count, error } = await admin
    .from('qr_photo_uploads')
    .select('id, qr_photo_sessions!inner(queue_entry_id, proposito)', { count: 'exact', head: true })
    .eq('qr_photo_sessions.queue_entry_id', entradaId)
    .eq('qr_photo_sessions.proposito', 'fotos')
  if (error) {
    console.error('[fotos-corte] contar fotos', { entradaId, message: error.message })
    return null
  }
  return count ?? 0
}

/**
 * Firma una URL de subida para UNA foto. La ruta la arma el servidor
 * (`<org>/<sesión>/<uuid>.<ext>`): no lleva el token (antes `qr-<token>/…`
 * dejaba el token del QR en cada URL pública) y el navegador no elige nada.
 * La URL dura 2 h y sólo sirve para esa ruta, sin sobrescribir.
 */
async function firmarSubida(admin: Admin, sesion: FilaSesion, tipo: string): Promise<RespuestaPedirSubida> {
  const ruta = `${sesion.organization_id}/${sesion.id}/${randomUUID()}.${extensionDeTipo(tipo)}`
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(ruta)
  if (error || !data?.signedUrl) {
    console.error('[fotos-corte] createSignedUploadUrl', { sesionId: sesion.id, message: error?.message })
    return falla('servidor', 'No pudimos preparar la subida. Probá de nuevo.')
  }
  return { ok: true, subida: { ruta, url: data.signedUrl, sesion: aSesionDeFotos(sesion) } }
}

/**
 * Autoriza una subida desde la tablet o el dashboard. Usa la sesión activa del
 * cobro; si ya se cobró, la cerrada que todavía acepta (la foto que se sacó
 * justo antes de tocar Cobrar); y si no hay ninguna, la abre.
 */
export async function autorizarSubidaDeEntrada(
  admin: Admin,
  entrada: EntradaFotos,
  archivo: ArchivoDeclarado,
): Promise<RespuestaPedirSubida> {
  const invalido = validarArchivo(archivo)
  if (invalido) return invalido
  // Cerrado sin cobro (solo asesoría): ni se firma, así no queda un objeto huérfano.
  if (entrada.status === ESTADO_CANCELADA) return errorDeMotivo('cerrada_sin_cobro', 'tablet')

  const sesiones = await sesionesDeEntrada(admin, entrada)
  if (!sesiones.ok) return sesiones

  let sesion =
    sesiones.filas.find((f) => estadoDeSesion(f).estado === 'activa') ??
    sesiones.filas.find((f) => estadoDeSesion(f).aceptaFotos) ??
    null

  if (!sesion) {
    const abierta = await abrirFila(admin, entrada)
    if (!abierta.ok) return abierta
    sesion = abierta.fila
  }

  // Aviso temprano del tope (la base es la que manda: fotos_registrar_subida
  // rechaza la foto 13 aunque dos subidas se crucen acá).
  const cantidad = await contarFotosDeEntrada(admin, entrada.id)
  if (cantidad !== null && cantidad >= TOPE_FOTOS_POR_CORTE) return errorDeMotivo('tope', 'tablet')

  return firmarSubida(admin, sesion, String(archivo.contentType).toLowerCase())
}

// ─── Confirmación ────────────────────────────────────────────────────────────

const RUTA_DE_FOTO = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(webp|jpg)$/

type Inspeccion =
  | { existe: false }
  | { existe: true; tipo: string; bytes: number | null; firma: 'jpeg' | 'png' | 'webp' | null }

/** Qué formato dicen los primeros bytes (no la extensión ni el header, que los pone el que sube). */
function firmaDeImagen(b: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'webp'
  }
  return null
}

/**
 * Mira el objeto en Storage con UNA lectura de 16 bytes (Range): de ahí salen
 * el tipo con que quedó guardado, el tamaño total (Content-Range) y la firma
 * real de los bytes. El header de la subida lo pone el navegador; los bytes no
 * mienten. Lanza ante un error de red: eso es "reintentá", no "no existe".
 */
async function inspeccionarObjeto(ruta: string): Promise<Inspeccion> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !clave) throw new Error('faltan las variables de Supabase')

  const controlador = new AbortController()
  const temporizador = setTimeout(() => controlador.abort(), 8_000)
  try {
    const res = await fetch(`${base}/storage/v1/object/authenticated/${BUCKET}/${ruta}`, {
      headers: { apikey: clave, Authorization: `Bearer ${clave}`, Range: 'bytes=0-15' },
      cache: 'no-store',
      signal: controlador.signal,
    })
    if (res.status === 404) return { existe: false }
    if (res.status === 400) {
      // Storage contesta 400 + {"error":"not_found"} para un objeto que no está.
      const cuerpo = await res.text().catch(() => '')
      if (/not[_ ]?found/i.test(cuerpo)) return { existe: false }
      throw new Error(`storage 400: ${cuerpo.slice(0, 200)}`)
    }
    if (!res.ok) throw new Error(`storage ${res.status}`)

    const bytes = new Uint8Array(await res.arrayBuffer())
    const rango = res.headers.get('content-range') // "bytes 0-15/123456"
    const total = rango?.split('/')[1]
    const largo = total && total !== '*' ? Number(total) : Number(res.headers.get('content-length'))
    return {
      existe: true,
      tipo: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(),
      bytes: Number.isFinite(largo) && largo > 0 ? largo : null,
      firma: firmaDeImagen(bytes),
    }
  } finally {
    clearTimeout(temporizador)
  }
}

async function borrarObjeto(admin: Admin, ruta: string, motivo: string): Promise<void> {
  const { error } = await admin.storage.from(BUCKET).remove([ruta])
  if (error) console.error('[fotos-corte] no se pudo borrar un objeto rechazado', { ruta, motivo, message: error.message })
}

const TIPO_DE_FIRMA: Record<'jpeg' | 'png' | 'webp', string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

async function confirmarEnSesion(
  admin: Admin,
  sesion: FilaSesion,
  ruta: string,
  origen: OrigenFoto,
  contexto: 'tablet' | 'celular',
): Promise<RespuestaConfirmarSubida> {
  let inspeccion: Inspeccion
  try {
    inspeccion = await inspeccionarObjeto(ruta)
  } catch (e) {
    console.error('[fotos-corte] inspeccionar objeto', { ruta, error: e instanceof Error ? e.message : String(e) })
    return falla('servidor', TEXTO_SERVIDOR)
  }

  if (!inspeccion.existe) {
    return falla('no_subida', 'La foto no llegó a subirse. Probá de nuevo.')
  }

  // Lo que se guardó tiene que ser de verdad una imagen del tipo declarado.
  const tipoReal = inspeccion.firma ? TIPO_DE_FIRMA[inspeccion.firma] : null
  if (!tipoReal || !(TIPOS_FOTO_SUBIBLES as readonly string[]).includes(tipoReal) || tipoReal !== inspeccion.tipo) {
    await borrarObjeto(admin, ruta, 'formato')
    return falla('formato', 'Ese formato no se puede subir. Sacá la foto con la cámara o elegí otra.')
  }
  if (inspeccion.bytes !== null && inspeccion.bytes > BYTES_MAXIMOS_FOTO) {
    await borrarObjeto(admin, ruta, 'pesada')
    return falla('pesada', 'La foto es muy pesada. Probá con otra.')
  }

  const { data, error } = await admin.rpc('fotos_registrar_subida', {
    p_session_id: sesion.id,
    p_storage_path: ruta,
    p_origen: origen,
    p_content_type: tipoReal,
    p_bytes: inspeccion.bytes ?? 0,
    p_tope: TOPE_FOTOS_POR_CORTE,
    p_gracia_minutos: MINUTOS_GRACIA_TRAS_COBRO,
  })

  if (error) {
    // Puede haber quedado registrada (timeout con la transacción confirmada):
    // el objeto NO se borra. Reintentar es seguro (la confirmación es idempotente).
    console.error('[fotos-corte] fotos_registrar_subida', { ruta, code: error.code, message: error.message })
    return falla('servidor', TEXTO_SERVIDOR)
  }

  const r = (data ?? {}) as {
    ok?: boolean
    motivo?: string
    upload_id?: string
    creada_en?: string
    vinculada?: boolean
    fotos_en_visita?: number | null
  }
  if (!r.ok || !r.upload_id) {
    // No quedó registrada: el objeto sería un huérfano público. Se borra.
    await borrarObjeto(admin, ruta, String(r.motivo))
    return errorDeMotivo(r.motivo, contexto)
  }

  return {
    ok: true,
    foto: {
      id: r.upload_id,
      ruta,
      url: urlPublica(admin, ruta),
      origen,
      creadaEn: r.creada_en ?? new Date().toISOString(),
    },
    vinculada: !!r.vinculada,
    fotosEnVisita: typeof r.fotos_en_visita === 'number' ? r.fotos_en_visita : null,
  }
}

async function leerSesion(admin: Admin, columna: 'id' | 'token', valor: string): Promise<FilaSesion | null | 'error'> {
  const { data, error } = await admin.from('qr_photo_sessions').select(COLUMNAS_SESION).eq(columna, valor).maybeSingle()
  if (error) {
    console.error('[fotos-corte] leer sesión', { columna, code: error.code, message: error.message })
    return 'error'
  }
  return (data as FilaSesion | null) ?? null
}

/** Confirma una foto que la tablet (o el dashboard) ya subió a Storage. */
export async function confirmarSubidaDeEntrada(
  admin: Admin,
  entrada: EntradaFotos,
  ruta: string,
): Promise<RespuestaConfirmarSubida> {
  const partes = RUTA_DE_FOTO.exec(String(ruta ?? ''))
  if (!partes || partes[1] !== entrada.organizationId) return falla('datos', 'La foto no corresponde a este corte.')

  const sesion = await leerSesion(admin, 'id', partes[2])
  if (sesion === 'error') return falla('servidor', TEXTO_SERVIDOR)
  if (
    !sesion ||
    sesion.queue_entry_id !== entrada.id ||
    sesion.proposito !== 'fotos' ||
    sesion.organization_id !== entrada.organizationId
  ) {
    return falla('datos', 'La foto no corresponde a este corte.')
  }
  return confirmarEnSesion(admin, sesion, partes[0], 'tablet', 'tablet')
}

/**
 * ¿La sesión `sesionId` es una sesión de fotos de ESTA entrada (y de su org)?
 * Sirve para no borrar de Storage, con service role, un objeto que no es de
 * este cobro.
 */
async function esSesionDeLaEntrada(admin: Admin, entrada: EntradaFotos, sesionId: string): Promise<boolean | 'error'> {
  const sesion = await leerSesion(admin, 'id', sesionId)
  if (sesion === 'error') return 'error'
  return (
    !!sesion &&
    sesion.queue_entry_id === entrada.id &&
    sesion.proposito === 'fotos' &&
    sesion.organization_id === entrada.organizationId
  )
}

/**
 * Quita una foto de un cobro todavía abierto (o atado hace menos de los
 * minutos de gracia: desde la 219g la RPC la saca también de la ficha): la
 * fila primero y después el objeto.
 *
 * El objeto se borra sólo si la ruta es de una sesión de ESTA entrada
 * (`<org>/<sesión>/<uuid>.<ext>`). La RPC de la 219g ya no devuelve una ruta
 * ajena; esto es la segunda llave por si corre con la 219 (que sí la devolvía:
 * una fila plantada con la ruta de una foto vieja hacía borrar el objeto real).
 */
export async function quitarFotoDeEntrada(
  admin: Admin,
  entrada: EntradaFotos,
  fotoId: string,
): Promise<RespuestaQuitarFoto> {
  if (!isValidUUID(fotoId)) return falla('datos', 'Foto inválida.')

  const { data, error } = await admin.rpc('fotos_quitar_foto', {
    p_queue_entry_id: entrada.id,
    p_upload_id: fotoId,
  })
  if (error) {
    console.error('[fotos-corte] fotos_quitar_foto', { fotoId, code: error.code, message: error.message })
    return falla('servidor', 'No pudimos quitar la foto. Probá de nuevo.')
  }

  const r = (data ?? {}) as {
    ok?: boolean
    motivo?: string
    storage_path?: string | null
    session_id?: string | null
    ruta_invalida?: boolean
  }
  // Ya no estaba (se quitó desde otra pantalla o se reintentó): el pedido se cumplió.
  if (!r.ok && r.motivo === 'no_existe') return { ok: true, quitada: true }
  if (!r.ok) {
    return r.motivo === 'cobro_cerrado'
      ? falla('cobro_cerrado', 'Esa foto ya quedó guardada en la ficha del cliente.')
      : falla('datos', 'No pudimos quitar la foto.')
  }

  if (r.storage_path) {
    const ruta = String(r.storage_path)
    const partes = RUTA_DE_FOTO.exec(ruta)
    let deEstaEntrada = false
    if (partes && partes[1] === entrada.organizationId) {
      if (r.session_id) {
        deEstaEntrada = partes[2] === r.session_id
      } else {
        // La RPC de la 219 no devuelve la sesión: se mira en la base.
        const propia = await esSesionDeLaEntrada(admin, entrada, partes[2])
        deEstaEntrada = propia === true
        if (propia === 'error') console.error('[fotos-corte] no se pudo verificar la ruta antes de borrarla', { fotoId })
      }
    }
    if (deEstaEntrada) {
      await borrarObjeto(admin, ruta, 'quitada por el barbero')
    } else {
      // La fila ya no está; el objeto (si es de alguien) no se toca.
      console.warn('[fotos-corte] foto quitada con una ruta que no es de este cobro: no se borra el objeto', { fotoId, ruta })
    }
  }
  return { ok: true, quitada: true }
}

async function subidaPorRuta(admin: Admin, ruta: string): Promise<{ id: string } | null | 'error'> {
  const { data, error } = await admin.from('qr_photo_uploads').select('id').eq('storage_path', ruta).maybeSingle()
  if (error) {
    console.error('[fotos-corte] buscar subida por ruta', { ruta, message: error.message })
    return 'error'
  }
  return (data as { id: string } | null) ?? null
}

/**
 * Descarta una foto que el barbero quitó con los bytes ya en Storage y SIN
 * confirmar (store: 'descartar'). Nunca la registra: borra el objeto, que si
 * no quedaba huérfano en un bucket público. Si una confirmación que se cortó
 * llegó a registrarla, se quita como cualquier otra (misma RPC y mismas
 * reglas: antes del cobro o dentro de la gracia).
 */
export async function descartarSubidaDeEntrada(
  admin: Admin,
  entrada: EntradaFotos,
  ruta: string,
): Promise<RespuestaQuitarFoto> {
  const partes = RUTA_DE_FOTO.exec(String(ruta ?? ''))
  if (!partes || partes[1] !== entrada.organizationId) return falla('datos', 'La foto no corresponde a este corte.')
  const propia = await esSesionDeLaEntrada(admin, entrada, partes[2])
  if (propia === 'error') return falla('servidor', 'No pudimos quitar la foto. Probá de nuevo.')
  if (!propia) return falla('datos', 'La foto no corresponde a este corte.')

  const registrada = await subidaPorRuta(admin, partes[0])
  if (registrada === 'error') return falla('servidor', 'No pudimos quitar la foto. Probá de nuevo.')
  if (registrada) return quitarFotoDeEntrada(admin, entrada, registrada.id)

  await borrarObjeto(admin, partes[0], 'quitada antes de confirmarse')
  // Una confirmación que seguía en vuelo pudo registrarla mientras tanto.
  const despues = await subidaPorRuta(admin, partes[0])
  if (despues && despues !== 'error') return quitarFotoDeEntrada(admin, entrada, despues.id)
  return { ok: true, quitada: true }
}

/**
 * Descarta TODAS las fotos de un corte que se cierra sin cobro (solo
 * asesoría): las que conoce la tablet y las que el celular haya subido sin que
 * la tablet se enterara. Nunca las de una visita: con el cobro hecho se
 * rechaza, y sólo se miran sesiones sin visita.
 */
export async function descartarFotosDeEntrada(admin: Admin, entrada: EntradaFotos): Promise<RespuestaDescartarFotos> {
  if (entrada.status === 'completed') {
    return falla('cobro_cerrado', 'Este cobro ya se cerró: las fotos quedaron en la ficha del cliente.')
  }
  const sesiones = await sesionesDeEntrada(admin, entrada)
  if (!sesiones.ok) return sesiones
  const sinVisita = sesiones.filas.filter((s) => !s.visit_id)
  if (sinVisita.length === 0) return { ok: true, quitadas: 0, fallidas: 0 }

  // BARRERA: fotos_quitar_foto con un id que no existe toma el lock de la
  // entrada y no toca nada. Una confirmación que estaba en vuelo termina antes
  // de que se junte la lista (si no, se registraba después y quedaba huérfana);
  // las que lleguen después, con el corte cerrado sin cobro, la base las
  // rechaza (219g). Un error acá no corta: se sigue con lo que se pueda.
  const { error: errBarrera } = await admin.rpc('fotos_quitar_foto', {
    p_queue_entry_id: entrada.id,
    p_upload_id: randomUUID(),
  })
  if (errBarrera) console.error('[fotos-corte] descartar: barrera', { entradaId: entrada.id, message: errBarrera.message })

  // Todas las filas (también las de forma inválida: se quitan sin tocar Storage).
  const { data, error } = await admin
    .from('qr_photo_uploads')
    .select('id')
    .in('session_id', sinVisita.map((s) => s.id))
  if (error) {
    console.error('[fotos-corte] descartar: leer fotos', { entradaId: entrada.id, message: error.message })
    return falla('servidor', 'No pudimos borrar las fotos de este corte. Probá de nuevo.')
  }

  let quitadas = 0
  let fallidas = 0
  // De a una: son 12 como mucho y cada una toma el lock de la entrada.
  for (const fila of (data ?? []) as { id: string }[]) {
    const r = await quitarFotoDeEntrada(admin, entrada, fila.id)
    if (r.ok) quitadas++
    else fallidas++
  }
  if (fallidas > 0) console.error('[fotos-corte] descartar: fotos que no se pudieron quitar', { entradaId: entrada.id, fallidas })
  return { ok: true, quitadas, fallidas }
}

/**
 * Lo mismo que 'descartar_todo', para llamarlo desde el SERVIDOR al cerrar un
 * corte sin cobro (cerrarSoloAsesoria), que también se cierra desde
 * /dashboard/fila sin pasar por el diálogo de cobro. El que llama ya validó el
 * acceso a la entrada. Nunca lanza y nunca debe frenar el cierre: si algo
 * falla, lo devuelve (y queda en el log) y el cierre sigue.
 */
export async function descartarFotosDeCorteCerrado(admin: Admin, queueEntryId: string): Promise<RespuestaDescartarFotos> {
  try {
    if (!isValidUUID(queueEntryId)) return falla('datos', 'Corte inválido.')
    const { data, error } = await admin
      .from('queue_entries')
      .select('id, organization_id, branch_id, client_id, barber_id, status')
      .eq('id', queueEntryId)
      .maybeSingle()
    if (error) {
      console.error('[fotos-corte] descartar al cerrar: leer la entrada', { queueEntryId, message: error.message })
      return falla('servidor', 'No pudimos borrar las fotos de este corte.')
    }
    if (!data) return { ok: true, quitadas: 0, fallidas: 0 }
    return await descartarFotosDeEntrada(admin, {
      id: data.id as string,
      organizationId: data.organization_id as string,
      branchId: data.branch_id as string,
      clientId: (data.client_id as string | null) ?? null,
      barberId: (data.barber_id as string | null) ?? null,
      status: String(data.status),
    })
  } catch (e) {
    console.error('[fotos-corte] descartar al cerrar', { queueEntryId, error: e instanceof Error ? e.message : String(e) })
    return falla('servidor', 'No pudimos borrar las fotos de este corte.')
  }
}

// ─── Vinculación con la visita ───────────────────────────────────────────────

/**
 * Ata las fotos del cobro a la visita (RPC fotos_vincular_entrada). La llama
 * completeService al cerrar y en el reintento idempotente. NUNCA lanza ni
 * rompe un cobro: devuelve cuántas quedaron y, si falló, el motivo — pero sólo
 * cuando el cobro tenía fotos. Un cobro sin fotos (la enorme mayoría) no tiene
 * por qué enterarse de que esto existe.
 */
export async function vincularFotosDelCobro(
  admin: Admin,
  queueEntryId: string,
  visitId: string,
): Promise<ResultadoFotosDelCobro> {
  try {
    const { data, error } = await admin.rpc('fotos_vincular_entrada', {
      p_queue_entry_id: queueEntryId,
      p_visit_id: visitId,
    })
    if (!error) return { guardadas: typeof data === 'number' ? data : Number(data ?? 0) || 0 }

    if (esFuncionInexistente(error)) {
      // Sin la 219 no puede haber sesiones de fotos nuevas: nada que atar.
      console.warn('[fotos-corte] fotos_vincular_entrada no existe todavía (falta la mig 219)')
      return { guardadas: 0 }
    }
    console.error('[fotos-corte] fotos_vincular_entrada', { queueEntryId, visitId, code: error.code, message: error.message })
  } catch (e) {
    console.error('[fotos-corte] fotos_vincular_entrada', { queueEntryId, visitId, error: e instanceof Error ? e.message : String(e) })
  }

  // Falló: ¿había fotos? Si no las había, no hay nada que avisar.
  try {
    const { data, error } = await admin
      .from('qr_photo_sessions')
      .select('id')
      .eq('queue_entry_id', queueEntryId)
      .eq('proposito', 'fotos')
      .limit(1)
    if (!error && (data ?? []).length === 0) return { guardadas: 0 }
    if (error && esColumnaInexistente(error)) return { guardadas: 0 }
  } catch {
    // Sin poder saberlo, se avisa: callar una foto perdida es peor que un aviso de más.
  }
  return { guardadas: 0, error: 'No pudimos guardar las fotos en la ficha del cliente.' }
}

/** Reintento manual desde la tablet ("Reintentar" del aviso posterior al cobro). */
export async function vincularFotosDeEntrada(admin: Admin, entrada: EntradaFotos): Promise<RespuestaVincularFotos> {
  const { data, error } = await admin
    .from('visits')
    .select('id')
    .eq('queue_entry_id', entrada.id)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[fotos-corte] visita de la entrada', { entradaId: entrada.id, message: error.message })
    return falla('servidor', 'No pudimos guardar las fotos. Probá de nuevo.')
  }
  if (!data) return falla('entrada', 'Este corte todavía no se cobró.')

  const r = await vincularFotosDelCobro(admin, entrada.id, data.id as string)
  if (r.error) return falla('servidor', r.error)
  return { ok: true, guardadas: r.guardadas }
}

// ─── Celular (por token) ─────────────────────────────────────────────────────

/** Sesión de FOTOS por token: un token de comprobante (o uno viejo sin propósito) no sirve acá. */
async function sesionDeFotosPorToken(admin: Admin, token: string): Promise<FilaSesion | null | 'error'> {
  // Los tokens son uuid: lo que no tiene esa forma ni llega a la base.
  if (!isValidUUID(token)) return null
  const fila = await leerSesion(admin, 'token', token)
  if (fila === 'error' || !fila) return fila
  if (fila.proposito !== 'fotos' || !fila.queue_entry_id) return null
  return fila
}

/** queue_entries.status de la entrada de una sesión (`null` si no está; `'error'` si no se pudo leer). */
async function estadoDeEntrada(admin: Admin, entradaId: string): Promise<string | null | 'error'> {
  const { data, error } = await admin.from('queue_entries').select('status').eq('id', entradaId).maybeSingle()
  if (error) {
    console.error('[fotos-corte] celular: estado de la entrada', { entradaId, message: error.message })
    return 'error'
  }
  return data ? String(data.status) : null
}

/**
 * Lo que necesita la página del celular. Nunca lanza: un fallo de lectura es
 * `estado: 'error'` (la página ofrece reintentar), que no es lo mismo que un
 * código que no existe.
 */
export async function estadoParaCelular(token: string): Promise<EstadoCelular> {
  const vacio: Omit<EstadoCelular, 'estado'> = {
    organizacion: null,
    cliente: null,
    barbero: null,
    cantidad: 0,
    aceptaFotos: false,
    quedan: 0,
    cerradaSinVisita: false,
  }
  try {
    const admin = createAdminClient()
    const sesion = await sesionDeFotosPorToken(admin, token)
    if (sesion === 'error') return { ...vacio, estado: 'error' }
    if (!sesion) return { ...vacio, estado: 'invalida' }

    const [org, entrada, barbero, cantidad] = await Promise.all([
      admin.from('organizations').select('name, logo_url').eq('id', sesion.organization_id).maybeSingle(),
      admin.from('queue_entries').select('client_id, status').eq('id', sesion.queue_entry_id as string).maybeSingle(),
      sesion.staff_id
        ? admin.from('staff').select('full_name').eq('id', sesion.staff_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      contarFotosDeEntrada(admin, sesion.queue_entry_id as string),
    ])
    // Lo accesorio (marca, nombres) puede faltar sin romper la página; se deja rastro.
    if (org.error) console.error('[fotos-corte] celular: organización', org.error.message)
    if (entrada.error) console.error('[fotos-corte] celular: entrada', entrada.error.message)
    if (barbero.error) console.error('[fotos-corte] celular: barbero', barbero.error.message)

    let cliente: string | null = null
    const clientId = (entrada.data?.client_id as string | null | undefined) ?? null
    if (clientId) {
      const { data, error } = await admin.from('clients').select('name').eq('id', clientId).maybeSingle()
      if (error) console.error('[fotos-corte] celular: cliente', error.message)
      cliente = nombreCorto((data?.name as string | undefined) ?? null)
    }

    // Sin poder leer la entrada se usa sólo la sesión: la base (219g) rechaza
    // igual una foto de un corte cerrado sin cobro.
    const cancelada = String(entrada.data?.status ?? '') === ESTADO_CANCELADA
    const { estado, aceptaFotos, sinVisita } = estadoDeSesion(sesion, cancelada)
    const total = cantidad ?? 0
    return {
      estado,
      organizacion: org.data
        ? { nombre: String(org.data.name), logoUrl: (org.data.logo_url as string | null) ?? null }
        : null,
      cliente,
      barbero: primerNombre((barbero.data as { full_name?: string } | null)?.full_name ?? null),
      cantidad: total,
      aceptaFotos,
      quedan: Math.max(0, TOPE_FOTOS_POR_CORTE - total),
      cerradaSinVisita: sinVisita,
    }
  } catch (e) {
    console.error('[fotos-corte] estado para el celular', e instanceof Error ? e.message : String(e))
    return { ...vacio, estado: 'error' }
  }
}

export async function autorizarSubidaPorToken(token: string, archivo: ArchivoDeclarado): Promise<RespuestaPedirSubida> {
  const invalido = validarArchivo(archivo)
  if (invalido) return invalido

  const admin = createAdminClient()
  const sesion = await sesionDeFotosPorToken(admin, token)
  if (sesion === 'error') return falla('servidor', TEXTO_SERVIDOR)
  if (!sesion) return falla('datos', 'Este código no es válido. Generá uno nuevo desde la tablet.')

  // Sin visita y con la entrada cancelada (solo asesoría): ni se firma. Si la
  // entrada no se pudo leer, decide la sesión (la base rechaza igual al confirmar).
  const estadoEntrada = sesion.visit_id ? null : await estadoDeEntrada(admin, sesion.queue_entry_id as string)
  const { estado, aceptaFotos, sinVisita } = estadoDeSesion(sesion, estadoEntrada === ESTADO_CANCELADA)
  if (!aceptaFotos) {
    return errorDeMotivo(sinVisita ? 'cerrada_sin_cobro' : estado === 'cerrada' ? 'cobro_cerrado' : 'vencida', 'celular')
  }

  const cantidad = await contarFotosDeEntrada(admin, sesion.queue_entry_id as string)
  if (cantidad !== null && cantidad >= TOPE_FOTOS_POR_CORTE) return errorDeMotivo('tope', 'celular')

  return firmarSubida(admin, sesion, String(archivo.contentType).toLowerCase())
}

export async function confirmarSubidaPorToken(token: string, ruta: string): Promise<RespuestaConfirmarSubida> {
  const admin = createAdminClient()
  const sesion = await sesionDeFotosPorToken(admin, token)
  if (sesion === 'error') return falla('servidor', TEXTO_SERVIDOR)
  if (!sesion) return falla('datos', 'Este código no es válido. Generá uno nuevo desde la tablet.')

  const partes = RUTA_DE_FOTO.exec(String(ruta ?? ''))
  if (!partes || partes[1] !== sesion.organization_id || partes[2] !== sesion.id) {
    return falla('datos', 'La foto no corresponde a este corte.')
  }
  return confirmarEnSesion(admin, sesion, partes[0], 'celular', 'celular')
}
