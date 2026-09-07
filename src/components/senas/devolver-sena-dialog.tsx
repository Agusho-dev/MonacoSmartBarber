'use client'

// =============================================================================
// Devolver una seña. Es la única pantalla del dashboard que saca plata de la
// cuenta de Mercado Pago de una sucursal, así que está escrita para frenar,
// no para agilizar:
//
//  · El motivo es OBLIGATORIO y queda guardado en la fila. Una devolución sin
//    autor ni motivo es una devolución que nadie puede explicar tres meses
//    después, cuando el dueño mira el resumen de Mercado Pago.
//  · Si la seña está dentro del plazo de arrepentimiento, se dice con todas las
//    letras y ANTES de decidir: el art. 1110 CCyC le da al cliente 10 días
//    corridos para pedir la devolución total de una compra a distancia, es
//    irrenunciable, y la Disposición 377/2026 declara abusiva la cláusula que
//    lo limite. En esos días "la seña se pierde" no es una opción.
//  · La devolución parcial existe pero está plegada. El caso normal es total;
//    ofrecer los dos con el mismo peso invita a errores de tipeo sobre plata.
//
// Mercado Pago acepta devoluciones hasta 180 días después del pago y necesita
// saldo en la cuenta: los dos errores posibles vuelven traducidos desde el
// motor y se muestran acá, sin cerrar el diálogo.
// =============================================================================

import { useState, useTransition } from 'react'
import { AlertTriangle, Loader2, RotateCcw, Scale } from 'lucide-react'
import { toast } from 'sonner'

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency } from '@/lib/format'
import { devolverSenaAction, type SenaListada } from '@/lib/actions/senas'

interface Props {
    /**
     * La seña a devolver. El componente se monta SÓLO cuando hay una, y con
     * `key` por id: el formulario nace vacío en cada apertura sin ningún efecto
     * de reseteo (arrastrar el motivo de la devolución anterior es la forma más
     * fácil de dejar registrado un motivo que no corresponde).
     */
    sena: SenaListada
    /** `branch_deposit_settings.arrepentimiento_days` de la sucursal de la seña. */
    diasDeArrepentimiento: number
    onCerrar: () => void
    onDevuelta: () => void
}

export function DevolverSenaDialog({ sena, diasDeArrepentimiento, onCerrar, onDevuelta }: Props) {
    const [motivo, setMotivo] = useState('')
    const [parcial, setParcial] = useState(false)
    const [monto, setMonto] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [enviando, iniciar] = useTransition()

    const dentroDelPlazo = enPlazo(sena.paidAt, diasDeArrepentimiento)
    const yaDevuelta = sena.status === 'devuelta' || sena.status === 'sin_cupo'

    function confirmar() {
        const texto = motivo.trim()
        if (texto.length < 3) {
            setError('Escribí el motivo de la devolución.')
            return
        }
        let montoParcial: number | undefined
        if (parcial) {
            const n = Number(monto)
            if (!Number.isFinite(n) || n <= 0) {
                setError('El monto a devolver tiene que ser mayor a cero.')
                return
            }
            if (n > sena.amount) {
                setError(`No se puede devolver más de lo que se cobró (${formatCurrency(sena.amount)}).`)
                return
            }
            montoParcial = n
        }

        setError(null)
        iniciar(async () => {
            const r = await devolverSenaAction(sena.id, texto, montoParcial)
            if (!r.ok) {
                // El error se deja FIJO en el diálogo y no en un toast: "no hay
                // saldo en la cuenta" es algo que hay que ir a resolver, no algo
                // que se lee en cinco segundos.
                setError(r.error ?? 'No pudimos devolver la seña.')
                return
            }
            toast.success('Seña devuelta por Mercado Pago')
            onDevuelta()
        })
    }

    return (
        <Dialog open onOpenChange={abierto => !abierto && !enviando && onCerrar()}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Devolver la seña</DialogTitle>
                    <DialogDescription>
                        {formatCurrency(sena.amount)} a {sena.clientName ?? 'el cliente'} · turno del{' '}
                        {sena.appointmentDate.split('-').reverse().join('/')} a las {sena.startTime.slice(0, 5)}
                        {sena.branchName ? ` en ${sena.branchName}` : ''}.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {dentroDelPlazo && (
                        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                            <Scale className="mt-0.5 size-4 shrink-0 text-amber-600" />
                            <p className="text-xs leading-relaxed">
                                <span className="font-semibold">
                                    Esta seña está dentro de los {diasDeArrepentimiento} días de arrepentimiento.
                                </span>{' '}
                                Si el cliente la pide, la devolución total es un derecho suyo y no se le puede negar
                                (art. 1110 del Código Civil y Comercial). No depende de la política de cancelación del
                                local.
                            </p>
                        </div>
                    )}

                    {yaDevuelta && (
                        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                            <p className="text-xs leading-relaxed">
                                Esta seña figura como devuelta. Volver a devolverla sólo tiene sentido si la primera
                                devolución fue parcial.
                            </p>
                        </div>
                    )}

                    <div>
                        <Label htmlFor="motivo-devolucion" className="text-sm">
                            Motivo
                        </Label>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Queda guardado con la seña. Escribilo como para que se entienda dentro de tres meses.
                        </p>
                        <Textarea
                            id="motivo-devolucion"
                            value={motivo}
                            onChange={e => setMotivo(e.target.value)}
                            rows={3}
                            maxLength={500}
                            className="mt-2"
                            placeholder="El cliente pidió la devolución por teléfono; se le cerró el local ese día."
                        />
                    </div>

                    <div>
                        <button
                            type="button"
                            onClick={() => setParcial(v => !v)}
                            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                            {parcial ? 'Devolver todo' : 'Devolver sólo una parte'}
                        </button>

                        {parcial && (
                            <div className="mt-2">
                                <Label htmlFor="monto-devolucion" className="text-xs">
                                    Monto a devolver (de {formatCurrency(sena.amount)})
                                </Label>
                                <Input
                                    id="monto-devolucion"
                                    type="number"
                                    min={1}
                                    max={sena.amount}
                                    value={monto}
                                    onChange={e => setMonto(e.target.value)}
                                    className="mt-1 tabular-nums"
                                />
                            </div>
                        )}
                    </div>

                    {error && (
                        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
                            <p className="text-xs leading-relaxed">{error}</p>
                        </div>
                    )}

                    <p className="text-xs leading-relaxed text-muted-foreground">
                        La plata sale de la cuenta de Mercado Pago de la sucursal y vuelve al medio de pago del cliente.
                        Puede tardar unos días en verse acreditada, según el banco. La comisión de Mercado Pago no se
                        recupera.
                    </p>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={onCerrar} disabled={enviando}>
                        Volver
                    </Button>
                    <Button onClick={confirmar} disabled={enviando}>
                        {enviando ? (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        ) : (
                            <RotateCcw className="mr-1.5 size-3.5" />
                        )}
                        Devolver {parcial && monto ? formatCurrency(Number(monto) || 0) : formatCurrency(sena.amount)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function enPlazo(paidAt: string | null, dias: number): boolean {
    if (!paidAt || dias <= 0) return false
    return Date.now() <= new Date(paidAt).getTime() + dias * 24 * 60 * 60 * 1000
}
