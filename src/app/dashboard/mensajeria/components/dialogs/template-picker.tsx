'use client'

// Elegir una plantilla de WhatsApp para mandar (desde el chat, fuera de la
// ventana de 24 h). Con los colores de WhatsApp: el diálogo va en un portal
// fuera de .wa-scope y la lleva de nuevo para que los --wa-* resuelvan.

import { FileText, Loader2, RefreshCw } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { nombreLegibleDePlantilla } from '../shared/helpers'
import { useMensajeria } from '../shared/mensajeria-context'

export function TemplatePicker() {
  const {
    showTemplateDialog, setShowTemplateDialog,
    waTemplates, handleSyncTemplates, handleSendTemplate,
    syncingTemplates, sendingTemplate,
  } = useMensajeria()

  return (
    <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
      <DialogContent className="wa-scope max-w-md gap-3 border-0 bg-[var(--wa-raised)] text-[var(--wa-text)] shadow-[0_24px_70px_-12px_rgba(0,0,0,0.8),0_0_0_0.5px_rgba(255,255,255,0.08)] sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[17px] text-[var(--wa-text)] lg:text-[16px]">
            <FileText aria-hidden className="size-4 text-[var(--wa-accent)]" />
            Enviar plantilla de WhatsApp
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[var(--wa-text-2)]">
            Las plantillas aprobadas por Meta: se pueden mandar aunque el cliente no haya escrito en las últimas 24 horas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-[var(--wa-text-2)]">Aprobadas</p>
            <button
              type="button"
              onClick={handleSyncTemplates}
              disabled={syncingTemplates}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium text-[var(--wa-accent)] outline-none transition-colors hover:bg-[var(--wa-hover)] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
            >
              <RefreshCw aria-hidden className={`size-3.5 ${syncingTemplates ? 'animate-spin' : ''}`} />
              Sincronizar
            </button>
          </div>

          {syncingTemplates && waTemplates.length === 0 ? (
            <div role="status" className="flex justify-center py-8 text-[var(--wa-text-2)]">
              <Loader2 aria-hidden className="size-5 animate-spin" />
              <span className="sr-only">Sincronizando plantillas</span>
            </div>
          ) : waTemplates.length === 0 ? (
            <div className="py-8 text-center">
              <FileText aria-hidden className="mx-auto mb-2 size-8 text-[var(--wa-text-3)]" />
              <p className="text-[13px] text-[var(--wa-text)]">No se encontraron plantillas aprobadas</p>
              <p className="mt-1 text-[12px] text-[var(--wa-text-2)]">Creá una en Meta Business y tocá Sincronizar.</p>
            </div>
          ) : (
            <div className="wa-scroll max-h-[300px] space-y-2 overflow-y-auto">
              {waTemplates.map((tpl) => (
                <div key={tpl.id} className="rounded-xl bg-[var(--wa-field)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-[var(--wa-text)]">{nombreLegibleDePlantilla(tpl.name)}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="rounded-full bg-[var(--wa-accent)]/15 px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--wa-accent)]">
                          {tpl.language}
                        </span>
                        <span className="rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[10.5px] font-medium text-sky-300">
                          {tpl.category}
                        </span>
                      </div>
                      {tpl.components?.map((comp: { type?: string; text?: string }, i: number) => (
                        comp.type === 'BODY' && comp.text ? (
                          <p key={i} className="mt-1.5 line-clamp-3 text-[12px] leading-snug text-[var(--wa-text-2)]">{comp.text}</p>
                        ) : null
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSendTemplate(tpl)}
                      disabled={sendingTemplate}
                      className="shrink-0 rounded-full bg-[var(--wa-accent)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--wa-on-accent)] outline-none transition-colors hover:bg-[var(--wa-accent-hover)] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--wa-field)]"
                    >
                      {sendingTemplate ? <Loader2 aria-label="Enviando" className="size-4 animate-spin" /> : 'Enviar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
