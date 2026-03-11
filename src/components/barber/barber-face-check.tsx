'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StaffFaceEnrollment } from './staff-face-enrollment'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'

export function BarberFaceCheck({
    staffId,
    staffName,
}: {
    staffId?: string
    staffName?: string
}) {
    const [showPrompt, setShowPrompt] = useState(false)
    const [checked, setChecked] = useState(false)

    useEffect(() => {
        if (!staffId) return
        const supabase = createClient()
        supabase
            .from('staff_face_descriptors')
            .select('id', { count: 'exact', head: true })
            .eq('staff_id', staffId)
            .then(({ count }) => {
                setChecked(true)
                if (count === 0 || count === null) {
                    setShowPrompt(true)
                }
            })
    }, [staffId])

    if (!staffId || !staffName || !checked) return null

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
