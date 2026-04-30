'use client'

import { FileText, RefreshCw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useMensajeria } from '../shared/mensajeria-context'

export function TemplatePicker() {
  const {
    showTemplateDialog, setShowTemplateDialog,
    waTemplates, handleSyncTemplates, handleSendTemplate,
    syncingTemplates, sendingTemplate,
  } = useMensajeria()

  return (
    <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4" />
            Enviar template de WhatsApp
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Templates aprobados por Meta
            </p>
            <button
              onClick={handleSyncTemplates}
              disabled={syncingTemplates}
              className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
            >
              <RefreshCw className={`size-3 ${syncingTemplates ? 'animate-spin' : ''}`} />
              Sincronizar
            </button>
          </div>

          {syncingTemplates && waTemplates.length === 0 ? (
            <div className="flex justify-center py-8">
              <div className="size-5 animate-spin rounded-full border-2 border border-t-green-400" />
            </div>
          ) : waTemplates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="size-8 mx-auto mb-2 opacity-20" />
              <p className="text-xs">No se encontraron templates aprobados</p>
              <p className="text-[10px] mt-1 opacity-60">Creá un template en Meta Business y hacé clic en Sincronizar</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {waTemplates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="rounded-lg border border bg-muted p-3 hover:bg-accent transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{tpl.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400">
                          {tpl.language}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                          {tpl.category}
                        </span>
                      </div>
                      {tpl.components?.map((comp: { type?: string; text?: string }, i: number) => (
                        comp.type === 'BODY' && comp.text ? (
                          <p key={i} className="text-[11px] text-muted-foreground mt-1.5 line-clamp-3">{comp.text}</p>
                        ) : null
                      ))}
                    </div>
                    <button
                      onClick={() => handleSendTemplate(tpl)}
                      disabled={sendingTemplate}
                      className="shrink-0 px-3 py-1.5 rounded-md bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-xs transition-colors"
                    >
                      {sendingTemplate ? '...' : 'Enviar'}
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
