'use client'

import { useState, useEffect, useTransition } from 'react'
import { MessageCircle, Plus, Pencil, Trash2, GripVertical, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  getQuickReplies, createQuickReply, updateQuickReply,
  deleteQuickReply, reorderQuickReplies,
} from '@/lib/actions/quick-replies'

interface QuickReply {
  id: string
  title: string
  content: string
  shortcut: string | null
  sort_order: number
  created_at: string
}

export function QuickReplySection() {
  const [replies, setReplies] = useState<QuickReply[]>([])
  const [loading, setLoading] = useState(true)
  const [showEditor, setShowEditor] = useState(false)
  const [editingReply, setEditingReply] = useState<QuickReply | null>(null)

  // Form
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formShortcut, setFormShortcut] = useState('')

  const [isSaving, startSaving] = useTransition()

  useEffect(() => {
    getQuickReplies().then(result => {
      if (result.data) setReplies(result.data as QuickReply[])
      setLoading(false)
    })
  }, [])

  const resetForm = () => {
    setFormTitle('')
    setFormContent('')
    setFormShortcut('')
    setEditingReply(null)
  }

  const openEditor = (reply?: QuickReply) => {
    if (reply) {
      setEditingReply(reply)
      setFormTitle(reply.title)
      setFormContent(reply.content)
      setFormShortcut(reply.shortcut || '')
    } else {
      resetForm()
    }
    setShowEditor(true)
  }

  const handleSave = () => {
    if (!formTitle.trim() || !formContent.trim()) {
      toast.error('Título y contenido son requeridos'); return
    }
    startSaving(async () => {
      if (editingReply) {
        const result = await updateQuickReply(editingReply.id, {
          title: formTitle,
          content: formContent,
          shortcut: formShortcut || undefined,
        })
        if (result.error) { toast.error(result.error); return }
        setReplies(prev => prev.map(r => r.id === editingReply.id ? {
          ...r, title: formTitle, content: formContent, shortcut: formShortcut || null,
        } : r))
        toast.success('Mensaje rápido actualizado')
      } else {
        const result = await createQuickReply({
          title: formTitle,
          content: formContent,
          shortcut: formShortcut || undefined,
        })
        if (result.error) { toast.error(result.error); return }
        setReplies(prev => [...prev, result.data as QuickReply])
        toast.success('Mensaje rápido creado')
      }
      setShowEditor(false)
      resetForm()
    })
  }

  const handleDelete = async (id: string) => {
    const result = await deleteQuickReply(id)
    if (result.error) { toast.error(result.error); return }
    setReplies(prev => prev.filter(r => r.id !== id))
    toast.success('Eliminado')
  }

  const moveReply = async (index: number, direction: 'up' | 'down') => {
    const newReplies = [...replies]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newReplies.length) return
    ;[newReplies[index], newReplies[targetIndex]] = [newReplies[targetIndex], newReplies[index]]
    setReplies(newReplies)
    await reorderQuickReplies(newReplies.map(r => r.id))
  }

  return (
    <div className="flex flex-1 min-w-0">
      {/* Lista */}
      <div className="flex flex-col bg-background w-full lg:max-w-md shrink-0 border-r border">
        <div className="flex items-center justify-between px-4 py-3 bg-card border-b border">
          <div className="flex items-center gap-2">
            <MessageCircle className="size-4 text-blue-400" />
            <span className="font-semibold text-foreground text-sm">Mensajes rápidos</span>
          </div>
          <Button size="sm" onClick={() => openEditor()} className="h-7 text-xs bg-green-600 hover:bg-green-500 text-white">
            <Plus className="size-3 mr-1" /> Nuevo
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-green-400" />
            </div>
          ) : replies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <MessageCircle className="mb-3 size-10 opacity-20" />
              <p className="text-sm">Sin mensajes rápidos</p>
              <p className="text-xs mt-1 opacity-60">Creá mensajes predefinidos para responder más rápido</p>
            </div>
          ) : (
            <div>
              {replies.map((reply, index) => (
                <div key={reply.id} className="px-4 py-3 border-b border hover:bg-muted transition-colors">
                  <div className="flex items-start gap-2">
                    {/* Reorder */}
                    <div className="flex flex-col gap-0.5 pt-0.5 shrink-0">
                      <button onClick={() => moveReply(index, 'up')} disabled={index === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                        <ArrowUp className="size-3" />
                      </button>
                      <button onClick={() => moveReply(index, 'down')} disabled={index === replies.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                        <ArrowDown className="size-3" />
                      </button>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-foreground truncate">{reply.title}</span>
                          {reply.shortcut && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono shrink-0">
                              /{reply.shortcut}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button onClick={() => openEditor(reply)} className="text-muted-foreground hover:text-foreground">
                            <Pencil className="size-3.5" />
                          </button>
                          <button onClick={() => handleDelete(reply.id)} className="text-muted-foreground hover:text-red-400">
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{reply.content}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Info panel */}
      <div className="hidden lg:flex flex-1 min-w-0 bg-background flex-col items-center justify-center gap-4">
        <div className="flex size-20 items-center justify-center rounded-full bg-muted border border">
          <MessageCircle className="size-10 text-blue-500/50" />
        </div>
        <div className="text-center max-w-xs">
          <p className="text-sm font-medium text-foreground/70 mb-1">Mensajes rápidos</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Mensajes predefinidos que podés insertar con un clic durante una conversación.
            Usá el shortcut "/" en el chat para acceder rápidamente.
          </p>
        </div>
      </div>

      {/* Editor dialog */}
      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="size-4 text-blue-400" />
              {editingReply ? 'Editar mensaje rápido' : 'Nuevo mensaje rápido'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Título</Label>
              <Input className="bg-background border text-foreground" placeholder="Ej: Horarios de atención"
                value={formTitle} onChange={e => setFormTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Contenido del mensaje</Label>
              <Textarea className="bg-background border text-foreground placeholder:text-muted-foreground resize-none" rows={4}
                placeholder="Nuestros horarios de atención son..."
                value={formContent} onChange={e => setFormContent(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Shortcut (opcional)</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/</span>
                <Input className="bg-background border text-foreground" placeholder="horarios"
                  value={formShortcut} onChange={e => setFormShortcut(e.target.value.replace(/\s/g, ''))} />
              </div>
              <p className="text-[10px] text-muted-foreground">Escribí /{formShortcut || 'shortcut'} en el chat para insertar rápido</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowEditor(false); resetForm() }} className="text-muted-foreground hover:text-foreground">Cancelar</Button>
            <Button className="bg-green-600 hover:bg-green-500 text-white" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Guardando...' : editingReply ? 'Actualizar' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
