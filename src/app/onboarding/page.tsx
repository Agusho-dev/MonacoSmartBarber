"use client"

import { useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import {
  createOnboardingBranch,
  createOnboardingService,
  createOnboardingStaff,
  completeOnboarding,
  completeOnboardingStep,
  deleteOnboardingStaff,
  setOwnerIsBarber,
  uploadOrgLogo,
  updateOrgI18n,
} from "@/lib/actions/onboarding"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  ChevronRight,
  ChevronLeft,
  Check,
  Plus,
  Loader2,
  MapPin,
  Clock,
  Users,
  Scissors,
  Upload,
  X,
  ImageIcon,
  Rocket,
  Palette,
  Store,
  CheckCircle2,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface CreatedBranch { id: string; name: string }
interface CreatedService { id: string; name: string; price: number }
interface CreatedStaff   { id: string; full_name: string }

// ─── Catalogo de servicios comunes ───────────────────────────────────────────

const SERVICIOS_CATALOGO = [
  { name: "Corte de pelo",    duration: 30 },
  { name: "Barba",            duration: 20 },
  { name: "Corte + Barba",    duration: 45 },
  { name: "Diseno de barba",  duration: 15 },
  { name: "Cejas",            duration: 10 },
  { name: "Corte infantil",   duration: 25 },
  { name: "Brushing",         duration: 20 },
  { name: "Afeitado clasico", duration: 25 },
  { name: "Keratina",         duration: 120 },
  { name: "Coloracion",       duration: 60 },
]

const DIAS = [
  { v: 0, l: "D" },
  { v: 1, l: "L" },
  { v: 2, l: "M" },
  { v: 3, l: "X" },
  { v: 4, l: "J" },
  { v: 5, l: "V" },
  { v: 6, l: "S" },
]

// ─── Metadatos por paso ──────────────────────────────────────────────────────

const STEPS = [
  { label: "Inicio",    Icon: Rocket,       tagline: "Tu barberia,\ntu operacion." },
  { label: "Branding",  Icon: Palette,       tagline: "Tu identidad\nes tu marca." },
  { label: "Sucursal",  Icon: Store,         tagline: "Donde sucede\nla magia." },
  { label: "Servicios", Icon: Scissors,      tagline: "Lo que ofreces\nal mundo." },
  { label: "Equipo",    Icon: Users,         tagline: "Las personas\ndetras del arte." },
  { label: "Listo",     Icon: CheckCircle2,  tagline: "Todo\nconfigurado." },
]

// ─── Confetti ────────────────────────────────────────────────────────────────

function Confetti() {
  const pieces = Array.from({ length: 28 }, (_, i) => i)
  const colors = [
    "oklch(0.78 0.12 85)",
    "oklch(0.65 0.10 85)",
    "#ffffff",
    "#cccccc",
    "oklch(0.85 0.08 85)",
    "#888888",
  ]
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((i) => (
        <div
          key={i}
          className="absolute top-0 rounded-sm"
          style={{
            left: `${(i / 28) * 100}%`,
            width: `${4 + (i % 3) * 3}px`,
            height: `${8 + (i % 4) * 4}px`,
            background: colors[i % colors.length],
            animation: `confettiFall ${1.5 + (i % 3) * 0.5}s ease-in ${(i % 8) * 0.15}s forwards`,
          }}
        />
      ))}
    </div>
  )
}

// ─── Logo Uploader ───────────────────────────────────────────────────────────

