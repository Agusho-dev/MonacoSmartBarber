/**
 * Cámaras del panel con la UI girada por CSS.
 *
 * CONTRATO. Con la tablet MONTADA AL REVÉS y el display sin rotar (modo 'css'),
 * Chrome entrega cada frame según la rotación del DISPLAY, no de la gravedad
 * (chromium VideoCapture.java → getDeviceRotation): llegan con el mundo al revés.
 * Lo que se ANALIZA o se GUARDA hay que enderezarlo 180° con estas funciones; lo
 * que se MUESTRA en vivo (<video>) se contra-gira por CSS poniendo
 * `data-giro-camara` en el visor (globals.css).
 *
 * NO sirve para fotos con la tablet en la mano: si el barbero la saca del soporte
 * y la sostiene derecha, el display no rota, el CSS sigue activo y el frame ya
 * llega derecho — enderezarlo lo daría vuelta. Por eso las fotos del corte van por
 * la cámara nativa (<input type="file" capture>), que se orienta sola por sensor
 * y EXIF, y NUNCA pasan por acá. Sólo el escáner del comprobante (la tablet fija
 * en el soporte, el cliente acerca su celular) usa el enderezado.
 *
 * Esto sale de leer Chromium, no de una prueba en la tablet. El comprobante tiene
 * una red de seguridad por si la suposición falla, una por motor
 * (receipt-scan-dialog.tsx):
 *  - OCR (Tesseract en la tablet): si con el frame enderezado no aparece el
 *    monto, relee una vez el frame dado vuelta y se queda con el que lo encontró.
 *  - IA (el motor de Monaco): si la IA no leyó NADA, reenvía una vez la imagen
 *    dada vuelta al mismo comprobante (una lectura paga más, sólo en ese caso).
 *    Si tampoco lee, queda en revisión con la imagen girada.
 * Igual conviene probarlo una vez en una tablet montada al revés antes de girar
 * una sucursal que cobra por transferencia: si los frames llegaran distinto, el
 * visor en vivo también se vería al revés.
 */
import { esModoCss } from './store'

/**
 * ¿Los frames de la cámara llegan al revés AHORA? Se lee del store en el momento
 * en que se dibuja cada frame —nunca de un ref sincronizado por un efecto, que
 * llega tarde al primer tick del detector—.
 */
export function framesAlReves(): boolean {
  return esModoCss()
}

/**
 * `drawImage` de 9 argumentos que, si `girar`, dibuja la fuente girada 180°
 * sobre el centro del rectángulo destino. Deja el contexto como lo encontró.
 */
export function dibujarFrame(
  ctx: CanvasRenderingContext2D,
  fuente: CanvasImageSource,
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number, dw: number, dh: number,
  girar: boolean,
): void {
  if (!girar) {
    ctx.drawImage(fuente, sx, sy, sw, sh, dx, dy, dw, dh)
    return
  }
  ctx.save()
  // p → (2·cx − x, 2·cy − y): media vuelta alrededor del centro del destino.
  ctx.setTransform(-1, 0, 0, -1, 2 * dx + dw, 2 * dy + dh)
  ctx.drawImage(fuente, sx, sy, sw, sh, dx, dy, dw, dh)
  ctx.restore()
}

/** Devuelve una copia de la imagen girada 180° (para reintentar una lectura que no encontró nada). */
export async function girarImagen180(blob: Blob, tipo = 'image/webp', calidad = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas sin contexto 2d')
    dibujarFrame(ctx, bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, bitmap.width, bitmap.height, true)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no se pudo girar la imagen'))), tipo, calidad),
    )
  } finally {
    bitmap.close()
  }
}
