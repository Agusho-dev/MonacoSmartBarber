'use client'

// La hoja «Avisos» de «Por responder» (6/nov/2026): prender, ajustar, probar y
// apagar los avisos push en ESTE dispositivo. En el iPhone sin el dashboard en
// la pantalla de inicio explica cómo agregarlo: Safari común no tiene avisos.

import { toast } from 'sonner'
import { Bell, BellOff, BellRing, MessageCircleQuestion, Share, SquarePlus, Star } from 'lucide-react'
import { HojaWhatsApp } from '../dialogs/hoja-whatsapp'
import {
  CeldaAccionIos, CeldaIos, GrupoIos, IconoCeldaIos, InterruptorIos, TEXTO_PRINCIPAL, TEXTO_SECUNDARIO,
} from '../navegacion/lista-ios'
import { cn } from '@/lib/utils'
import type { useAvisosPush } from './use-avisos-push'

type Avisos = ReturnType<typeof useAvisosPush>

export function HojaAvisos({ abierta, onCerrar, avisos }: { abierta: boolean; onCerrar: () => void; avisos: Avisos }) {
  const { estado, preferencias, ocupado, error } = avisos

  const activar = async () => {
    const ok = await avisos.activar()
    if (ok) toast.success('Avisos activados en este dispositivo')
  }
  const probar = async () => {
    const ok = await avisos.probar()
    if (ok) toast.success('Listo: te tiene que llegar un aviso de prueba')
  }

  return (
    <HojaWhatsApp
      open={abierta}
      onOpenChange={(v) => { if (!v) onCerrar() }}
      titulo="Avisos"
      descripcion="Los avisos de reseñas bajas y consultas sin responder en este dispositivo."
    >
      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] pt-1 lg:px-5 lg:pb-5 lg:pt-4">
        <div className="flex flex-col items-center px-4 pb-2 pt-3 text-center">
          <span
            className={cn(
              'flex size-16 items-center justify-center rounded-[20px] shadow-[0_12px_30px_-10px_rgba(0,0,0,0.8)]',
              estado === 'activo' ? 'bg-[linear-gradient(145deg,#2fd673,#0f9b4b)]' : 'bg-[linear-gradient(145deg,#3a3a3c,#232325)]',
            )}
          >
            {estado === 'activo'
              ? <BellRing aria-hidden className="size-8 text-white" strokeWidth={1.9} />
              : estado === 'bloqueado'
                ? <BellOff aria-hidden className="size-8 text-white/80" strokeWidth={1.9} />
                : <Bell aria-hidden className="size-8 text-white/85" strokeWidth={1.9} />}
          </span>
          <p className="mt-3 text-[20px] font-semibold leading-6 text-[var(--wa-text)] lg:text-[17px]">
            {estado === 'activo' ? 'Te avisamos en este dispositivo' : 'Que no se te pase ninguna'}
          </p>
          <p className="mt-1 max-w-sm text-[15px] leading-5 text-[var(--wa-text-2)] lg:text-[13px] lg:leading-[18px]">
            Un aviso cuando una reseña llega con 3 estrellas o menos y cuando una consulta lleva 10 minutos sin respuesta. De 23 a 9 no molestamos: lo de la noche llega a las 9.
          </p>
        </div>

        {estado === 'instalar' && (
          <GrupoIos titulo="Primero, agregalo a la pantalla de inicio" pie="En el iPhone los avisos sólo funcionan con el dashboard abierto desde su ícono, no desde Safari.">
            <CeldaIos icono={<IconoCeldaIos icono={Share} color="azul" />}>
              <p className={TEXTO_PRINCIPAL}>Tocá Compartir en Safari</p>
            </CeldaIos>
            <CeldaIos icono={<IconoCeldaIos icono={SquarePlus} color="gris" />}>
              <p className={TEXTO_PRINCIPAL}>Elegí «Agregar a inicio»</p>
            </CeldaIos>
            <CeldaIos icono={<IconoCeldaIos icono={Bell} color="verde" />}>
              <p className={TEXTO_PRINCIPAL}>Abrilo desde el ícono y volvé acá</p>
            </CeldaIos>
          </GrupoIos>
        )}

        {estado === 'no-soportado' && (
          <GrupoIos>
            <CeldaIos>
              <p className={TEXTO_SECUNDARIO}>Este navegador no tiene avisos. Probá desde Chrome, Edge, Safari en la Mac o el dashboard agregado a la pantalla de inicio del iPhone.</p>
            </CeldaIos>
          </GrupoIos>
        )}

        {estado === 'bloqueado' && (
          <GrupoIos pie="Se prenden desde los ajustes del navegador o, en el iPhone, desde Ajustes › Notificaciones › Dashboard.">
            <CeldaIos icono={<IconoCeldaIos icono={BellOff} color="rojo" />}>
              <p className={TEXTO_PRINCIPAL}>Los avisos están bloqueados</p>
            </CeldaIos>
          </GrupoIos>
        )}

        {(estado === 'apagado' || estado === 'cargando') && (
          <GrupoIos>
            <CeldaAccionIos icono={Bell} onClick={() => { void activar() }} deshabilitada={ocupado || estado === 'cargando'} centrada>
              {ocupado ? 'Activando…' : 'Activar avisos en este dispositivo'}
            </CeldaAccionIos>
          </GrupoIos>
        )}

        {estado === 'activo' && (
          <>
            <GrupoIos titulo="Avisarme de">
              <CeldaIos
                icono={<IconoCeldaIos icono={Star} color="naranja" />}
                derecha={(
                  <InterruptorIos
                    activo={preferencias.avisarResenas}
                    onCambio={(v) => { void avisos.cambiar({ ...preferencias, avisarResenas: v }) }}
                    etiqueta="Reseñas bajas"
                  />
                )}
              >
                <div className="min-w-0 flex-1 py-0.5">
                  <p className={TEXTO_PRINCIPAL}>Reseñas bajas</p>
                  <p className={TEXTO_SECUNDARIO}>3 estrellas o menos, con lo que contó</p>
                </div>
              </CeldaIos>
              <CeldaIos
                icono={<IconoCeldaIos icono={MessageCircleQuestion} color="azul" />}
                derecha={(
                  <InterruptorIos
                    activo={preferencias.avisarConsultas}
                    onCambio={(v) => { void avisos.cambiar({ ...preferencias, avisarConsultas: v }) }}
                    etiqueta="Consultas sin responder"
                  />
                )}
              >
                <div className="min-w-0 flex-1 py-0.5">
                  <p className={TEXTO_PRINCIPAL}>Consultas sin responder</p>
                  <p className={TEXTO_SECUNDARIO}>A los 10 minutos, y un recordatorio cada 2 horas</p>
                </div>
              </CeldaIos>
            </GrupoIos>
            <GrupoIos>
              <CeldaAccionIos icono={BellRing} onClick={() => { void probar() }} deshabilitada={ocupado}>
                Mandar un aviso de prueba
              </CeldaAccionIos>
              <CeldaAccionIos icono={BellOff} tono="peligro" onClick={() => { void avisos.desactivar() }} deshabilitada={ocupado}>
                Apagar en este dispositivo
              </CeldaAccionIos>
            </GrupoIos>
          </>
        )}

        {error && <p role="alert" className="mt-4 px-4 text-[14px] leading-5 text-[var(--wa-danger)] lg:px-3 lg:text-[13px]">{error}</p>}
      </div>
    </HojaWhatsApp>
  )
}
