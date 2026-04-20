'use client'

import { useTransition } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { generatePeriodsForCurrentOrg } from '@/lib/actions/fixed-expenses'
import { toast } from 'sonner'

interface GeneratePeriodsButtonProps {
    year: number
    month: number
    /** Label cambia si es la primera vez o si es un top-up. */
    variant?: 'primary' | 'secondary'
    size?: 'default' | 'sm' | 'lg'
    className?: string
}

export function GeneratePeriodsButton({
    year,
    month,
    variant = 'secondary',
    size = 'sm',
    className,
}: GeneratePeriodsButtonProps) {
    const [isPending, startTransition] = useTransition()

    const handleGenerate = () => {
        startTransition(async () => {
            const result = await generatePeriodsForCurrentOrg(year, month)
            if (result.error) {
                toast.error(result.error)
                return
            }
            if (result.created === 0) {
                toast.info('No hay nuevos gastos para generar', {
                    description: 'Todos los gastos activos ya tienen período para este mes',
                })
            } else {
                toast.success(
                    `${result.created} período${result.created === 1 ? '' : 's'} generado${result.created === 1 ? '' : 's'}`,
                    { duration: 2400 }
                )
            }
        })
    }

    return (
        <Button
            onClick={handleGenerate}
            disabled={isPending}
            variant={variant === 'primary' ? 'default' : 'outline'}
            size={size}
            className={className}
        >
            {isPending ? (
                <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    Generando...
                </>
            ) : (
                <>
                    <Sparkles className="mr-1.5 size-3.5" />
                    Generar pagos del mes
                </>
            )}
        </Button>
    )
}
