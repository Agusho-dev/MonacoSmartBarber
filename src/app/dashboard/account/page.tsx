import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Lock, Receipt, MailCheck, Phone } from 'lucide-react'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { ChangePasswordForm } from './change-password-form'
import { BillingProfileForm } from './billing-profile-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mi cuenta · BarberOS' }

export default async function AccountPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const admin = createAdminClient()
  const [orgRes, subRes] = await Promise.all([
    admin.from('organizations').select('id, name, slug').eq('id', orgId).maybeSingle(),
    admin.from('organization_subscriptions')
      .select('billing_email, billing_legal_name, billing_tax_id, billing_address, billing_whatsapp, plan_id, status')
      .eq('organization_id', orgId)
      .maybeSingle(),
  ])

  const org = orgRes.data
  const sub = subRes.data

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-bold">Mi cuenta</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestioná tu acceso, datos de facturación y suscripción.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Datos de la cuenta */}
        <section className="rounded-xl border bg-card p-6">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Lock className="size-4" /> Acceso
          </h2>
          <div className="mt-4 space-y-3 text-sm">
            <Row label="Email de inicio de sesión" value={user.email ?? '—'} />
            <Row label="Organización" value={org?.name ?? '—'} sub={`/${org?.slug ?? ''}`} />
            <Row label="Plan actual" value={sub?.plan_id ?? '—'} sub={sub?.status ?? ''} capitalize />
          </div>
          <div className="mt-5 border-t pt-4">
            <h3 className="text-sm font-medium">Cambiar contraseña</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Mínimo 8 caracteres. Tras el cambio, vas a seguir logueado.
            </p>
            <div className="mt-3">
              <ChangePasswordForm />
            </div>
          </div>
        </section>

        {/* Datos de facturación */}
        <section className="rounded-xl border bg-card p-6">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Receipt className="size-4" /> Datos de facturación
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Usamos esta información para emitir factura cuando corresponda y para coordinar pagos.
          </p>
          <div className="mt-4">
            <BillingProfileForm
              defaults={{
                billing_email: sub?.billing_email ?? user.email ?? '',
                billing_legal_name: sub?.billing_legal_name ?? '',
                billing_tax_id: sub?.billing_tax_id ?? '',
                billing_address: sub?.billing_address ?? '',
                billing_whatsapp: sub?.billing_whatsapp ?? '',
              }}
            />
          </div>
        </section>
      </div>

      {/* Mini status */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Link
          href="/dashboard/billing"
          className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary"
        >
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Receipt className="size-5" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">Facturación</div>
            <div className="text-xs text-muted-foreground">Plan, uso y cambio de plan</div>
          </div>
        </Link>
        <Link
          href="/dashboard/billing/historial"
          className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary"
        >
          <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
            <Receipt className="size-5" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">Historial de pagos</div>
            <div className="text-xs text-muted-foreground">Comprobantes y períodos cubiertos</div>
          </div>
        </Link>
        <a
          href="https://wa.me/?text=Hola,%20soy%20de%20BarberOS"
          target="_blank"
          rel="noreferrer"
          className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary"
        >
          <div className="flex size-10 items-center justify-center rounded-lg bg-green-500/10 text-green-600">
            <Phone className="size-5" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">Contactanos</div>
            <div className="text-xs text-muted-foreground">Soporte por WhatsApp</div>
          </div>
        </a>
      </div>
    </div>
  )
}

function Row({
  label, value, sub, capitalize,
}: { label: string; value: string; sub?: string; capitalize?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="text-right">
        <div className={capitalize ? 'capitalize' : ''}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  )
}
