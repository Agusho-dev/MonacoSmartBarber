"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { registerOrganization } from "@/lib/actions/register"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Building2,
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  ArrowRight,
  Link as LinkIcon,
  Sparkles,
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

function generateSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

// ─── Campo con ícono y focus dorado ──────────────────────────────────────────

function GoldInput({
  icon: Icon,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { icon: React.ElementType }) {
  const [focused, setFocused] = useState(false)
  return (
    <div className="relative group">
      <Icon
        className={cn(
          "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 transition-colors duration-300",
          focused ? "text-[oklch(0.78_0.12_85)]" : "text-white/25"
        )}
      />
      <Input
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          "pl-10 h-10 bg-white/5 border-white/10 placeholder:text-white/20 transition-all duration-300 rounded-xl text-sm",
          focused && "border-[oklch(0.78_0.12_85)] ring-2 ring-[oklch(0.78_0.12_85/0.15)] bg-white/[0.07]",
          className
        )}
        {...props}
      />
    </div>
  )
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function RegisterPage() {
  const router = useRouter()
  const [mostrarPassword, setMostrarPassword] = useState(false)
  const [mostrarConfirm, setMostrarConfirm] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passFocused, setPassFocused] = useState(false)
  const [confirmFocused, setConfirmFocused] = useState(false)

  const [orgName, setOrgName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugEditado, setSlugEditado] = useState(false)
  const [ownerName, setOwnerName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  function handleOrgNameChange(value: string) {
    setOrgName(value)
    if (!slugEditado) setSlug(generateSlug(value))
  }

  function handleSlugChange(value: string) {
    setSlugEditado(true)
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
    )
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.")
      return
    }

    setIsPending(true)
    const formData = new FormData()
    formData.set("orgName", orgName)
    formData.set("slug", slug)
    formData.set("ownerName", ownerName)
    formData.set("email", email)
    formData.set("password", password)

    const result = await registerOrganization(formData)

    if (result.success) {
      router.push("/onboarding")
    } else {
      setError(
        typeof result.error === "string"
          ? result.error
          : "Error al crear la cuenta. Revisá los datos e intentá de nuevo."
      )
      setIsPending(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="space-y-2">
        <div
          className="animate-reveal-up"
          style={{ animationDelay: "0ms", opacity: 0 }}
        >
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border animate-glow-badge"
            style={{
              color: "oklch(0.78 0.12 85)",
              borderColor: "oklch(0.78 0.12 85 / 0.25)",
              background: "oklch(0.78 0.12 85 / 0.08)",
            }}
          >
            <Sparkles className="size-3" />
            Nuevo registro
          </div>
        </div>
        <div
          className="animate-reveal-up"
          style={{ animationDelay: "60ms", opacity: 0 }}
        >
          <h1 className="text-2xl font-bold tracking-tight">Crear tu barbería</h1>
        </div>
        <div
          className="animate-reveal-up"
          style={{ animationDelay: "100ms", opacity: 0 }}
        >
          <p className="text-sm text-white/35">Configurá tu negocio en minutos</p>
        </div>
      </div>

      {/* Card glassmorphism */}
      <div
        className="glass-card rounded-2xl p-5 space-y-4 animate-reveal-up"
        style={{ animationDelay: "160ms", opacity: 0 }}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Alerta de error */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 animate-slide-up-fade">
              <span className="mt-1 size-1.5 rounded-full bg-red-400 shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Sección: Tu barbería */}
          <div className="space-y-3">
            <p className="text-[10px] font-semibold text-white/25 uppercase tracking-[0.2em]">
              Tu barbería
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1 space-y-1">
                <Label htmlFor="orgName" className="text-xs font-medium text-white/40">
                  Nombre
                </Label>
                <GoldInput
                  id="orgName"
                  icon={Building2}
                  value={orgName}
                  onChange={(e) => handleOrgNameChange(e.target.value)}
                  placeholder="Monaco Barbería"
                  required
                />
              </div>
              <div className="col-span-2 sm:col-span-1 space-y-1">
                <Label htmlFor="slug" className="text-xs font-medium text-white/40">
                  URL
                </Label>
                <GoldInput
                  id="slug"
                  icon={LinkIcon}
                  value={slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="mi-barberia"
                  required
                />
              </div>
            </div>
            {slug && (
              <p className="text-xs text-white/20 pl-1 -mt-1">
                barberos.app/<span style={{ color: "oklch(0.78 0.12 85)" }}>{slug}</span>
              </p>
            )}
          </div>

          {/* Separador */}
          <div className="border-t border-white/6" />

          {/* Sección: Tu cuenta */}
          <div className="space-y-3">
            <p className="text-[10px] font-semibold text-white/25 uppercase tracking-[0.2em]">
              Tu cuenta
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1 space-y-1">
                <Label htmlFor="ownerName" className="text-xs font-medium text-white/40">
                  Nombre completo
                </Label>
                <GoldInput
                  id="ownerName"
                  icon={User}
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Juan Pérez"
                  required
                />
              </div>
              <div className="col-span-2 sm:col-span-1 space-y-1">
                <Label htmlFor="email" className="text-xs font-medium text-white/40">
                  Email
                </Label>
                <GoldInput
                  id="email"
                  icon={Mail}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="juan@barberia.com"
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="password" className="text-xs font-medium text-white/40">
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
                    type={mostrarPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={6}
                    onFocus={() => setPassFocused(true)}
                    onBlur={() => setPassFocused(false)}
                    className={cn(
                      "pl-10 pr-10 h-10 bg-white/5 border-white/10 transition-all duration-300 rounded-xl text-sm",
                      passFocused &&
                        "border-[oklch(0.78_0.12_85)] ring-2 ring-[oklch(0.78_0.12_85/0.15)] bg-white/[0.07]"
                    )}
                  />
                  <button
                    type="button"
                    aria-label={mostrarPassword ? "Ocultar" : "Mostrar"}
                    onClick={() => setMostrarPassword((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60 transition-colors focus-visible:outline-none"
                  >
                    {mostrarPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirmPassword" className="text-xs font-medium text-white/40">
                  Confirmar
                </Label>
                <div className="relative group">
                  <Lock
                    className={cn(
                      "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 transition-colors duration-300",
                      confirmFocused ? "text-[oklch(0.78_0.12_85)]" : "text-white/25"
                    )}
                  />
                  <Input
                    id="confirmPassword"
                    type={mostrarConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={6}
                    onFocus={() => setConfirmFocused(true)}
                    onBlur={() => setConfirmFocused(false)}
                    className={cn(
                      "pl-10 pr-10 h-10 bg-white/5 border-white/10 transition-all duration-300 rounded-xl text-sm",
                      confirmFocused &&
                        "border-[oklch(0.78_0.12_85)] ring-2 ring-[oklch(0.78_0.12_85/0.15)] bg-white/[0.07]"
                    )}
                  />
                  <button
                    type="button"
                    aria-label={mostrarConfirm ? "Ocultar" : "Mostrar"}
                    onClick={() => setMostrarConfirm((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60 transition-colors focus-visible:outline-none"
                  >
                    {mostrarConfirm ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Botón de envío dorado */}
          <button
            type="submit"
            disabled={isPending}
            className="btn-gold w-full h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold mt-1 disabled:opacity-50 disabled:pointer-events-none"
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4" />
            )}
            {isPending ? "Creando cuenta..." : "Crear cuenta"}
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

        {/* Enlace a login */}
        <p className="text-center text-sm text-white/35">
          ¿Ya tenés una cuenta?{" "}
          <Link
            href="/login"
            className="font-medium transition-colors hover:underline underline-offset-4"
            style={{ color: "oklch(0.78 0.12 85)" }}
          >
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
