'use client'

// Descargar y compartir el PDF de un informe, con su estado de carga y sus
// avisos. Lo usan la tarjeta del informe y el Lienzo.
//
// Compartir en el celular: la hoja del sistema (WhatsApp, Mail, Drive) se abre
// con el PDF adjunto. Si el navegador no comparte archivos (casi todos los de
// escritorio), se descarga y se avisa. Si el PDF tardó tanto que el navegador
// ya no reconoce el toque como del usuario (NotAllowedError), el aviso trae
// un botón "Compartir": ese segundo toque sí vale, y el PDF ya está armado.
//
// Descargar pasa por guardarArchivo: en la app instalada del iPhone, donde no
// hay descargas, abre la hoja para "Guardar en Archivos".

import { useState } from 'react'
import { toast } from 'sonner'
import type { TexInforme } from '@/lib/tex/contrato'
import { compartirPdf, guardarPdf, nombreArchivoInformeTex, obtenerPdfInformeTex, type ResultadoCompartir } from '@/lib/tex/pdf'

export type AccionPdf = 'descargar' | 'compartir'

const ERROR_ARMAR = 'No pude armar el PDF. Probá de nuevo.'

function avisarResultado(r: ResultadoCompartir, blob: Blob, nombre: string, titulo: string): void {
  // "Lo descargué" sólo si se descargó: guardarPdf también puede abrir la hoja o dejar su propio aviso.
  if (r === 'sin_soporte') {
    void guardarPdf(blob, nombre).then((g) => {
      if (g === 'descargado') toast('Lo descargué: este navegador no comparte archivos. Adjuntalo desde Descargas.')
    })
  } else if (r === 'sin_permiso') {
    toast('El PDF está listo.', {
      action: {
        label: 'Compartir',
        onClick: () => {
          compartirPdf(blob, nombre, titulo)
            .then(async (otra) => {
              if (otra === 'sin_soporte' || otra === 'sin_permiso') {
                if ((await guardarPdf(blob, nombre)) === 'descargado') {
                  toast('Lo descargué para que lo mandes desde Descargas.')
                }
              }
            })
            .catch(() => toast.error('No pude compartir el PDF. Probá descargarlo.'))
        },
      },
    })
  }
}

export function useInformePdf(informe: TexInforme, orgNombre?: string) {
  const [ocupado, setOcupado] = useState<AccionPdf | null>(null)

  /** Empieza a armar el PDF antes del toque (al apuntar o apoyar el dedo): queda en caché 5 min. */
  function preparar(): void {
    obtenerPdfInformeTex(informe, { orgNombre }).catch(() => {
      /* el error se muestra cuando la persona toca */
    })
  }

  async function descargar(): Promise<void> {
    if (ocupado) return
    setOcupado('descargar')
    let blob: Blob
    try {
      blob = await obtenerPdfInformeTex(informe, { orgNombre })
    } catch (e) {
      console.error('[tex/pdf] no se pudo armar', e)
      toast.error(ERROR_ARMAR)
      setOcupado(null)
      return
    }
    // Como en compartir: el spinner es del armado, no de la hoja de compartir
    // que abre guardarPdf en la app instalada del iPhone.
    setOcupado(null)
    await guardarPdf(blob, nombreArchivoInformeTex(informe))
  }

  async function compartir(): Promise<void> {
    if (ocupado) return
    setOcupado('compartir')
    const nombre = nombreArchivoInformeTex(informe)
    let blob: Blob
    try {
      blob = await obtenerPdfInformeTex(informe, { orgNombre })
    } catch (e) {
      console.error('[tex/pdf] no se pudo armar', e)
      toast.error(ERROR_ARMAR)
      setOcupado(null)
      return
    }
    // El spinner es del armado: mientras la persona elige dónde mandarlo, el botón ya está libre.
    setOcupado(null)
    try {
      avisarResultado(await compartirPdf(blob, nombre, informe.titulo), blob, nombre, informe.titulo)
    } catch (e) {
      console.error('[tex/pdf] no se pudo compartir', e)
      toast.error('No pude compartir el PDF. Probá descargarlo.')
    }
  }

  return { ocupado, preparar, descargar, compartir }
}
