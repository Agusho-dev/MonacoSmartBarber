'use client'

import { useState, useEffect, useTransition } from 'react'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
import { updateClientNotes } from '@/lib/actions/clients'
import type { Client } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Save, Instagram, User } from 'lucide-react'
import { toast } from 'sonner'
import { ClientHistory } from './client-history'

interface ClientProfileSheetProps {
    client: Client | null
    isOpen: boolean
    onClose: () => void
}

export function ClientProfileSheet({
    client,
    isOpen,
    onClose,
}: ClientProfileSheetProps) {
    const [editableNotes, setEditableNotes] = useState('')
    const [editableInstagram, setEditableInstagram] = useState('')
    const [isSaving, startSaving] = useTransition()

    useEffect(() => {
        if (client) {
            setEditableNotes(client.notes ?? '')
            setEditableInstagram(client.instagram ?? '')
        }
    }, [client])

    if (!client) return null

    const handleSave = () => {
        startSaving(async () => {
            const result = await updateClientNotes(
                client.id,
                editableNotes.trim() || null,
                editableInstagram.trim() || null
            )
            if (result.error) {
                toast.error(result.error)
            } else {
                toast.success('Perfil actualizado correctamente')
                client.notes = editableNotes.trim() || null
                client.instagram = editableInstagram.trim() || null
            }
        })
    }

    const hasChanges =
        editableNotes !== (client.notes ?? '') ||
        editableInstagram !== (client.instagram ?? '')

    return (
        <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto pb-8">
                <SheetHeader className="mb-6">
                    <SheetTitle className="flex items-center gap-2">
                        <User className="size-5" />
                        Perfil de {client.name}
                    </SheetTitle>
                    <p className="text-sm text-muted-foreground">{client.phone}</p>
                </SheetHeader>

                <div className="space-y-6">
                    {/* Notes and Instagram */}
                    <div className="space-y-4 rounded-lg border bg-card/30 p-4">
                        <div>
                            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                                <Instagram className="size-4" />
                                Instagram
                            </label>
                            <Input
                                value={editableInstagram}
                                onChange={(e) => setEditableInstagram(e.target.value)}
                                placeholder="@usuario"
                            />
                        </div>

                        <div>
                            <label className="mb-1.5 block text-sm font-medium">
                                Observaciones internas
                            </label>
                            <textarea
                                value={editableNotes}
                                onChange={(e) => setEditableNotes(e.target.value)}
                                placeholder="Ej: Prefiere degradé bajo, alérgico a ciertos productos..."
                                rows={3}
                                className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                        </div>

                        <div className="flex justify-end">
                            <Button
                                size="sm"
                                variant="default"
                                disabled={isSaving || !hasChanges}
                                onClick={handleSave}
                            >
                                <Save className="mr-2 size-4" />
                                {isSaving ? 'Guardando...' : 'Guardar Cambios'}
                            </Button>
                        </div>
                    </div>

                    <div className="pt-2">
                        <h3 className="mb-4 text-sm font-semibold">Historial del Cliente</h3>
                        <ClientHistory clientId={client.id} />
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    )
}