function LogoUploader({
  preview,
  onFile,
}: {
  preview: string | null
  onFile: (f: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer.files[0]
      if (f && f.type.startsWith("image/")) onFile(f)
    },
    [onFile]
  )

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed",
        "h-36 w-full cursor-pointer transition-all duration-300",
        dragOver
          ? "border-[oklch(0.78_0.12_85)] bg-[oklch(0.78_0.12_85/0.06)] scale-[1.01]"
          : preview
          ? "border-white/20 bg-white/5"
          : "border-white/10 hover:border-[oklch(0.78_0.12_85/0.4)] hover:bg-white/[0.03]"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
        }}
      />

      {preview ? (
        <img
          src={preview}
          alt="Logo preview"
          className="max-h-24 max-w-[180px] object-contain"
        />
      ) : (
        <>
          <div
            className="flex size-11 items-center justify-center rounded-xl border"
            style={{
              background: "oklch(0.78 0.12 85 / 0.08)",
              borderColor: "oklch(0.78 0.12 85 / 0.2)",
            }}
          >
            <Upload className="size-5" style={{ color: "oklch(0.78 0.12 85)" }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Subir logo</p>
            <p className="text-xs text-white/30 mt-0.5">PNG, SVG, JPG</p>
          </div>
        </>
      )}

      {preview && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl opacity-0 hover:opacity-100 transition-opacity bg-black/50">
          <div className="flex flex-col items-center gap-1">
            <ImageIcon className="size-5 text-white/80" />
            <p className="text-xs text-white/80">Cambiar logo</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Panel izquierdo ─────────────────────────────────────────────────────────

function LeftPanel({ step }: { step: number }) {
  return (
    <div
      className="hidden lg:flex lg:w-[420px] xl:w-[460px] shrink-0 flex-col justify-between p-10 xl:p-12 relative overflow-hidden"
      style={{ background: "oklch(0.06 0 0)" }}
    >
      {/* Fondo decorativo */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-32 -left-32 size-[500px] rounded-full animate-orb-drift"
          style={{
            background: "radial-gradient(circle, oklch(0.78 0.12 85 / 0.12) 0%, transparent 65%)",
          }}
        />
        <div
          className="absolute bottom-0 right-0 size-72 rounded-full animate-orb-drift"
          style={{
            background: "radial-gradient(circle, oklch(0.5 0.15 270 / 0.06) 0%, transparent 70%)",
            animationDelay: "-7s",
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(oklch(1 0 0) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      {/* Logo */}
      <div className="relative z-10 flex items-center gap-3">
        <Image src="/bos_icon.png" alt="BOS" width={40} height={40} className="brightness-0 invert" />
        <Image src="/barberos_logo.png" alt="barberOS" width={140} height={36} className="brightness-0 invert object-contain" />
      </div>

      {/* Stepper vertical */}
      <nav className="relative z-10 space-y-0">
        {STEPS.map((s, i) => {
          const isDone = i < step
          const isCurrent = i === step
          const StepIcon = s.Icon
          return (
            <div key={i} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-xl border-2 transition-all duration-500",
                    isCurrent
                      ? "border-[oklch(0.78_0.12_85)] bg-[oklch(0.78_0.12_85/0.15)]"
                      : isDone
                      ? "border-[oklch(0.78_0.12_85)] bg-[oklch(0.78_0.12_85)]"
                      : "border-white/10 bg-white/[0.03]"
                  )}
                >
                  {isDone ? (
                    <Check className="size-4 text-black" strokeWidth={3} />
                  ) : (
                    <StepIcon
                      className="size-4"
                      style={{ color: isCurrent ? "oklch(0.78 0.12 85)" : "oklch(1 0 0 / 0.25)" }}
                    />
                  )}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className="w-px transition-all duration-700"
                    style={{
                      height: "20px",
                      background: i < step ? "oklch(0.78 0.12 85 / 0.5)" : "oklch(1 0 0 / 0.08)",
                    }}
                  />
                )}
              </div>
              <p
                className={cn(
                  "text-sm font-medium leading-9 transition-colors duration-300",
                  isCurrent ? "text-white" : isDone ? "text-white/50" : "text-white/20"
                )}
              >
                {s.label}
              </p>
            </div>
          )
        })}
      </nav>

      {/* Tagline del paso */}
      <div className="relative z-10">
        <h2
          key={step}
          className="text-4xl xl:text-5xl font-bold tracking-tight leading-tight animate-reveal-up whitespace-pre-line"
          style={{
            background: "linear-gradient(135deg, #fff 40%, oklch(0.78 0.12 85))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {STEPS[step]?.tagline ?? ""}
        </h2>
      </div>

      {/* Linea separadora */}
      <div
        className="absolute top-0 right-0 bottom-0 w-px"
        style={{
          background: "linear-gradient(to bottom, transparent, oklch(0.78 0.12 85 / 0.15) 30%, oklch(0.78 0.12 85 / 0.15) 70%, transparent)",
        }}
      />
    </div>
  )
}

// ─── Barra de progreso mobile ────────────────────────────────────────────────

function MobileProgress({ step, total }: { step: number; total: number }) {
  return (
    <div className="lg:hidden">
      <div className="h-0.5 w-full" style={{ background: "oklch(1 0 0 / 0.08)" }}>
        <div
          className="h-full transition-all duration-700 ease-out rounded-full"
          style={{
            width: `${Math.round((step / (total - 1)) * 100)}%`,
            background: "linear-gradient(90deg, oklch(0.78 0.12 85), oklch(0.85 0.10 85))",
          }}
        />
      </div>
      <div className="flex items-center gap-3 px-6 pt-4 pb-2">
        <Image src="/bos_icon.png" alt="BOS" width={24} height={24} className="brightness-0 invert" />
        <Image src="/barberos_logo.png" alt="barberOS" width={90} height={24} className="brightness-0 invert object-contain" />
        <span className="ml-auto text-xs text-white/25">{step + 1}/{total}</span>
      </div>
    </div>
  )
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(0)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [animKey, setAnimKey] = useState(0)

  const [createdBranch, setCreatedBranch] = useState<CreatedBranch | null>(null)
  const [createdServices, setCreatedServices] = useState<CreatedService[]>([])
  const [createdStaff, setCreatedStaff] = useState<CreatedStaff[]>([])

  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const [branchName, setBranchName] = useState("")
  const [branchAddress, setBranchAddress] = useState("")
  const [branchPhone, setBranchPhone] = useState("")
  const [hoursOpen, setHoursOpen] = useState("09:00")
  const [hoursClose, setHoursClose] = useState("21:00")
  const [businessDays, setBusinessDays] = useState([1, 2, 3, 4, 5, 6])

  const [selectedServices, setSelectedServices] = useState<Record<string, string>>({})
  const [customName, setCustomName] = useState("")
  const [customDuration, setCustomDuration] = useState("")
  const [customPrice, setCustomPrice] = useState("")

  const [staffName, setStaffName] = useState("")
  const [staffPin, setStaffPin] = useState("")
  const [ownerIsBarber, setOwnerIsBarberState] = useState(false)
  const [removingStaffId, setRemovingStaffId] = useState<string | null>(null)

  // i18n step 0
  const [i18nCountry, setI18nCountry]   = useState("AR")
  const [i18nCurrency, setI18nCurrency] = useState("ARS")
  const [i18nTimezone, setI18nTimezone] = useState("America/Argentina/Buenos_Aires")

  async function handleI18nNext() {
    setIsPending(true)
    setError(null)
    // Derivar locale del país
    const LOCALE_MAP: Record<string, string> = {
      AR: "es-AR", UY: "es-UY", CL: "es-CL", PE: "es-PE", CO: "es-CO",
      MX: "es-MX", BR: "pt-BR", PY: "es-PY", BO: "es-BO", VE: "es-VE",
      EC: "es-EC", ES: "es-ES", US: "en-US",
    }
    const locale = LOCALE_MAP[i18nCountry] ?? "es-AR"
    const result = await updateOrgI18n({
      country_code: i18nCountry,
      timezone:     i18nTimezone,
      currency:     i18nCurrency,
      locale,
    })
    if (!result.success) setError(result.error ?? "Error guardando configuración regional")
    else goTo(1)
    setIsPending(false)
  }

  function goTo(s: number) {
    setError(null)
    setAnimKey((k) => k + 1)
    setCurrentStep(s)
  }

  function toggleDay(d: number) {
    setBusinessDays((p) => p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort())
  }

  function handleLogoFile(f: File) {
    setLogoFile(f)
    setLogoPreview(URL.createObjectURL(f))
  }

  function toggleService(name: string) {
    setSelectedServices((prev) => {
      const next = { ...prev }
      if (name in next) delete next[name]
      else next[name] = ""
      return next
    })
  }

  function setServicePrice(name: string, price: string) {
    setSelectedServices((prev) => ({ ...prev, [name]: price }))
  }

  async function handleBrandingNext() {
    if (!logoFile) { goTo(2); return }
    setIsPending(true)
    const fd = new FormData()
    fd.set("logo", logoFile)
    const result = await uploadOrgLogo(fd)
    if (!result.success) setError(result.error ?? "Error al subir el logo")
    else goTo(2)
    setIsPending(false)
  }

  async function handleCreateBranch() {
    if (!branchName.trim()) { setError("El nombre es obligatorio"); return }
    setIsPending(true); setError(null)
    const fd = new FormData()
    fd.set("name", branchName)
    fd.set("address", branchAddress)
    fd.set("phone", branchPhone)
    fd.set("business_hours_open", hoursOpen)
    fd.set("business_hours_close", hoursClose)
    fd.set("business_days", businessDays.join(","))
    const result = await createOnboardingBranch(fd)
    if (result.success && result.data) {
      setCreatedBranch({ id: result.data.id, name: result.data.name })
      goTo(3)
    } else {
      setError(typeof result.error === "string" ? result.error : "Error al crear la sucursal")
    }
    setIsPending(false)
  }

  async function handleServicesNext() {
    setIsPending(true); setError(null)
    const toCreate = Object.entries(selectedServices).filter(([, p]) => p && Number(p) > 0)
    for (const [name, price] of toCreate) {
      const catalogItem = SERVICIOS_CATALOGO.find((s) => s.name === name)
      const fd = new FormData()
      fd.set("name", name)
      fd.set("price", price)
      if (catalogItem?.duration) fd.set("duration_minutes", String(catalogItem.duration))
      fd.set("branch_id", createdBranch?.id ?? "")
      await createOnboardingService(fd)
    }
    if (customName && customPrice && createdBranch) {
      const fd = new FormData()
      fd.set("name", customName)
      fd.set("price", customPrice)
      if (customDuration) fd.set("duration_minutes", customDuration)
      fd.set("branch_id", createdBranch.id)
      const r = await createOnboardingService(fd)
      if (r.success && r.data) {
        setCreatedServices((p) => [...p, { id: r.data.id, name: r.data.name, price: r.data.price }])
      }
    }
    setCreatedServices((p) => [...p, ...toCreate.map(([name, price]) => ({ id: name, name, price: Number(price) }))])
    await completeOnboardingStep(3)
    goTo(4)
    setIsPending(false)
  }

  async function handleAddStaff() {
    if (!staffName.trim() || !createdBranch) return
    setIsPending(true); setError(null)
    const fd = new FormData()
    fd.set("full_name", staffName)
    fd.set("pin", staffPin || "0000")
    fd.set("branch_id", createdBranch.id)
    fd.set("role", "barber")
    const result = await createOnboardingStaff(fd)
    if (result.success && result.data) {
      setCreatedStaff((p) => [...p, { id: result.data.id, full_name: result.data.full_name }])
      setStaffName(""); setStaffPin("")
    } else {
      setError(typeof result.error === "string" ? result.error : "Error al crear el barbero")
    }
    setIsPending(false)
  }

  async function handleDeleteStaff(staffId: string) {
    setRemovingStaffId(staffId)
    setError(null)
    const result = await deleteOnboardingStaff(staffId)
    if (result.success) {
      setCreatedStaff((p) => p.filter((s) => s.id !== staffId))
    } else {
      setError(result.error ?? "No se pudo eliminar el barbero")
    }
    setRemovingStaffId(null)
  }

  async function handleTeamNext() {
    setIsPending(true)
    setError(null)
    const result = await setOwnerIsBarber(ownerIsBarber)
    if (!result.success) {
      setError(result.error ?? "Error al guardar la configuración del propietario")
      setIsPending(false)
      return
    }
    await completeOnboardingStep(4)
    goTo(5)
    setIsPending(false)
  }

  async function handleComplete() {
    setIsPending(true)
    await completeOnboarding()
    router.push("/dashboard/fila")
  }

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: "oklch(0.07 0 0)" }}>
      <LeftPanel step={currentStep} />

      <div className="flex flex-1 flex-col h-dvh">
        <MobileProgress step={currentStep} total={STEPS.length} />

        {/* Desktop progress bar */}
        <div className="hidden lg:block h-0.5 w-full" style={{ background: "oklch(1 0 0 / 0.08)" }}>
          <div
            className="h-full transition-all duration-700 ease-out rounded-full"
            style={{
              width: `${Math.round((currentStep / (STEPS.length - 1)) * 100)}%`,
              background: "linear-gradient(90deg, oklch(0.78 0.12 85), oklch(0.85 0.10 85))",
            }}
          />
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-6 lg:px-10 overflow-y-auto">
          <div key={animKey} className="w-full max-w-lg animate-step-enter">

            {/* ── STEP 0: BIENVENIDA + i18n ─────────────────────────────── */}
            {currentStep === 0 && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <p
                    className="text-xs font-semibold uppercase tracking-[0.2em] animate-reveal-up"
                    style={{ color: "oklch(0.78 0.12 85)", animationDelay: "0ms", opacity: 0 }}
                  >
                    Configuracion inicial
                  </p>
                  <h1
                    className="text-3xl font-bold tracking-tight animate-reveal-up"
                    style={{ animationDelay: "60ms", opacity: 0 }}
                  >
                    Bienvenido a BarberOS
                  </h1>
                  <p
                    className="text-white/40 text-sm animate-reveal-up"
                    style={{ animationDelay: "120ms", opacity: 0 }}
                  >
                    Primero elegí el país y la moneda con la que opera tu barbería. Esto configura horarios, formatos y símbolos.
                  </p>
                </div>

                <div className="space-y-3 animate-reveal-up" style={{ animationDelay: "180ms", opacity: 0 }}>
                  <div>
                    <Label className="text-xs font-medium text-white/50 uppercase tracking-wider">País</Label>
                    <select
                      value={i18nCountry}
                      onChange={(e) => setI18nCountry(e.target.value)}
                      className="mt-2 w-full h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm focus:border-[oklch(0.78_0.12_85/0.5)] focus:outline-none"
                    >
                      <option value="AR">🇦🇷 Argentina</option>
                      <option value="UY">🇺🇾 Uruguay</option>
                      <option value="CL">🇨🇱 Chile</option>
                      <option value="PE">🇵🇪 Perú</option>
                      <option value="CO">🇨🇴 Colombia</option>
                      <option value="MX">🇲🇽 México</option>
                      <option value="BR">🇧🇷 Brasil</option>
                      <option value="PY">🇵🇾 Paraguay</option>
                      <option value="BO">🇧🇴 Bolivia</option>
                      <option value="VE">🇻🇪 Venezuela</option>
                      <option value="EC">🇪🇨 Ecuador</option>
                      <option value="ES">🇪🇸 España</option>
                      <option value="US">🇺🇸 Estados Unidos</option>
                    </select>
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-white/50 uppercase tracking-wider">Moneda</Label>
                    <select
                      value={i18nCurrency}
                      onChange={(e) => setI18nCurrency(e.target.value)}
                      className="mt-2 w-full h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm focus:border-[oklch(0.78_0.12_85/0.5)] focus:outline-none"
                    >
                      <option value="ARS">ARS — Peso Argentino ($)</option>
                      <option value="USD">USD — Dólar (US$)</option>
                      <option value="BRL">BRL — Real (R$)</option>
                      <option value="CLP">CLP — Peso Chileno ($)</option>
                      <option value="UYU">UYU — Peso Uruguayo ($U)</option>
                      <option value="PEN">PEN — Sol (S/)</option>
                      <option value="COP">COP — Peso Colombiano ($)</option>
                      <option value="MXN">MXN — Peso Mexicano ($)</option>
                      <option value="PYG">PYG — Guaraní (₲)</option>
                      <option value="BOB">BOB — Boliviano (Bs)</option>
                      <option value="EUR">EUR — Euro (€)</option>
                    </select>
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-white/50 uppercase tracking-wider">Zona horaria</Label>
                    <select
                      value={i18nTimezone}
                      onChange={(e) => setI18nTimezone(e.target.value)}
                      className="mt-2 w-full h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm focus:border-[oklch(0.78_0.12_85/0.5)] focus:outline-none"
                    >
                      <option value="America/Argentina/Buenos_Aires">Buenos Aires (-03:00)</option>
                      <option value="America/Montevideo">Montevideo (-03:00)</option>
                      <option value="America/Santiago">Santiago (-03:00/-04:00)</option>
                      <option value="America/Lima">Lima (-05:00)</option>
                      <option value="America/Bogota">Bogotá (-05:00)</option>
                      <option value="America/Mexico_City">Ciudad de México (-06:00)</option>
                      <option value="America/Sao_Paulo">São Paulo (-03:00)</option>
                      <option value="America/Asuncion">Asunción (-03:00/-04:00)</option>
                      <option value="America/La_Paz">La Paz (-04:00)</option>
                      <option value="America/Caracas">Caracas (-04:00)</option>
                      <option value="America/Guayaquil">Guayaquil (-05:00)</option>
                      <option value="Europe/Madrid">Madrid (+01:00)</option>
                      <option value="America/New_York">Nueva York (-05:00)</option>
                    </select>
                  </div>
                </div>

                {error && <ErrorAlert message={error} />}

                <div className="animate-reveal-up" style={{ animationDelay: "500ms", opacity: 0 }}>
                  <button
                    onClick={handleI18nNext}
                    disabled={isPending}
                    className="btn-gold w-full h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-60"
                  >
                    {isPending ? (<><Loader2 className="size-4 animate-spin"/> Guardando…</>) : (<>Empezar <ChevronRight className="size-4" /></>)}
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 1: BRANDING ──────────────────────────────────────── */}
            {currentStep === 1 && (
              <div className="space-y-5">
                <StepHeader title="Identidad de tu barberia" subtitle="Subi tu logo para personalizar el check-in y el dashboard" />
                {error && <ErrorAlert message={error} />}
                <div className="space-y-3">
                  <Label className="text-xs font-medium text-white/50 uppercase tracking-wider">Logo</Label>
                  <LogoUploader preview={logoPreview} onFile={handleLogoFile} />
                  {logoPreview && (
                    <button
                      type="button"
                      onClick={() => { setLogoFile(null); setLogoPreview(null) }}
                      className="flex items-center gap-1 text-xs text-white/30 hover:text-red-400 transition-colors"
                    >
                      <X className="size-3" /> Quitar logo
                    </button>
                  )}
                </div>
                <NavButtons
                  onBack={() => goTo(0)}
                  onNext={handleBrandingNext}
                  isPending={isPending}
                  nextLabel={logoFile ? "Subir y continuar" : "Continuar sin logo"}
                  onSkip={() => goTo(2)}
                />
              </div>
            )}

            {/* ── STEP 2: SUCURSAL ──────────────────────────────────────── */}
            {currentStep === 2 && (
              <div className="space-y-5">
                <StepHeader title="Primera sucursal" subtitle="Podes agregar mas desde el dashboard" />
                {error && <ErrorAlert message={error} />}
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Nombre *">
                      <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="Sucursal Centro" className="bg-white/5 border-white/10 placeholder:text-white/20 h-10 rounded-xl text-sm" />
                    </Field>
                    <Field label="Telefono">
                      <Input value={branchPhone} onChange={(e) => setBranchPhone(e.target.value)} placeholder="+54 11 1234-5678" className="bg-white/5 border-white/10 placeholder:text-white/20 h-10 rounded-xl text-sm" />
                    </Field>
                  </div>
                  <Field label="Direccion">
                    <Input value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} placeholder="Av. Corrientes 1234" className="bg-white/5 border-white/10 placeholder:text-white/20 h-10 rounded-xl text-sm" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={<><Clock className="inline size-3 mr-1" />Apertura</>}>
                      <Input type="time" value={hoursOpen} onChange={(e) => setHoursOpen(e.target.value)} className="bg-white/5 border-white/10 h-10 rounded-xl text-sm" />
                    </Field>
                    <Field label={<><Clock className="inline size-3 mr-1" />Cierre</>}>
                      <Input type="time" value={hoursClose} onChange={(e) => setHoursClose(e.target.value)} className="bg-white/5 border-white/10 h-10 rounded-xl text-sm" />
                    </Field>
                  </div>
                  <Field label="Dias de atencion">
                    <div className="flex gap-1.5 pt-1">
                      {DIAS.map((d) => (
                        <button
                          key={d.v}
                          type="button"
                          onClick={() => toggleDay(d.v)}
                          className={cn(
                            "flex-1 py-2 rounded-lg text-xs font-semibold border transition-all duration-200",
                            businessDays.includes(d.v)
                              ? "border-[oklch(0.78_0.12_85)] text-black"
                              : "border-white/10 text-white/40 hover:border-white/20"
                          )}
                          style={businessDays.includes(d.v) ? { background: "oklch(0.78 0.12 85)" } : { background: "oklch(1 0 0 / 0.03)" }}
                        >
                          {d.l}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>
                <NavButtons onBack={() => goTo(1)} onNext={handleCreateBranch} isPending={isPending} onSkip={() => { completeOnboardingStep(2); goTo(3) }} />
              </div>
            )}

            {/* ── STEP 3: SERVICIOS ─────────────────────────────────────── */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <StepHeader title="Que servicios ofreces?" subtitle="Selecciona y defini el precio" />
                {error && <ErrorAlert message={error} />}

                <div className="grid grid-cols-2 gap-2 max-h-[38vh] overflow-y-auto pr-1">
                  {SERVICIOS_CATALOGO.map((s) => {
                    const selected = s.name in selectedServices
                    return (
                      <div
                        key={s.name}
                        className={cn(
                          "rounded-xl border transition-all duration-200 p-3",
                          selected
                            ? "border-[oklch(0.78_0.12_85/0.4)] bg-[oklch(0.78_0.12_85/0.05)]"
                            : "border-white/8 hover:border-white/15"
                        )}
                      >
                        <button type="button" onClick={() => toggleService(s.name)} className="flex items-center gap-2 w-full text-left">
                          <div
                            className="flex size-5 shrink-0 items-center justify-center rounded border transition-all duration-200"
                            style={selected ? { background: "oklch(0.78 0.12 85)", borderColor: "oklch(0.78 0.12 85)" } : { borderColor: "oklch(1 0 0 / 0.15)" }}
                          >
                            {selected && <Check className="size-3 text-black" strokeWidth={3} />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{s.name}</p>
                            <p className="text-[10px] text-white/30">{s.duration} min</p>
                          </div>
                        </button>
                        {selected && (
                          <div className="mt-2 flex items-center gap-1.5">
                            <span className="text-xs text-white/40">$</span>
                            <Input
                              type="number"
                              placeholder="Precio"
                              value={selectedServices[s.name]}
                              onChange={(e) => setServicePrice(s.name, e.target.value)}
                              className="h-7 text-xs w-full bg-white/5 border-white/10 rounded-lg"
                              autoFocus
                              min={0}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="rounded-xl border border-dashed p-3 space-y-2" style={{ borderColor: "oklch(1 0 0 / 0.1)" }}>
                  <p className="text-[10px] font-semibold text-white/25 uppercase tracking-[0.15em]">Personalizado</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Input placeholder="Nombre" value={customName} onChange={(e) => setCustomName(e.target.value)} className="col-span-3 sm:col-span-1 h-8 text-xs bg-white/5 border-white/10 placeholder:text-white/20 rounded-lg" />
                    <Input type="number" placeholder="$ Precio" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} className="h-8 text-xs bg-white/5 border-white/10 placeholder:text-white/20 rounded-lg" />
                    <Input type="number" placeholder="Min" value={customDuration} onChange={(e) => setCustomDuration(e.target.value)} className="h-8 text-xs bg-white/5 border-white/10 placeholder:text-white/20 rounded-lg" />
                  </div>
                </div>

                <NavButtons onBack={() => goTo(2)} onNext={handleServicesNext} isPending={isPending} onSkip={() => { completeOnboardingStep(3); goTo(4) }} />
              </div>
            )}

            {/* ── STEP 4: EQUIPO ────────────────────────────────────────── */}
            {currentStep === 4 && (
              <div className="space-y-5">
                <StepHeader title="Agrega a tu equipo" subtitle="Los barberos usan PIN para iniciar sesion" />
                {error && <ErrorAlert message={error} />}

                <OwnerRoleToggle value={ownerIsBarber} onChange={setOwnerIsBarberState} />

                <div className="glass-card rounded-xl p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Nombre *">
                      <Input value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="Carlos Lopez" onKeyDown={(e) => e.key === "Enter" && handleAddStaff()} className="bg-white/5 border-white/10 placeholder:text-white/20 h-10 rounded-xl text-sm" />
                    </Field>
                    <Field label="PIN (4-6 digitos)">
                      <Input value={staffPin} onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="1234" inputMode="numeric" maxLength={6} className="bg-white/5 border-white/10 placeholder:text-white/20 h-10 rounded-xl text-sm" />
                    </Field>
                  </div>
                  <Button type="button" variant="outline" onClick={handleAddStaff} disabled={!staffName.trim() || isPending || !createdBranch} className="w-full gap-2 border-white/15 hover:border-white/25 rounded-xl h-10">
                    {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    Agregar barbero
                  </Button>
                </div>

                {createdStaff.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold text-white/25 uppercase tracking-[0.15em]">Equipo ({createdStaff.length})</p>
                    <div className="space-y-2 max-h-[20vh] overflow-y-auto pr-1">
                      {createdStaff.map((s) => {
                        const isRemoving = removingStaffId === s.id
                        return (
                          <div key={s.id} className="flex items-center gap-3 rounded-xl border px-4 py-2.5 animate-reveal-up" style={{ opacity: 0, borderColor: "oklch(1 0 0 / 0.08)", background: "oklch(1 0 0 / 0.02)" }}>
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2 ring-[oklch(0.78_0.12_85/0.3)]" style={{ background: "oklch(0.78 0.12 85)", color: "oklch(0.07 0 0)" }}>
                              {s.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                            <p className="text-sm font-medium flex-1 truncate">{s.full_name}</p>
                            <span className="text-xs text-white/30">Barbero</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteStaff(s.id)}
                              disabled={isRemoving || isPending}
                              aria-label={`Eliminar ${s.full_name}`}
                              className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-white/40 hover:text-red-400 hover:border-red-400/40 hover:bg-red-500/5 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                            >
                              {isRemoving ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <NavButtons onBack={() => goTo(3)} onNext={handleTeamNext} isPending={isPending} nextLabel="Finalizar" onSkip={handleTeamNext} />
              </div>
            )}

            {/* ── STEP 5: COMPLETADO ────────────────────────────────────── */}
            {currentStep === 5 && (
              <div className="relative text-center space-y-6">
                <Confetti />
                <div className="flex justify-center animate-scale-in">
                  <div className="relative">
                    <div className="flex size-24 items-center justify-center rounded-2xl border" style={{ background: "oklch(0.78 0.12 85 / 0.1)", borderColor: "oklch(0.78 0.12 85 / 0.3)" }}>
                      <Image src="/bos_icon.png" alt="BarberOS" width={56} height={56} className="brightness-0 invert animate-float" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-green-500 ring-2 ring-green-500/30">
                      <Check className="size-4 text-white" strokeWidth={3} />
                    </div>
                  </div>
                </div>
                <div className="space-y-2 animate-reveal-up" style={{ animationDelay: "100ms", opacity: 0 }}>
                  <h1 className="text-3xl font-bold tracking-tight">Todo listo!</h1>
                  <p className="text-white/40">Tu barberia esta configurada y lista para operar</p>
                </div>
                <div className="grid gap-2 text-left animate-reveal-up" style={{ animationDelay: "200ms", opacity: 0 }}>
                  {createdBranch && <SummaryRow icon={<MapPin className="size-4" />} label="Sucursal" value={createdBranch.name} />}
                  {createdServices.length > 0 && <SummaryRow icon={<Scissors className="size-4" />} label="Servicios" value={`${createdServices.length} servicio${createdServices.length !== 1 ? "s" : ""}`} />}
                  {createdStaff.length > 0 && <SummaryRow icon={<Users className="size-4" />} label="Equipo" value={`${createdStaff.length} miembro${createdStaff.length !== 1 ? "s" : ""}`} />}
                </div>
                <div className="animate-reveal-up" style={{ animationDelay: "300ms", opacity: 0 }}>
                  <button onClick={handleComplete} disabled={isPending} className="btn-gold w-full h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-50">
                    {isPending ? <Loader2 className="size-4 animate-spin" /> : <ChevronRight className="size-4" />}
                    Ir al panel de control
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers de UI ───────────────────────────────────────────────────────────

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      <p className="text-sm text-white/40">{subtitle}</p>
    </div>
  )
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 animate-slide-up-fade">
      <span className="mt-1 size-1.5 rounded-full bg-red-400 shrink-0" />
      <p className="text-sm text-red-400">{message}</p>
    </div>
  )
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-white/40">{label}</Label>
      {children}
    </div>
  )
}

function NavButtons({
  onBack, onNext, isPending, nextLabel = "Siguiente", onSkip,
}: {
  onBack: () => void; onNext: () => void; isPending: boolean; nextLabel?: string; onSkip?: () => void
}) {
  return (
    <div className="space-y-2 pt-1">
      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="gap-1 px-3 border-white/10 hover:border-white/20 rounded-xl h-11">
          <ChevronLeft className="size-4" />
        </Button>
        <button onClick={onNext} disabled={isPending} className="btn-gold flex-1 h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-50 disabled:pointer-events-none">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <ChevronRight className="size-4" />}
          {isPending ? "Guardando..." : nextLabel}
        </button>
      </div>
      {onSkip && (
        <button type="button" onClick={onSkip} className="w-full text-center text-xs text-white/20 hover:text-white/40 transition-colors py-1">
          Omitir este paso
        </button>
      )}
    </div>
  )
}

function OwnerRoleToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className="rounded-xl border p-3 space-y-2"
      style={{ borderColor: "oklch(1 0 0 / 0.08)", background: "oklch(1 0 0 / 0.02)" }}
    >
      <p className="text-[10px] font-semibold text-white/30 uppercase tracking-[0.15em]">
        Sobre vos como propietario
      </p>
      <p className="text-xs text-white/50">¿También atendés clientes como barbero?</p>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => onChange(false)}
          aria-pressed={!value}
          className={cn(
            "flex-1 h-10 rounded-xl text-xs font-semibold border transition-all duration-200",
            !value
              ? "border-[oklch(0.78_0.12_85)] text-black"
              : "border-white/10 text-white/40 hover:border-white/20"
          )}
          style={!value ? { background: "oklch(0.78 0.12 85)" } : { background: "oklch(1 0 0 / 0.03)" }}
        >
          No, sólo administro
        </button>
        <button
          type="button"
          onClick={() => onChange(true)}
          aria-pressed={value}
          className={cn(
            "flex-1 h-10 rounded-xl text-xs font-semibold border transition-all duration-200",
            value
              ? "border-[oklch(0.78_0.12_85)] text-black"
              : "border-white/10 text-white/40 hover:border-white/20"
          )}
          style={value ? { background: "oklch(0.78 0.12 85)" } : { background: "oklch(1 0 0 / 0.03)" }}
        >
          Sí, también atiendo
        </button>
      </div>
    </div>
  )
}

function SummaryRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border px-4 py-3" style={{ background: "oklch(1 0 0 / 0.02)", borderColor: "oklch(1 0 0 / 0.08)" }}>
      <div className="flex size-8 items-center justify-center rounded-lg" style={{ background: "oklch(0.78 0.12 85 / 0.1)", color: "oklch(0.78 0.12 85)" }}>{icon}</div>
      <div>
        <p className="text-xs text-white/30">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  )
}
