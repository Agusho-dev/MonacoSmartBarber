'use client'

// =============================================================================
// El PDF de los informes de Tex: listo para mandar al contador o por WhatsApp.
// jsPDF y autotable se cargan recién al pedir el PDF (import dinámico: ~400 KB
// que el chat no necesita para mostrar la tarjeta). El dibujo vive en
// pdf-dibujo.ts (funciones puras, probadas con node).
// =============================================================================

import { TEX_CARA_PNG } from '@/components/tex/assets'
import type { TexInforme } from './contrato'

export interface OpcionesPdfTex {
  orgNombre?: string
}

// La carita del pie ("Preparado con Tex"): fetch → dataURL una sola vez por
// pestaña. Si falla, el PDF sale igual, sin imagen (y se reintenta la próxima).
let caraTex: Promise<string | null> | null = null

function leerComoDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolver) => {
    const lector = new FileReader()
    lector.onload = () => resolver(typeof lector.result === 'string' ? lector.result : null)
    lector.onerror = () => resolver(null)
    lector.readAsDataURL(blob)
  })
}

function cargarCaraTex(): Promise<string | null> {
  if (!caraTex) {
    caraTex = fetch(TEX_CARA_PNG, { cache: 'force-cache' })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? leerComoDataUrl(b) : null))
      .catch(() => null)
      .then((url) => {
        if (!url) caraTex = null
        return url
      })
  }
  return caraTex
}

/** Arma el PDF y lo devuelve (para compartir con Web Share). */
export async function generarPdfInformeTex(informe: TexInforme, opts: OpcionesPdfTex = {}): Promise<Blob> {
  const [{ jsPDF }, autoTable, { dibujarInformeTex }, cara] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable').then((m) => m.default),
    import('./pdf-dibujo'),
    cargarCaraTex(),
  ])
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  dibujarInformeTex(doc, autoTable, informe, { orgNombre: opts.orgNombre, caraTex: cara, fecha: new Date() })
  return doc.output('blob')
}

// ─────────────────────────────────────────────────────────────────────────────
// Caché corto: la tarjeta prepara el PDF apenas la persona apunta a
// "Compartir" o "Descargar". En el celular eso importa: Web Share exige que
// `navigator.share` se llame cerca del toque, y armar el PDF en un teléfono
// lento puede pasarse de esa ventana.
// ─────────────────────────────────────────────────────────────────────────────

const VIGENCIA_MS = 5 * 60_000
const cache = new Map<string, { pdf: Promise<Blob>; creado: number }>()

/** El PDF del informe, reutilizando uno armado hace menos de 5 minutos. */
export function obtenerPdfInformeTex(informe: TexInforme, opts: OpcionesPdfTex = {}): Promise<Blob> {
  const clave = JSON.stringify([informe, opts.orgNombre ?? ''])
  const ahora = Date.now()
  const hit = cache.get(clave)
  if (hit && ahora - hit.creado < VIGENCIA_MS) return hit.pdf
  cache.delete(clave)
  const pdf = generarPdfInformeTex(informe, opts)
  cache.set(clave, { pdf, creado: ahora })
  pdf.catch(() => cache.delete(clave))
  while (cache.size > 4) {
    const primera = cache.keys().next().value
    if (primera === undefined) break
    cache.delete(primera)
  }
  return pdf
}

/** Nombre de archivo estable: informe-<slug-del-titulo>.pdf */
export function nombreArchivoInformeTex(informe: TexInforme): string {
  const slug = informe.titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60)
    .replace(/-$/, '')
  // "Informe de octubre" no tiene que bajar como "informe-informe-de-octubre.pdf".
  if (!slug) return 'informe-tex.pdf'
  return slug === 'informe' || slug.startsWith('informe-') ? `${slug}.pdf` : `informe-${slug}.pdf`
}

/** Baja un PDF ya armado. */
export function guardarPdf(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Safari en iOS abre la vista previa y lee el blob después del click: con
  // 1 s a veces llegaba revocado. Un minuto no cuesta nada.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Arma el PDF y lo descarga. */
export async function descargarInformeTex(informe: TexInforme, opts: OpcionesPdfTex = {}): Promise<void> {
  const blob = await generarPdfInformeTex(informe, opts)
  guardarPdf(blob, nombreArchivoInformeTex(informe))
}

export type ResultadoCompartir =
  /** Se abrió la hoja de compartir del sistema y la persona eligió dónde. */
  | 'compartido'
  /** Cerró la hoja sin elegir nada: no es un error. */
  | 'cancelado'
  /** El navegador no comparte archivos (casi todos los de escritorio). */
  | 'sin_soporte'
  /** Se venció el permiso del toque (el PDF tardó): hay que volver a tocar. */
  | 'sin_permiso'

/** Comparte el PDF con la hoja del sistema (WhatsApp, Mail, Drive…). */
export async function compartirPdf(blob: Blob, nombre: string, titulo: string): Promise<ResultadoCompartir> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof File === 'undefined') {
    return 'sin_soporte'
  }
  const archivo = new File([blob], nombre, { type: 'application/pdf' })
  if (typeof navigator.canShare !== 'function' || !navigator.canShare({ files: [archivo] })) return 'sin_soporte'
  try {
    // Sólo archivo y título: con `text` además, varias apps (WhatsApp en
    // Android) mandan el texto y descartan el adjunto.
    await navigator.share({ files: [archivo], title: titulo })
    return 'compartido'
  } catch (e) {
    const nombreError = e instanceof Error ? e.name : ''
    if (nombreError === 'AbortError') return 'cancelado'
    if (nombreError === 'NotAllowedError') return 'sin_permiso'
    throw e
  }
}
