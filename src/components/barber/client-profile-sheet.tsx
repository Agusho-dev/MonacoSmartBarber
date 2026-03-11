'use client'

import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
import type { Client } from '@/lib/types/database'
import { Instagram, User } from 'lucide-react'
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
    if (!client) return null

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
                            <div className="text-sm font-medium mt-1">
                                {client.instagram ? client.instagram : <span className="text-muted-foreground font-normal">No especificado</span>}
                            </div>
                        </div>

                        <div>
                            <label className="mb-1.5 block text-sm font-medium">
                                Observaciones internas
                            </label>
                            <div className="w-full rounded-md border bg-transparent px-3 py-2 text-sm text-foreground min-h-[80px]">
                                {client.notes ? client.notes : <span className="text-muted-foreground">Ninguna</span>}
                            </div>
                        </div>
                    </div>

                    <div className="pt-2">
                        <h3 className="mb-2 text-sm font-semibold">Historial del Cliente</h3>
                        <ClientHistory clientId={client.id} />
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    )
}
