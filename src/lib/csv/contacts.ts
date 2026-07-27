/**
 * Parser de CSV de contactos para difusiones del CRM.
 *
 * Es código puro (sin dependencias de servidor) para que el wizard pueda
 * parsear y previsualizar el archivo en el browser antes de tocar la base.
 *
 * Tolera lo que escupen Excel / Google Sheets / los exports de landing pages:
 *   - BOM al inicio (`﻿nombre`)
 *   - Delimitador `,` `;` o tab
 *   - Campos entre comillas con comas o saltos de línea adentro
 *   - El apóstrofo que Excel antepone para forzar texto (`'+5435...`)
 *   - CRLF
 */

export interface CsvContact {
  /** Nombre tal cual viene en el CSV (trim). Puede quedar vacío. */
  name: string
  /** Teléfono normalizado al mismo formato que `clients.phone` (local AR, 10 dígitos). */
  phone: string
  /** Teléfono crudo del CSV, para mostrarlo en la previsualización. */
  raw: string
}

export interface CsvInvalidRow {
  row: number
  name: string
  raw: string
  reason: string
}

export interface CsvParseResult {
  contacts: CsvContact[]
  invalid: CsvInvalidRow[]
  /** Cuántas filas se descartaron por repetir un teléfono ya presente. */
  duplicates: number
  /** Filas de datos leídas (sin contar el encabezado). */
  totalRows: number
  headers: string[]
  detected: { name: string | null; phone: string | null }
  error?: string
}

/** Tope de seguridad: un CSV más grande que esto casi seguro es un error. */
export const CSV_MAX_CONTACTS = 2000

const PHONE_HEADERS = [
  'whatsapp', 'wa', 'telefono', 'teléfono', 'tel', 'celular', 'cel',
  'movil', 'móvil', 'phone', 'numero', 'número', 'number', 'contacto', 'mobile',
]

const NAME_HEADERS = [
  'nombre', 'name', 'nombre completo', 'nombre_completo', 'fullname', 'full name',
  'cliente', 'alumno', 'inscripto', 'apellido y nombre', 'nombre y apellido', 'contacto',
]

/**
 * Normaliza un teléfono del CSV al formato en que está guardado `clients.phone`
 * (local argentino de 10 dígitos: `3512247164`). El `54` se lo vuelve a agregar
 * el sender al mandar a Meta (`normalizeArgentinePhoneForMeta`), así que
 * guardarlo local mantiene la convención del resto de la tabla y hace funcionar
 * el UNIQUE (organization_id, phone) como dedupe.
 *
 * Devuelve el motivo del rechazo en vez de `null` para poder mostrarle al
 * usuario exactamente qué fila se cayó y por qué.
 *
 * IMPORTANTE — sólo Argentina: el sender (`process-scheduled-messages →
 * normalizePhone`) le antepone `54` a cualquier número que no empiece con `54`,
 * así que un número de otro país guardado en E.164 terminaría saliendo como
 * `54` + número extranjero, o sea a un destinatario equivocado. Preferimos
 * rechazarlo y que quede a la vista antes que mandar el mensaje a cualquiera.
 */
export function classifyCsvPhone(input: string): { phone: string } | { reason: string } {
  const trimmed = input.trim().replace(/^'/, '')
  let digits = trimmed.replace(/\D/g, '')
  if (!digits) return { reason: 'Sin teléfono' }
  if (digits.length > 15) return { reason: 'Demasiados dígitos' }

  // ¿Trae código de país explícito? (`+…` o el `00` internacional)
  let hasCountryCode = trimmed.startsWith('+')
  if (digits.startsWith('00')) { digits = digits.slice(2); hasCountryCode = true }

  if (!hasCountryCode) {
    // Prefijo de larga distancia nacional (0351 …)
    while (digits.startsWith('0')) digits = digits.slice(1)
    // 9 + 10 dígitos = celular argentino sin país
    if (digits.startsWith('9') && digits.length === 11) digits = '54' + digits.slice(1)
    else if (!digits.startsWith('54')) digits = '54' + digits
    hasCountryCode = true
  }

  // 54 9 351 … → Meta no quiere el 9 intermedio
  if (digits.startsWith('549') && digits.length === 13) digits = '54' + digits.slice(3)

  if (!digits.startsWith('54')) {
    return { reason: `Número de otro país (+${digits.slice(0, 3)}…)` }
  }
  if (digits.length !== 12) {
    return { reason: 'Largo inválido para Argentina' }
  }

  const local = digits.slice(2)
  // Códigos de área argentinos: 11, 2XX(X), 3XX(X). Nada más empieza con 1.
  if (!/^(11|[23])/.test(local)) {
    return { reason: 'Código de área inválido' }
  }

  return { phone: local }
}

/** Igual que `classifyCsvPhone` pero devuelve `null` en vez del motivo. */
export function normalizeCsvPhone(input: string): string | null {
  const r = classifyCsvPhone(input)
  return 'phone' in r ? r.phone : null
}

/**
 * Lee un CSV completo respetando comillas (RFC 4180). Devuelve filas de celdas.
 */
function readRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') { inQuotes = true; continue }
    if (ch === delimiter) { row.push(field); field = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += ch
  }

  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

/** Cuenta ocurrencias fuera de comillas para adivinar el delimitador. */
function guessDelimiter(firstLine: string): string {
  const candidates = [',', ';', '\t', '|']
  let best = ','
  let bestCount = -1
  for (const d of candidates) {
    let count = 0
    let inQuotes = false
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes
      else if (ch === d && !inQuotes) count++
    }
    if (count > bestCount) { bestCount = count; best = d }
  }
  return best
}

