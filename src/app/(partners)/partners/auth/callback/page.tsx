import { redirect } from 'next/navigation'
import Link from 'next/link'
import { consumeMagicLinkAndLogin } from '@/lib/actions/partner-portal'
import { validatePartnerMagicLink } from '@/lib/partners/magic-link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { XCircle, LogIn } from 'lucide-react'

export const dynamic = 'force-dynamic'

async function loginAction(formData: FormData) {
  'use server'
  const token = String(formData.get('token') || '')
  const result = await consumeMagicLinkAndLogin(token)
  if (!result.success) {
    redirect(`/partners/auth/callback?token=${encodeURIComponent(token)}`)
  }
  redirect('/partners/dashboard')
}

export default async function PartnerAuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  if (!token) {
    return <ErrorCard message="Link inválido. Volvé a solicitarlo." />
  }

  const validation = await validatePartnerMagicLink(token)
  if (!validation.ok) {
    return <ErrorCard message={validation.error} />
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 space-y-4 text-center">
          <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <LogIn className="size-7 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Acceso a tu portal</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tocá &quot;Continuar&quot; para iniciar sesión.
            </p>
          </div>
          <form action={loginAction}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" className="w-full">
              Continuar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-red-200 dark:border-red-900">
        <CardContent className="p-6 space-y-4 text-center">
          <div className="size-14 rounded-full bg-red-100 dark:bg-red-950/50 flex items-center justify-center mx-auto">
            <XCircle className="size-7 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">No pudimos iniciar sesión</h1>
            <p className="text-sm text-muted-foreground mt-1">{message}</p>
          </div>
          <Button asChild className="w-full">
            <Link href="/partners/login">Solicitar nuevo link</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
