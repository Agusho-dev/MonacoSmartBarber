"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { loginWithEmail } from "@/lib/actions/auth"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Scissors, Loader2 } from "lucide-react"

type LoginState = {
  error?: string
  success?: boolean
} | null

export default function StaffLoginPage() {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(
    loginWithEmail,
    null
  )

  useEffect(() => {
    if (state?.success) {
      router.push("/dashboard")
    }
  }, [state, router])

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full border border-muted-foreground/25">
          <Scissors className="size-5 text-foreground" />
        </div>
        <CardTitle className="text-xl tracking-tight">
          Monaco Smart Barber
        </CardTitle>
        <CardDescription>Acceso al panel de administración</CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-4">
          {state?.error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="admin@monaco.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Iniciar sesión
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