function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, '').trim().toLowerCase().replace(/["']/g, '')
}

function findColumn(headers: string[], aliases: string[]): number {
  // 1) match exacto
  for (let i = 0; i < headers.length; i++) {
    if (aliases.includes(headers[i])) return i
  }
  // 2) match parcial (ej: "telefono de contacto")
  for (let i = 0; i < headers.length; i++) {
    if (aliases.some(a => headers[i].includes(a))) return i
  }
  return -1
}

/**
 * Parsea el texto de un CSV a contactos listos para una difusión.
 * Nunca tira: los problemas vuelven en `error` o en `invalid[]`.
 */
export function parseContactsCsv(text: string): CsvParseResult {
  const empty: CsvParseResult = {
    contacts: [], invalid: [], duplicates: 0, totalRows: 0,
    headers: [], detected: { name: null, phone: null },
  }

  const clean = text.replace(/^﻿/, '')
  if (!clean.trim()) return { ...empty, error: 'El archivo está vacío' }

  const firstLine = clean.split(/\r?\n/, 1)[0] ?? ''
  const rows = readRows(clean, guessDelimiter(firstLine))
  if (rows.length === 0) return { ...empty, error: 'El archivo está vacío' }

  const rawHeaders = rows[0].map(normalizeHeader)
  let phoneIdx = findColumn(rawHeaders, PHONE_HEADERS)
  let nameIdx = findColumn(rawHeaders, NAME_HEADERS)
  // "contacto" está en las dos listas: si cayó en la misma columna, gana teléfono.
  if (nameIdx === phoneIdx) nameIdx = -1

  let dataRows = rows.slice(1)
  let headers = rawHeaders

  if (phoneIdx === -1) {
    // Sin encabezado reconocible: buscamos la columna que más parezca teléfono
    // en la primera fila de datos y tratamos TODAS las filas como datos.
    const probe = rows[0]
    let bestIdx = -1
    for (let i = 0; i < probe.length; i++) {
      if (normalizeCsvPhone(probe[i] ?? '')) { bestIdx = i; break }
    }
    if (bestIdx === -1) {
      return {
        ...empty,
        headers: rawHeaders,
        error: 'No se encontró una columna de teléfono. Poné un encabezado "telefono" o "whatsapp".',
      }
    }
    phoneIdx = bestIdx
    nameIdx = bestIdx === 0 ? (probe.length > 1 ? 1 : -1) : 0
    dataRows = rows
    headers = rawHeaders.map((_, i) => `columna ${i + 1}`)
  }

  const contacts: CsvContact[] = []
  const invalid: CsvInvalidRow[] = []
  const seen = new Set<string>()
  let duplicates = 0

  dataRows.forEach((cells, i) => {
    const rawPhone = (cells[phoneIdx] ?? '').trim()
    const name = nameIdx >= 0 ? (cells[nameIdx] ?? '').trim().replace(/^'/, '') : ''
    const rowNumber = i + (dataRows === rows ? 1 : 2)

    if (!rawPhone) {
      invalid.push({ row: rowNumber, name, raw: '', reason: 'Sin teléfono' })
      return
    }

    const phone = normalizeCsvPhone(rawPhone)
    if (!phone) {
      invalid.push({ row: rowNumber, name, raw: rawPhone, reason: 'Teléfono inválido' })
      return
    }

    if (seen.has(phone)) { duplicates++; return }
    seen.add(phone)
    contacts.push({ name, phone, raw: rawPhone })
  })

  return {
    contacts,
    invalid,
    duplicates,
    totalRows: dataRows.length,
    headers,
    detected: {
      name: nameIdx >= 0 ? (headers[nameIdx] ?? null) : null,
      phone: headers[phoneIdx] ?? null,
    },
  }
}
