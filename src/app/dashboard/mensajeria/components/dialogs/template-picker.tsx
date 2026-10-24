'use client'

// Elegir una plantilla de WhatsApp para mandar (desde el chat, fuera de la
// ventana de 24 h), con la hoja de WhatsApp (hoja-whatsapp.tsx): en el celular,
// la de iOS de pantalla entera; en la compu, el diálogo de la Mac. Cada
// plantilla es una celda con su nombre legible, su texto y «Enviar».

import { FileText, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMensajeria } from '../shared/mensajeria-context'
import { HojaWhatsApp } from './hoja-whatsapp'
import {
  BotonPildoraIos, CargandoIos, CLASE_CELDA, CLASE_CUERPO, GrupoIos, TEXTO_PRINCIPAL, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, VacioIos,
  nombreDePlantilla,
} from '../navegacion/lista-ios'

const CATEGORIA: Record<string, string> = { MARKETING: 'Marketing', UTILITY: 'Utilidad', AUTHENTICATION: 'Autenticación' }

export function TemplatePicker() {
  const {
    showTemplateDialog, setShowTemplateDialog,
    waTemplates, handleSyncTemplates, handleSendTemplate,
    syncingTemplates, sendingTemplate,
  } = useMensajeria()

  const sincronizar = (
    <button
      type="button"
      onClick={handleSyncTemplates}
      disabled={syncingTemplates}
      className="-mr-2.5 flex h-11 items-center gap-1.5 rounded-full px-2.5 text-[15px] font-medium text-[var(--wa-accent)] outline-none transition-colors active:bg-white/10 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:h-8 lg:text-[13px] lg:hover:bg-white/[0.07]"
    >
      <RefreshCw aria-hidden className={cn('size-4', syncingTemplates && 'animate-spin')} />
      Sincronizar
    </button>
  )

  return (
    <HojaWhatsApp
      open={showTemplateDialog}
      onOpenChange={setShowTemplateDialog}
      titulo="Plantillas"
      descripcion="Las plantillas aprobadas por Meta: se pueden mandar aunque el cliente no haya escrito en las últimas 24 horas."
    >
      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-[calc(env(safe-area-inset-bottom,0px)_+_1.5rem)] lg:px-5 lg:pb-5 lg:pt-4">
        {syncingTemplates && waTemplates.length === 0 ? (
          <CargandoIos texto="Sincronizando las plantillas…" />
        ) : waTemplates.length === 0 ? (
          <VacioIos icono={FileText} titulo="No hay plantillas aprobadas" texto="Creá una en Meta Business y tocá Sincronizar.">
            <BotonPildoraIos icono={RefreshCw} onClick={handleSyncTemplates}>Sincronizar</BotonPildoraIos>
          </VacioIos>
        ) : (
          <GrupoIos
            titulo="Aprobadas"
            accion={sincronizar}
            pie="Se pueden mandar aunque el cliente no haya escrito en las últimas 24 horas."
          >
            {waTemplates.map((tpl) => {
              const cuerpo = tpl.components?.find((c) => c.type === 'BODY' && c.text)?.text
              const nombre = nombreDePlantilla(tpl.name)
              return (
                <li key={tpl.id} className={cn(CLASE_CELDA, 'items-start')}>
                  <div className={cn(CLASE_CUERPO, 'items-start gap-3 py-3 lg:py-2.5')}>
                    <div className="min-w-0 flex-1">
                      <p className={cn(TEXTO_PRINCIPAL, 'truncate font-semibold')}>{nombre}</p>
                      <p className={TEXTO_TERCIARIO}>
                        {[tpl.language, CATEGORIA[tpl.category?.toUpperCase()] ?? tpl.category].filter(Boolean).join(' · ')}
                      </p>
                      {cuerpo && <p className={cn(TEXTO_SECUNDARIO, 'mt-1 line-clamp-3')}>{cuerpo}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSendTemplate(tpl)}
                      disabled={sendingTemplate}
                      aria-label={`Enviar la plantilla «${nombre}»`}
                      className="flex h-11 shrink-0 items-center rounded-full bg-[var(--wa-accent)] px-4 text-[15px] font-semibold text-[var(--wa-on-accent)] outline-none transition-colors active:bg-[var(--wa-accent-hover)] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--wa-raised)] lg:h-8 lg:px-3.5 lg:text-[13px] lg:hover:bg-[var(--wa-accent-hover)]"
                    >
                      {sendingTemplate ? <Loader2 aria-label="Enviando" className="size-4 animate-spin" /> : 'Enviar'}
                    </button>
                  </div>
                </li>
              )
            })}
          </GrupoIos>
        )}
      </div>
    </HojaWhatsApp>
  )
}
