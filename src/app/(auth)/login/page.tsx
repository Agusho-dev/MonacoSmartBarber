"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { loginWithEmail } from "@/lib/actions/auth"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowRight } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

type LoginState = { error?: string; success?: boolean } | null

export default function StaffLoginPage() {
  const router = useRouter()
  const [mostrarPassword, setMostrarPassword] = useState(false)
  const [emailFocused, setEmailFocused] = useState(false)
  const [passFocused, setPassFocused] = useState(false)
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
    <div className="space-y-8">
      {/* Encabezado con animación reveal */}
      <div className="space-y-2">
        <div
          className="animate-reveal-up"
          style={{ animationDelay: "0ms", opacity: 0 }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-[0.2em] mb-3"
            style={{ color: "oklch(0.78 0.12 85)" }}
          >
            Panel de gestión
          </p>
        </div>
        <div
          className="animate-reveal-up"
          style={{ animationDelay: "80ms", opacity: 0 }}
        >
          <h1 className="text-3xl font-bold tracking-tight">Bienvenido</h1>
        </div>
        <div
          className="animate-reveal-up"
          style={{ animationDelay: "140ms", opacity: 0 }}
        >
          <p className="text-sm text-white/35">
            Ingresá tus credenciales para continuar
          </p>
        </div>
      </div>

      {/* Card glassmorphism */}
      <div
        className="glass-card rounded-2xl p-6 space-y-5 animate-reveal-up"
        style={{
          animationDelay: "200ms",
          opacity: 0,
        }}
      >
        <form action={formAction} className="space-y-5">
          {/* Alerta de error */}
          {state?.error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 animate-slide-up-fade">
              <span className="mt-1 size-1.5 rounded-full bg-red-400 shrink-0" />
              <p className="text-sm text-red-400">{state.error}</p>
            </div>
          )}

          {/* Campo de email */}
          <div className="space-y-2">
            <Label
              htmlFor="email"
              className="text-xs font-medium text-white/50 uppercase tracking-wider"
            >
              Correo electrónico
            </Label>
            <div className="relative group">
              <Mail
                className={cn(
                  "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 transition-colors duration-300",
                  emailFocused ? "text-[oklch(0.78_0.12_85)]" : "text-white/25"
                )}
              />
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="admin@barberia.com"
                autoComplete="email"
                required
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                className={cn(
                  "pl-10 h-12 bg-white/5 border-white/10 placeholder:text-white/20 transition-all duration-300 rounded-xl",
                  emailFocused &&
                    "border-[oklch(0.78_0.12_85)] ring-2 ring-[oklch(0.78_0.12_85/0.15)] bg-white/[0.07]"
                )}
              />
            </div>
          </div>

          {/* Campo de contraseña */}
          <div className="space-y-2">
            <Label
              htmlFor="password"
              className="text-xs font-medium text-white/50 uppercase tracking-wider"
            >
              Contraseña
            </Label>
            <div className="relative group">
              <Lock
                className={cn(
                  "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 transition-colors duration-300",
                  passFocused ? "text-[oklch(0.78_0.12_85)]" : "text-white/25"
                )}
              />
              <Input
                id="password"
                name="password"
                type={mostrarPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                onFocus={() => setPassFocused(true)}
                onBlur={() => setPassFocused(false)}
                className={cn(
                  "pl-10 pr-10 h-12 bg-white/5 border-white/10 transition-all duration-300 rounded-xl",
                  passFocused &&
                    "border-[oklch(0.78_0.12_85)] ring-2 ring-[oklch(0.78_0.12_85/0.15)] bg-white/[0.07]"
                )}
              />
              <button
                type="button"
                aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                onClick={() => setMostrarPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60 transition-colors focus-visible:outline-none"
              >
                {mostrarPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>

          {/* Botón de envío dorado */}
          <button
            type="submit"
            disabled={isPending}
            className={cn(
              "btn-gold w-full h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold mt-2 disabled:opacity-50 disabled:pointer-events-none"
            )}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4" />
            )}
            {isPending ? "Ingresando..." : "Iniciar sesión"}
          </button>
        </form>

        {/* Divisor */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-white/8" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span
              className="px-3 text-white/20"
              style={{ background: "oklch(0.1 0 0 / 0.6)" }}
            >
              o
            </span>
          </div>
        </div>

        {/* Enlace a registro */}
        <p className="text-center text-sm text-white/35">
          ¿No tenés una cuenta?{" "}
          <Link
            href="/register"
            className="font-medium transition-colors hover:underline underline-offset-4"
            style={{ color: "oklch(0.78 0.12 85)" }}
          >
            Crear barbería
          </Link>
        </p>
      </div>
    </div>
  )
}
