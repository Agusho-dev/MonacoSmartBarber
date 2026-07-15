'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { directProductSale } from '@/lib/actions/sales'
import { getTransferAccountsState } from '@/lib/actions/paymentAccounts'
import type { PaymentMethod, Product } from '@/lib/types/database'
import { pickTransferAccount, type TransferAccountState } from '@/lib/payment-accounts'
import { TransferAccountPicker } from './transfer-account-picker'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Banknote,
  CreditCard,
  ArrowRightLeft,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { toast } from 'sonner'

const PAYMENT_OPTIONS: {
  value: PaymentMethod
  label: string
  icon: React.ElementType
}[] = [
    { value: 'cash', label: 'Efectivo', icon: Banknote },
    { value: 'card', label: 'Tarjeta', icon: CreditCard },
    { value: 'transfer', label: 'Transferencia', icon: ArrowRightLeft },
  ]

interface DirectSaleDialogProps {
  open: boolean
  branchId: string
  barberId: string
  onClose: () => void
  onCompleted?: () => void
}

export function DirectSaleDialog({
  open,
  branchId,
  barberId,
  onClose,
  onCompleted,
}: DirectSaleDialogProps) {
  const supabase = useMemo(() => createClient(), [])

  const [products, setProducts] = useState<Product[]>([])
  const [paymentAccounts, setPaymentAccounts] = useState<TransferAccountState[]>([])
  const [rotatedFrom, setRotatedFrom] = useState<TransferAccountState[]>([])
  const [allAccountsFull, setAllAccountsFull] = useState(false)
  const [loading, setLoading] = useState(false)

  // Selection state
  const [selectedProducts, setSelectedProducts] = useState<{ id: string, quantity: number }[]>([])
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')

  useEffect(() => {
    if (!open) {
      // Diferimos los resets para evitar cascading renders.
      queueMicrotask(() => {
        setSelectedProducts([])
        setSelectedPayment(null)
        setSelectedAccountId('')
      })
      return
    }

    supabase
      .from('products')
      .select('*')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) setProducts(data as Product[])
      })

    // Mismo criterio que el cobro de un servicio: acumulado real del mes desde el ledger
    // y rotación a la primera cuenta que todavía tenga margen (mig 160). Server action
    // que valida la sesión de barbero (la RPC no se expone a anon).
    getTransferAccountsState(branchId).then((accs) => {
      setPaymentAccounts(accs)
      const pick = pickTransferAccount(accs)
      setRotatedFrom(pick.skipped)
      setAllAccountsFull(pick.allFull)
      if (pick.account) setSelectedAccountId(pick.account.id)
    })
  }, [open, branchId, supabase])

  async function finishSale() {
    if (selectedProducts.length === 0) {
      toast.error('Seleccioná al menos un producto')
      return
    }
    if (!selectedPayment) return

    setLoading(true)
    try {
      const result = await directProductSale(
        branchId,
        barberId,
        selectedPayment,
        selectedProducts,
        selectedAccountId || null
      )

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Venta registrada exitosamente')
        onCompleted?.()
        onClose()
      }
    } catch {
      toast.error('Error al registrar la venta')
    }
    setLoading(false)
  }

  const totalPrice = selectedProducts.reduce((total, p) => {
    return total + ((products.find(x => x.id === p.id)?.sale_price ?? 0) * p.quantity)
  }, 0)

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Venta Directa de Productos</DialogTitle>
          <DialogDescription>
            Registrá la venta de productos fuera de un turno programado.
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="space-y-6">
          {/* Products */}
          <div>
            <p className="mb-2 text-sm font-medium">Productos</p>
            {selectedProducts.length > 0 && (
              <div className="mb-4 space-y-2">
                {selectedProducts.map((p) => {
                  const prod = products.find((x) => x.id === p.id)
                  if (!prod) return null
                  return (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border bg-white/5 border-white/10 p-2">
                      <span className="text-sm font-medium">{prod.name} (+${prod.sale_price * p.quantity})</span>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 rounded-md bg-black/20 px-2 py-1">
                          <button type="button" onClick={() => setSelectedProducts(prev => prev.map(x => x.id === p.id ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))} className="text-muted-foreground hover:text-white">-</button>
                          <span className="text-sm w-4 text-center">{p.quantity}</span>
                          <button type="button" onClick={() => setSelectedProducts(prev => prev.map(x => x.id === p.id ? { ...x, quantity: x.quantity + 1 } : x))} className="text-muted-foreground hover:text-white">+</button>
                        </div>
                        <button type="button" onClick={() => setSelectedProducts((prev) => prev.filter((x) => x.id !== p.id))} className="text-red-400 hover:text-red-300 p-1">
                          <X className="size-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            
            {products.length === 0 ? (
               <p className="text-sm text-muted-foreground">No hay productos activos disponibles.</p>
            ) : (
              <Select
                value=""
                onValueChange={(id) => {
                  if (id && !selectedProducts.find(x => x.id === id)) {
                    setSelectedProducts((prev) => [...prev, { id, quantity: 1 }])
                  }
                }}
              >
                <SelectTrigger className="h-14 w-full text-lg">
                  <SelectValue placeholder="Seleccionar un producto..." />
                </SelectTrigger>
                <SelectContent>
                  {products
                    .filter((p) => !selectedProducts.find(x => x.id === p.id))
                    .map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} — ${product.sale_price} 
                        {product.stock !== null ? ` (Stock: ${product.stock})` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="pb-2 border-b text-center mb-6 mt-2">
            <p className="text-sm font-medium text-muted-foreground mb-1">Total a cobrar</p>
            <p className="text-5xl font-black">${totalPrice}</p>
          </div>

          {/* Payment method */}
          <div>
            <p className="mb-3 text-sm font-medium">Método de pago</p>
            <div className="grid grid-cols-3 gap-3">
              {PAYMENT_OPTIONS.map((option) => {
                const Icon = option.icon
                const selected = selectedPayment === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSelectedPayment(option.value)}
                    className={cn(
                      'flex flex-col items-center gap-3 rounded-xl border-2 p-4 transition-colors',
                      selected
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
                    )}
                  >
                    <Icon className="size-8" />
                    <span className="text-sm font-semibold">{option.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Payment account (componente compartido con el cobro de servicios) */}
          {selectedPayment === 'transfer' && paymentAccounts.length > 0 && (
            <TransferAccountPicker
              accounts={paymentAccounts}
              selectedAccountId={selectedAccountId}
              onSelect={setSelectedAccountId}
              rotatedFrom={rotatedFrom}
              allFull={allAccountsFull}
              amountText={formatCurrency(totalPrice)}
              showAliasHero={false}
            />
          )}

          <Button
            className="h-16 w-full text-xl mt-4"
            size="lg"
            onClick={finishSale}
            disabled={loading || !selectedPayment || selectedProducts.length === 0}
          >
            {loading ? 'Procesando...' : 'Confirmar Venta'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
