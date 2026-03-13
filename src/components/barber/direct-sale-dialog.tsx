'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { directProductSale } from '@/lib/actions/sales'
import type { PaymentMethod, PaymentAccount, Product } from '@/lib/types/database'
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
  Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'
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
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([])
  const [loading, setLoading] = useState(false)

  // Selection state
  const [selectedProducts, setSelectedProducts] = useState<{ id: string, quantity: number }[]>([])
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')

  useEffect(() => {
    if (!open) {
      setSelectedProducts([])
      setSelectedPayment(null)
      setSelectedAccountId('')
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

    supabase
      .from('payment_accounts')
      .select('*')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name')
      .then(({ data }) => {
        if (data && data.length > 0) {
          const accs = data as PaymentAccount[]
          setPaymentAccounts(accs)

          let selected = accs[0]
          for (const acc of accs) {
            if (acc.daily_limit === null) {
              selected = acc
              break
            }
            if ((acc.accumulated_today ?? 0) < acc.daily_limit) {
              selected = acc
              break
            }
          }
          setSelectedAccountId(selected.id)
        }
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

          {/* Payment account */}
          {selectedPayment === 'transfer' && paymentAccounts.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium flex items-center gap-1.5">
                <Wallet className="size-4" />
                Cuenta de cobro <span className="text-muted-foreground">(opcional)</span>
              </p>
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger className="h-14 w-full text-lg">
                  <SelectValue placeholder="Seleccionar cuenta..." />
                </SelectTrigger>
                <SelectContent>
                  {paymentAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      <span className="font-medium">{acc.name}</span>
                      {acc.alias_or_cbu && (
                        <span className="ml-2 text-muted-foreground text-xs">
                          {acc.alias_or_cbu}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
