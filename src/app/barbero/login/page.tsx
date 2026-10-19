"use client"

import { useState, useEffect, useCallback } from "react"
import Image from "next/image"
import { unstable_rethrow } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { loginWithPin } from "@/lib/actions/auth"
import type { Branch, Staff } from "@/lib/types/database"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { VisorHora } from "@/components/barber/reloj/visor-hora"
import { avisarYRecargarPorVersion, esErrorDeVersion, TEXTO_RECARGA_MANUAL } from "@/lib/recarga-version"
import { cn } from "@/lib/utils"
import { Scissors, ArrowLeft, Delete, Loader2, ScanFace, LogIn, LogOut, RotateCw, MapPin } from "lucide-react"

type Step = "branch" | "barber" | "pin"
type LoginBlock = null | "needs_face_registration" | "needs_clock_in"
/** Lo único que dibuja esta pantalla de cada barbero: su nombre (y su id para el PIN). */
type BarberoDeLogin = Pick<Staff, "id" | "full_name">

function getInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
}

export default function BarberLoginPage() {
  const [step, setStep] = useState<Step>("branch")
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null)
  const [barbers, setBarbers] = useState<BarberoDeLogin[]>([])
  const [selectedBarber, setSelectedBarber] = useState<BarberoDeLogin | null>(null)
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loadingBranches, setLoadingBranches] = useState(true)
  const [loadingBarbers, setLoadingBarbers] = useState(false)
  const [barbersError, setBarbersError] = useState(false)
  const [reintentoBarberos, setReintentoBarberos] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [loginBlock, setLoginBlock] = useState<LoginBlock>(null)
  const [orgInfo, setOrgInfo] = useState<{ name: string; logo_url: string | null } | null>(null)

  useEffect(() => {
    const load = async () => {
      const { getPublicBranches, getActiveOrganization } = await import("@/lib/actions/org")
      const [data, org] = await Promise.all([getPublicBranches(), getActiveOrganization()])
      setBranches((data ?? []) as Branch[])
      if (org) setOrgInfo({ name: org.name, logo_url: org.logo_url })
      setLoadingBranches(false)
    }
    load()
  }, [])

  useEffect(() => {
    if (!selectedBranch) return
    let cancelado = false
    setLoadingBarbers(true)
    setBarbersError(false)
    const supabase = createClient()
    supabase
      .from("staff")
      // Sólo lo que la pantalla dibuja. Corre en el browser con la anon key: con
      // `select("*")` viajaba el `pin` de cada barbero a la misma página donde se
      // pide (mig 212), y hasta este cambio viajaban también su teléfono y su
      // comisión, que esta pantalla no usa. La mig 224 le saca esas dos columnas a
      // `anon`: una consulta anónima que las nombre da 42501 y se queda sin la
      // lista ENTERA (Known Risk #34), así que no hay que volver a pedirlas acá.
      .select("id, full_name")
      .eq("branch_id", selectedBranch.id)
      .eq("role", "barber")
      .eq("is_active", true)
      .order("full_name")
      .then(({ data, error: errorLista }) => {
        if (cancelado) return
        // Un error NO es "no hay barberos": antes caía en ese cartel y nadie se
        // enteraba de que la consulta había fallado (así se vio el 10/9).
        if (errorLista) {
          console.error("[barbero/login] lista de barberos:", errorLista.message)
          setBarbers([])
          setBarbersError(true)
        } else {
          setBarbers((data ?? []) as BarberoDeLogin[])
        }
        setLoadingBarbers(false)
      })
    return () => {
      cancelado = true
    }
  }, [selectedBranch, reintentoBarberos])

  const handleBranchSelect = (branchId: string) => {
    const branch = branches.find((b) => b.id === branchId)
    if (branch) {
      setSelectedBranch(branch)
      setBarbers([])
      setStep("barber")
      // Setear cookie de org para que futuros loads filtren correctamente
      import("@/lib/actions/org").then(({ setActiveOrgFromBranch }) => {
        setActiveOrgFromBranch(branchId)
      })
    }
  }

  const handleBarberSelect = (barber: BarberoDeLogin) => {
    setSelectedBarber(barber)
    setPin("")
    setError("")
    setStep("pin")
  }

  const handleSubmit = useCallback(
    async (currentPin: string) => {
      if (currentPin.length !== 4 || !selectedBarber) return
      setSubmitting(true)
      setError("")
      setLoginBlock(null)

      const formData = new FormData()
      formData.append("staff_id", selectedBarber.id)
      formData.append("pin", currentPin)

      let result: {
        error?: string
        needsFaceRegistration?: boolean
        needsClockIn?: boolean
      } | undefined
      try {
        result = await loginWithPin(formData)
      } catch (e) {
        // La redirección a la fila (PIN correcto) la maneja Next: no es un error.
        unstable_rethrow(e)
        console.error("[barbero/login] loginWithPin:", e)
        // Antes, una falla de red dejaba el teclado deshabilitado para siempre.
        if (esErrorDeVersion(e)) {
          if (!avisarYRecargarPorVersion()) setError(TEXTO_RECARGA_MANUAL)
        } else {
          setError("No pudimos verificar el PIN. Revisá la conexión y probá de nuevo.")
        }
        setPin("")
        setSubmitting(false)
        return
      }

      if (result?.needsFaceRegistration) {
        setLoginBlock("needs_face_registration")
        setPin("")
        setSubmitting(false)
      } else if (result?.needsClockIn) {
        setLoginBlock("needs_clock_in")
        setPin("")
        setSubmitting(false)
      } else if (result?.error) {
        setError(result.error)
        setPin("")
        setSubmitting(false)
      }
    },
    [selectedBarber]
  )

  const handlePinDigit = (digit: string) => {
    if (pin.length >= 4 || submitting) return
    const next = pin + digit
    setPin(next)
    if (next.length === 4) {
      handleSubmit(next)
    }
  }

  const handlePinDelete = () => {
    if (submitting) return
    setPin((prev) => prev.slice(0, -1))
    setError("")
  }

  const goBack = () => {
    if (step === "pin") {
      setSelectedBarber(null)
      setPin("")
      setError("")
      setLoginBlock(null)
      setStep("barber")
    } else if (step === "barber") {
      setSelectedBranch(null)
      setBarbers([])
      setStep("branch")
    }
  }

  return (
    // Pantalla de bloqueo del reloj: la hora grande arriba (acá no está la
    // banda del panel) y abajo quién entra. Mide el alto que deja la reserva de
    // la barra del layout, así la pantalla no scrollea.
    <div className="flex min-h-[calc(100dvh-var(--alto-nav)-env(safe-area-inset-bottom))] flex-col items-center px-4 pb-6 pt-[clamp(3rem,8vh,6.5rem)]">
      <VisorHora tamano="grande" />

      <div className="mt-7 flex items-center gap-3">
        {orgInfo?.logo_url ? (
          <Image
            src={orgInfo.logo_url}
            alt=""
            width={48}
            height={48}
            className="size-12 rounded-full object-cover"
            priority
            unoptimized
          />
        ) : (
          <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Scissors className="size-5" aria-hidden />
          </span>
        )}
        <h1 className="text-lg font-semibold tracking-[-0.01em]">{orgInfo?.name || "BarberOS"}</h1>
      </div>

      <div className="mt-8 flex w-full flex-1 flex-col items-center sm:mt-10">
        {step !== "branch" && (
          <button
            onClick={goBack}
            className="mb-5 flex h-11 items-center gap-1.5 rounded-full px-4 text-[0.9375rem] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Volver
          </button>
        )}

        {step === "branch" && (
          <div className="w-full max-w-md">
            <h2 className="text-center text-2xl font-bold tracking-[-0.02em]">¿Dónde trabajás hoy?</h2>
            <div className="mt-6">
              {loadingBranches ? (
                <div className="grid gap-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-2xl bg-card" />
                  ))}
                </div>
              ) : branches.length === 0 ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-center text-[0.9375rem] text-muted-foreground">
                    No hay sucursales disponibles
                  </p>
                  <form action="/api/clear-org" method="POST">
                    <Button variant="outline" type="submit" className="h-11 gap-1.5 rounded-xl bg-card">
                      <LogOut className="size-4" />
                      Cambiar barbería
                    </Button>
                  </form>
                </div>
              ) : (
                // Una sucursal = un toque (antes, un desplegable: dos toques y
                // una lista chica para el dedo).
                <div className="grid gap-3">
                  {branches.map((branch) => (
                    <button
                      key={branch.id}
                      onClick={() => handleBranchSelect(branch.id)}
                      className="flex h-16 items-center gap-3 rounded-2xl border border-border/80 bg-card px-5 text-left text-lg font-semibold shadow-[0_8px_22px_-18px_oklch(0.2_0.012_260/0.5)] transition-colors hover:bg-muted/60 active:scale-[0.99] motion-safe:transition-transform"
                    >
                      <MapPin className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                      {branch.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {step === "barber" && (
          <div className="w-full max-w-2xl">
            <div className="mb-6 text-center">
              <h2 className="text-2xl font-bold tracking-[-0.02em]">¿Quién sos?</h2>
              <p className="mt-1 text-[0.9375rem] text-muted-foreground">{selectedBranch?.name}</p>
            </div>

            {loadingBarbers ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-36 w-full rounded-2xl bg-card" />
                ))}
              </div>
            ) : barbersError ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <p className="text-[0.9375rem] text-destructive">
                  No pudimos cargar los barberos de esta sucursal.
                </p>
                <Button
                  variant="outline"
                  className="h-11 gap-1.5 rounded-xl bg-card"
                  onClick={() => setReintentoBarberos((n) => n + 1)}
                >
                  <RotateCw className="size-4" />
                  Reintentar
                </Button>
              </div>
            ) : barbers.length === 0 ? (
              <p className="text-center text-[0.9375rem] text-muted-foreground">
                No hay barberos en esta sucursal
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {barbers.map((barber) => (
                  <button
                    key={barber.id}
                    onClick={() => handleBarberSelect(barber)}
                    className="flex flex-col items-center gap-3 rounded-2xl border border-border/80 bg-card px-4 py-6 shadow-[0_8px_22px_-18px_oklch(0.2_0.012_260/0.5)] transition-colors hover:bg-muted/60 active:scale-[0.98] motion-safe:transition-transform"
                  >
                    <span className="flex size-16 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">
                      {getInitials(barber.full_name)}
                    </span>
                    <span className="text-center text-base font-semibold leading-tight">
                      {barber.full_name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "pin" && selectedBarber && (
          <div className="flex w-full max-w-sm flex-col items-center">
            {loginBlock ? (
              <div className="flex flex-col items-center gap-5 text-center animate-in fade-in zoom-in-95 duration-300">
                <div
                  className={cn(
                    "flex size-20 items-center justify-center rounded-full border-2",
                    loginBlock === "needs_face_registration"
                      ? "border-blue-500/30 bg-blue-500/10 text-blue-700"
                      : "border-amber-500/40 bg-amber-400/15 text-amber-800",
                  )}
                >
                  {loginBlock === "needs_face_registration" ? (
                    <ScanFace className="size-10" strokeWidth={1.5} />
                  ) : (
                    <LogIn className="size-10" strokeWidth={1.5} />
                  )}
                </div>

                <div>
                  <h2 className="text-2xl font-bold tracking-[-0.02em]">
                    {loginBlock === "needs_face_registration"
                      ? "Registrá tu rostro"
                      : "No hiciste el check-in"}
                  </h2>
                  <p className="mt-2 max-w-[300px] text-[0.9375rem] text-muted-foreground">
                    {loginBlock === "needs_face_registration"
                      ? "Es tu primera vez. Dirigite a la tablet de check-in y registrá tu rostro en la sección \"Soy barbero\"."
                      : "Antes de ingresar al panel, registrá tu entrada en la tablet de check-in con la opción \"Soy barbero\"."}
                  </p>
                </div>

                <Button
                  onClick={() => {
                    setLoginBlock(null)
                    setPin("")
                    setError("")
                  }}
                  variant="outline"
                  className="mt-2 h-12 rounded-xl bg-card px-5"
                >
                  <ArrowLeft className="size-4" />
                  Volver a intentar
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-6 flex flex-col items-center gap-1">
                  <span className="mb-2 flex size-16 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">
                    {getInitials(selectedBarber.full_name)}
                  </span>
                  <h2 className="text-xl font-bold tracking-[-0.01em]">{selectedBarber.full_name}</h2>
                  <p className="text-[0.9375rem] text-muted-foreground">Ingresá tu PIN</p>
                </div>

                <div className="mb-6 flex h-5 items-center gap-4" aria-label={`${pin.length} de 4 dígitos`}>
                  {submitting ? (
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  ) : (
                    Array.from({ length: 4 }).map((_, i) => (
                      <span
                        key={i}
                        className={cn(
                          "size-4 rounded-full border-2 transition-colors",
                          i < pin.length ? "border-foreground bg-foreground" : "border-foreground/25",
                        )}
                      />
                    ))
                  )}
                </div>

                {error && (
                  <div role="alert" className="mb-5 rounded-xl bg-destructive/10 px-4 py-2.5 text-center text-[0.9375rem] font-medium text-destructive">
                    {error}
                  </div>
                )}

                <div className="grid w-full grid-cols-3 gap-3">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                    <Button
                      key={digit}
                      variant="outline"
                      onClick={() => handlePinDigit(digit)}
                      disabled={submitting}
                      className="h-[4.5rem] rounded-2xl bg-card text-[1.75rem] font-medium shadow-[0_6px_16px_-14px_oklch(0.2_0.012_260/0.6)] active:scale-[0.97]"
                    >
                      {digit}
                    </Button>
                  ))}
                  <div />
                  <Button
                    variant="outline"
                    onClick={() => handlePinDigit("0")}
                    disabled={submitting}
                    className="h-[4.5rem] rounded-2xl bg-card text-[1.75rem] font-medium shadow-[0_6px_16px_-14px_oklch(0.2_0.012_260/0.6)] active:scale-[0.97]"
                  >
                    0
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handlePinDelete}
                    disabled={submitting || pin.length === 0}
                    aria-label="Borrar"
                    className="h-[4.5rem] rounded-2xl"
                  >
                    <Delete className="size-7" />
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
