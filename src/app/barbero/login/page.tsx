"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { loginWithPin } from "@/lib/actions/auth"
import type { Branch, Staff } from "@/lib/types/database"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Scissors, ArrowLeft, Delete, Loader2, ScanFace, LogIn } from "lucide-react"

type Step = "branch" | "barber" | "pin"
type LoginBlock = null | "needs_face_registration" | "needs_clock_in"

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
  const [barbers, setBarbers] = useState<Staff[]>([])
  const [selectedBarber, setSelectedBarber] = useState<Staff | null>(null)
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loadingBranches, setLoadingBranches] = useState(true)
  const [loadingBarbers, setLoadingBarbers] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loginBlock, setLoginBlock] = useState<LoginBlock>(null)

  useEffect(() => {
    const load = async () => {
      const { getPublicBranches } = await import("@/lib/actions/org")
      const data = await getPublicBranches()
      setBranches((data ?? []) as Branch[])
      setLoadingBranches(false)
    }
    load()
  }, [])

  useEffect(() => {
    if (!selectedBranch) return
    setLoadingBarbers(true)
    const supabase = createClient()
    supabase
      .from("staff")
      .select("*")
      .eq("branch_id", selectedBranch.id)
      .eq("role", "barber")
      .eq("is_active", true)
      .order("full_name")
      .then(({ data }) => {
        setBarbers(data ?? [])
        setLoadingBarbers(false)
      })
  }, [selectedBranch])

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

  const handleBarberSelect = (barber: Staff) => {
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

      const result = await loginWithPin(formData) as {
        error?: string
        needsFaceRegistration?: boolean
        needsClockIn?: boolean
      } | undefined

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
    <div className="flex min-h-dvh flex-col items-center justify-center p-4">
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-full border border-muted-foreground/25">
          <Scissors className="size-5 text-foreground" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">
          Monaco Smart Barber
        </h1>
      </div>

      {step !== "branch" && (
        <button
          onClick={goBack}
          className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Volver
        </button>
      )}

      {step === "branch" && (
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle>Seleccionar sucursal</CardTitle>
            <CardDescription>
              Elegí la sucursal donde trabajás hoy
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingBranches ? (
              <Skeleton className="h-9 w-full" />
            ) : branches.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                No hay sucursales disponibles
              </p>
            ) : (
              <Select onValueChange={handleBranchSelect}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar sucursal..." />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>
      )}

      {step === "barber" && (
        <div className="w-full max-w-lg">
          <div className="mb-6 text-center">
            <h2 className="text-lg font-semibold">¿Quién sos?</h2>
            <p className="text-sm text-muted-foreground">
              {selectedBranch?.name}
            </p>
          </div>

          {loadingBarbers ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full rounded-xl" />
              ))}
            </div>
          ) : barbers.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              No hay barberos en esta sucursal
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {barbers.map((barber) => (
                <button
                  key={barber.id}
                  onClick={() => handleBarberSelect(barber)}
                  className="flex flex-col items-center gap-3 rounded-xl border bg-card p-5 transition-colors hover:bg-accent active:scale-[0.98]"
                >
                  <div className="flex size-14 items-center justify-center rounded-full bg-muted text-lg font-bold text-foreground">
                    {getInitials(barber.full_name)}
                  </div>
                  <span className="text-center text-sm font-medium leading-tight">
                    {barber.full_name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === "pin" && selectedBarber && (
        <div className="flex w-full max-w-xs flex-col items-center">
          {loginBlock ? (
            <div className="flex flex-col items-center gap-5 text-center animate-in fade-in zoom-in-95 duration-300">
              <div
                className={`flex size-20 items-center justify-center rounded-full border-2 ${
                  loginBlock === "needs_face_registration"
                    ? "border-blue-500/30 bg-blue-500/10"
                    : "border-amber-500/30 bg-amber-500/10"
                }`}
              >
                {loginBlock === "needs_face_registration" ? (
                  <ScanFace className="size-10 text-blue-400" strokeWidth={1.5} />
                ) : (
                  <LogIn className="size-10 text-amber-400" strokeWidth={1.5} />
                )}
              </div>

              <div>
                <h2 className="text-xl font-bold">
                  {loginBlock === "needs_face_registration"
                    ? "Registrá tu rostro"
                    : "No hiciste el check-in"}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground max-w-[260px]">
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
                className="mt-2"
              >
                <ArrowLeft className="mr-2 size-4" />
                Volver a intentar
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-6 flex flex-col items-center gap-1">
                <div className="mb-2 flex size-16 items-center justify-center rounded-full bg-muted text-xl font-bold">
                  {getInitials(selectedBarber.full_name)}
                </div>
                <h2 className="text-lg font-semibold">
                  {selectedBarber.full_name}
                </h2>
                <p className="text-sm text-muted-foreground">Ingresá tu PIN</p>
              </div>

              <div className="mb-6 flex gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className={`size-4 rounded-full border-2 transition-colors ${
                      i < pin.length
                        ? "border-foreground bg-foreground"
                        : "border-muted-foreground/40"
                    }`}
                  />
                ))}
              </div>

              {error && (
                <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
                  {error}
                </div>
              )}

              {submitting && (
                <Loader2 className="mb-4 size-5 animate-spin text-muted-foreground" />
              )}

              <div className="grid w-full grid-cols-3 gap-3">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                  <Button
                    key={digit}
                    variant="outline"
                    onClick={() => handlePinDigit(digit)}
                    disabled={submitting}
                    className="h-16 text-2xl font-medium"
                  >
                    {digit}
                  </Button>
                ))}
                <div />
                <Button
                  variant="outline"
                  onClick={() => handlePinDigit("0")}
                  disabled={submitting}
                  className="h-16 text-2xl font-medium"
                >
                  0
                </Button>
                <Button
                  variant="ghost"
                  onClick={handlePinDelete}
                  disabled={submitting || pin.length === 0}
                  className="h-16"
                >
                  <Delete className="size-6" />
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
