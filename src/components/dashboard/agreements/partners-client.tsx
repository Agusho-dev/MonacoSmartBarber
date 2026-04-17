'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  ArrowLeft,
  Plus,
  Store,
  Mail,
  Phone,
  Link2,
  PauseCircle,
  PlayCircle,
  Ban,
  Copy,
  Check,
  Trash2,
  Loader2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  deletePartnerFromOrg,
  regeneratePartnerMagicLink,
  updatePartnerRelationStatus,
} from '@/lib/actions/partners'

interface PartnerRow {
  id: string
  status: 'active' | 'paused' | 'revoked'
  invited_at: string
  revoked_at: string | null
  partner: {
    id: string
    business_name: string
    contact_email: string | null
    contact_phone: string | null
    logo_url: string | null
    created_at: string
  } | null
}

export function PartnersClient({ partners }: { partners: PartnerRow[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [linkDialog, setLinkDialog] = useState<{ url: string; whatsappSent: boolean; partnerName: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const onRegenerate = (partnerId: string, partnerName: string) => {
    startTransition(async () => {
      const r = await regeneratePartnerMagicLink(partnerId)
      if (r.success && r.magicLinkUrl) {
        setLinkDialog({ url: r.magicLinkUrl, whatsappSent: !!r.whatsappSent, partnerName })
      } else {
        toast.error(r.error ?? 'Error')
      }
    })
  }

  const onChangeStatus = (partnerId: string, newStatus: 'active' | 'paused' | 'revoked') => {
    startTransition(async () => {
      const r = await updatePartnerRelationStatus(partnerId, newStatus)
      if (r.success) {
        toast.success(
          newStatus === 'revoked' ? 'Relación revocada' :
          newStatus === 'paused' ? 'Convenio pausado' : 'Convenio reactivado'
        )
        router.refresh()
      } else toast.error(r.error ?? 'Error')
    })
  }

  const onConfirmDelete = () => {
    if (!deleteTarget) return
    const target = deleteTarget
    startTransition(async () => {
      const r = await deletePartnerFromOrg(target.id)
      if (r.success) {
        toast.success(`"${target.name}" eliminado`)
        setDeleteTarget(null)
        router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo eliminar')
      }
    })
  }

  const copyLink = async (url: string) => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    toast.success('Link copiado')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2">
            <Link href="/dashboard/convenios">
              <ArrowLeft className="size-4 mr-2" />
              Volver a convenios
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Store className="size-6 text-primary" />
            Partners aliados
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Comercios que ofrecen beneficios a tus clientes.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/convenios/partners/new">
            <Plus className="size-4 mr-2" />
            Invitar partner
          </Link>
        </Button>
      </header>

      {partners.length === 0 ? (
        <EmptyPartners />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {partners.map((row) => {
            if (!row.partner) return null
            const p = row.partner
            return (
              <Card key={row.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <Avatar className="size-12 shrink-0">
                      {p.logo_url && <AvatarImage src={p.logo_url} alt={p.business_name} />}
                      <AvatarFallback>
                        {p.business_name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{p.business_name}</p>
                      <PartnerStatusBadge status={row.status} />
                    </div>
                  </div>

                  <div className="space-y-1 text-sm">
                    {p.contact_email && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="size-3.5" />
                        <span className="truncate">{p.contact_email}</span>
                      </div>
                    )}
                    {p.contact_phone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="size-3.5" />
                        <span>{p.contact_phone}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => onRegenerate(p.id, p.business_name)}
                      disabled={isPending}
                    >
                      <Link2 className="size-3.5 mr-1.5" />
                      Enviar link
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" disabled={isPending}>
                          •••
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {row.status === 'active' && (
                          <DropdownMenuItem onClick={() => onChangeStatus(p.id, 'paused')}>
                            <PauseCircle className="size-4 mr-2" />
                            Pausar relación
                          </DropdownMenuItem>
                        )}
                        {row.status === 'paused' && (
                          <DropdownMenuItem onClick={() => onChangeStatus(p.id, 'active')}>
                            <PlayCircle className="size-4 mr-2" />
                            Reactivar
                          </DropdownMenuItem>
                        )}
                        {row.status !== 'revoked' && (
                          <DropdownMenuItem
                            onClick={() => onChangeStatus(p.id, 'revoked')}
                            className="text-red-600 focus:text-red-600"
                          >
                            <Ban className="size-4 mr-2" />
                            Revocar convenio
                          </DropdownMenuItem>
                        )}
                        {row.status === 'revoked' && (
                          <DropdownMenuItem onClick={() => onChangeStatus(p.id, 'active')}>
                            <PlayCircle className="size-4 mr-2" />
                            Reactivar convenio
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget({ id: p.id, name: p.business_name })}
                          className="text-red-600 focus:text-red-600"
                        >
                          <Trash2 className="size-4 mr-2" />
                          Eliminar partner
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && !isPending && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar partner</DialogTitle>
            <DialogDescription>
              ¿Seguro que querés eliminar a <strong>{deleteTarget?.name}</strong> de tus partners?
              Esta acción quita la relación y borra todos sus beneficios cargados para tu organización.
              No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmDelete}
              disabled={isPending}
            >
              {isPending ? (
                <><Loader2 className="size-4 mr-2 animate-spin" /> Eliminando...</>
              ) : (
                <><Trash2 className="size-4 mr-2" /> Eliminar</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkDialog} onOpenChange={(v) => !v && setLinkDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link de acceso generado</DialogTitle>
            <DialogDescription>
              Compartilo con {linkDialog?.partnerName} para que ingrese a cargar sus beneficios.
              El link caduca en 72 horas.
            </DialogDescription>
          </DialogHeader>
          {linkDialog && (
            <div className="space-y-3">
              {linkDialog.whatsappSent && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 text-sm p-3 flex items-center gap-2">
                  <Check className="size-4 shrink-0" />
                  <span>Enviado por WhatsApp al número del partner.</span>
                </div>
              )}
              <div className="rounded-lg border bg-muted p-3 break-all text-sm font-mono">
                {linkDialog.url}
              </div>
              <Button onClick={() => copyLink(linkDialog.url)} className="w-full" variant={copied ? 'outline' : 'default'}>
                {copied ? (
                  <><Check className="size-4 mr-2" /> Copiado</>
                ) : (
                  <><Copy className="size-4 mr-2" /> Copiar link</>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PartnerStatusBadge({ status }: { status: 'active' | 'paused' | 'revoked' }) {
  const map = {
    active: { label: 'Activo', classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' },
    paused: { label: 'Pausado', classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' },
    revoked: { label: 'Revocado', classes: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  }
  const { label, classes } = map[status]
  return <Badge className={`border-none text-xs ${classes}`}>{label}</Badge>
}

function EmptyPartners() {
  return (
    <div className="text-center py-20 border border-dashed rounded-lg">
      <Store className="size-12 mx-auto text-muted-foreground/40" />
      <h3 className="font-semibold mt-4 text-lg">Todavía no invitaste partners</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
        Empezá invitando un comercio aliado. Le enviaremos un link para que cargue sus beneficios.
      </p>
      <Button asChild className="mt-6">
        <Link href="/dashboard/convenios/partners/new">
          <Plus className="size-4 mr-2" />
          Invitar primer partner
        </Link>
      </Button>
    </div>
  )
}
