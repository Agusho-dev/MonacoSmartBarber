"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { selectOrganizationBySlug } from "@/lib/actions/org"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Search, Loader2, ArrowRight, LogIn, Building2 } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

// ─── Orbs de fondo animados ───────────────────────────────────────────────────

function BackgroundOrbs() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* Orb dorado top-right */}
      <div
        className="absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full"
        style={{
          background: "radial-gradient(circle, oklch(0.78 0.12 85 / 0.18) 0%, transparent 70%)",
          animation: "orb-pulse 8s ease-in-out infinite",
        }}
      />
      {/* Orb azul/violeta bottom-left */}
      <div
        className="absolute -bottom-48 -left-48 w-[700px] h-[700px] rounded-full"
        style={{
          background: "radial-gradient(circle, oklch(0.5 0.15 270 / 0.12) 0%, transparent 70%)",
          animation: "orb-pulse 10s ease-in-out infinite 2s",
        }}
      />
      {/* Resplandor central sutil */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] rounded-full"
        style={{
          background: "radial-gradient(ellipse, oklch(0.78 0.12 85 / 0.06) 0%, transparent 60%)",
        }}
      />
      {/* Grilla decorativa */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "linear-gradient(oklch(1 0 0) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
    </div>
  )
}

// ─── Partículas decorativas flotantes ─────────────────────────────────────────

function DecorativeParticles() {
  const items = [
    { emoji: "✂️", top: "10%", left: "8%",  delay: "0s",   size: "text-2xl", opacity: "opacity-[0.08]" },
    { emoji: "✂️", top: "20%", right: "6%", delay: "1s",   size: "text-xl",  opacity: "opacity-[0.06]" },
    { emoji: "💈", top: "70%", left: "5%",  delay: "2s",   size: "text-3xl", opacity: "opacity-[0.08]" },
    { emoji: "✂️", top: "85%", right: "8%", delay: "0.5s", size: "text-xl",  opacity: "opacity-[0.06]" },
    { emoji: "🪒", top: "40%", left: "3%",  delay: "1.5s", size: "text-lg",  opacity: "opacity-[0.08]" },
    { emoji: "💈", top: "55%", right: "4%", delay: "3s",   size: "text-2xl", opacity: "opacity-[0.06]" },
  ] as const

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {items.map((item, i) => (
        <span
          key={i}
          className={cn("absolute select-none animate-float", item.size, item.opacity)}
          style={{
            top: item.top,
            left: "left" in item ? item.left : undefined,
            right: "right" in item ? (item as { right: string }).right : undefined,
            animationDelay: item.delay,
            filter: "grayscale(1) brightness(3)",
          }}
        >
          {item.emoji}
        </span>
      ))}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function TenantSelector() {
  const router = useRouter()
  const [slug, setSlug] = useState("")
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!slug.trim()) return

    setIsPending(true)
    setError(null)

    const result = await selectOrganizationBySlug(slug)

    if (result.success) {
      router.refresh()
    } else {
      setError(result.error ?? "Barbería no encontrada")
      setIsPending(false)
    }
  }

  return (
    <div
      className="relative flex min-h-dvh flex-col items-center justify-center p-8"
      style={{ background: "oklch(0.07 0 0)" }}
    >
      <BackgroundOrbs />
      <DecorativeParticles />

      <div className="relative z-10 flex flex-col items-center gap-10 w-full max-w-sm">

        {/* Branding — logos sin contenedor */}
        <div
          className="flex flex-col items-center gap-4 animate-fade-up"
          style={{ animationDelay: "0ms", opacity: 0 }}
        >
          <div className="flex items-center gap-3">
            <Image
              src="/bos_icon.png"
              alt="BarberOS"
              width={40}
              height={40}
              className="brightness-0 invert"
            />
            <Image
              src="/barberos_logo.png"
              alt="barberOS"
              width={140}
              height={36}
              className="brightness-0 invert object-contain"
            />
          </div>
          <p className="text-sm text-white/50 text-center">
            Gestión inteligente para{" "}
            <span style={{ color: "oklch(0.78 0.12 85)" }}>barberías</span>
          </p>
        </div>

        {/* Card glassmorphism */}
        <div
          className="w-full rounded-2xl border p-6 space-y-5 animate-fade-up relative overflow-hidden"
          style={{
            background: "oklch(0.12 0 0 / 0.85)",
            backdropFilter: "blur(24px)",
            borderColor: "oklch(1 0 0 / 0.08)",
            animationDelay: "100ms",
            opacity: 0,
          }}
        >
          {/* Línea dorada superior */}
          <div
            className="absolute top-0 left-0 right-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, oklch(0.78 0.12 85 / 0.5), transparent)",
            }}
          />

          <div className="space-y-1 text-center">
            <h2 className="text-xl font-semibold tracking-tight">Accedé a tu barbería</h2>
            <p className="text-sm text-white/40">Ingresá el código de tu espacio</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 animate-slide-up-fade">
                <span className="mt-1 size-1.5 rounded-full bg-red-400 shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label
                htmlFor="slug"
                className="text-xs font-medium text-white/50 uppercase tracking-wider"
              >
                Código de barbería
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-white/30" />
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) =>
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                  }
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder="mi-barberia"
                  className={cn(
                    "pl-9 transition-all duration-300",
                    "bg-white/5 border-white/10 placeholder:text-white/20",
                    focused &&
                      "border-[oklch(0.78_0.12_85)] ring-2 ring-[oklch(0.78_0.12_85/0.15)]"
                  )}
                  autoFocus
                />
              </div>
              <p className="text-xs text-white/25">
                Ej: <span className="text-white/40">monaco</span>,{" "}
                <span className="text-white/40">barber-kings</span>
              </p>
            </div>

            <Button
              type="submit"
              className="w-full gap-2 h-11 font-medium"
              disabled={isPending || !slug.trim()}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              {isPending ? "Buscando..." : "Acceder"}
            </Button>
          </form>

          {/* Divisor */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-white/8" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span
                className="px-3 text-white/25"
                style={{ background: "oklch(0.12 0 0)" }}
              >
                o
              </span>
            </div>
          </div>

          {/* Acciones secundarias */}
          <div className="grid grid-cols-2 gap-2">
            <Link
              href="/login"
              className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/50 transition-all hover:border-white/20 hover:text-white/80"
            >
              <LogIn className="size-3.5" />
              Iniciar sesión
            </Link>
            <Link
              href="/register"
              className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm transition-all hover:border-white/20"
              style={{ color: "oklch(0.78 0.12 85)" }}
            >
              <Building2 className="size-3.5" />
              Crear barbería
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p
          className="text-xs animate-fade-up"
          style={{ color: "oklch(0.38 0 0)", animationDelay: "200ms", opacity: 0 }}
        >
          barberOS · Software de gestión para barberías
        </p>
      </div>
    </div>
  )
}
