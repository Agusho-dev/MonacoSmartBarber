'use client'

import { useState } from 'react'
import { StaffFaceEnrollment } from './staff-face-enrollment'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'

export function BarberFaceCheck({
    needsFaceId,
    staffId,
    staffName,
}: {
    needsFaceId: boolean
    staffId?: string
    staffName?: string
}) {
    const [showPrompt, setShowPrompt] = useState(needsFaceId)

    if (!staffId || !staffName) return null

    // We use a custom full-screen overlay or just a Dialog 
    return (
        <Dialog open={showPrompt} onOpenChange={setShowPrompt}>
            <DialogContent className="sm:max-w-md [&>button:last-child]:hidden p-0 overflow-hidden bg-transparent border-none shadow-none">
                <VisuallyHidden>
                    <DialogTitle>Registro de Face ID</DialogTitle>
                    <DialogDescription>Enrola tu rostro para usar la aplicación</DialogDescription>
                </VisuallyHidden>
                <div className="bg-background rounded-2xl p-6 shadow-xl">
                    <StaffFaceEnrollment
                        staffId={staffId}
                        staffName={staffName}
                        onComplete={() => setShowPrompt(false)}
                        onSkip={() => setShowPrompt(false)}
                        source="barber"
                    />
                </div>
            </DialogContent>
        </Dialog>
    )
}
