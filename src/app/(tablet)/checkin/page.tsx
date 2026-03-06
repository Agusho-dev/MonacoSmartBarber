'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { checkinClient } from '@/lib/actions/queue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Scissors,
  ArrowLeft,
  Delete,
  MapPin,
  CheckCircle2,
  Loader2,
  Smartphone,
} from 'lucide-react'
import type { Branch } from '@/lib/types/database'

type Step = 'branch' | 'phone' | 'name' | 'success'

const PHONE_LENGTH = 10
const RESET_DELAY_MS = 5_000
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

function formatPhone(digits: string): string {
  if (!digits) return ''
  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `${digits.slice(0, 2)} ${digits.slice(2)}`
  return `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`
}

export default function CheckinPage() {
  const [step, setStep] = useState<Step>('branch')
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [isReturning, setIsReturning] = useState(false)
  const [position, setPosition] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [error, setError] = useState('')
  const [animKey, setAnimKey] = useState(0)

  const resetTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('branches')
      .select('*')
      .eq('is_active', true)
      .then(({ data }) => {
        if (data) setBranches(data)
      })
  }, [])

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  useEffect(() => {
    if (step === 'name' && !isReturning) {
      setTimeout(() => nameInputRef.current?.focus(), 150)
    }
  }, [step, isReturning])

  const goTo = (next: Step) => {
    setAnimKey((k) => k + 1)
    setStep(next)
    setError('')
  }

  const reset = () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
    setSelectedBranch(null)
    setPhone('')
    setName('')
    setIsReturning(false)
    setPosition(0)
    setSubmitting(false)
    setLookingUp(false)
    setError('')
    goTo('branch')
  }

  // ── Branch ──

  const selectBranch = (branch: Branch) => {
    setSelectedBranch(branch)
    goTo('phone')
  }

  // ── Phone keypad ──

  const pressDigit = (digit: string) => {
    if (phone.length >= PHONE_LENGTH || lookingUp) return
    const next = phone + digit
    setPhone(next)
    if (next.length === PHONE_LENGTH) lookupPhone(next)
  }

  const pressDelete = () => {
    if (lookingUp) return
    setPhone((p) => p.slice(0, -1))
  }

  const lookupPhone = async (ph: string) => {
    setLookingUp(true)
    try {
      const supabase = createClient()
      const { data } = await supabase
        .from('clients')
        .select('id, name, phone')
        .eq('phone', ph)
        .single()

      if (data) {
        setName(data.name)
        setIsReturning(true)
      } else {
        setName('')
        setIsReturning(false)
      }
    } catch {
      setName('')
      setIsReturning(false)
    } finally {
      setLookingUp(false)
      goTo('name')
    }
  }

  // ── Confirm ──

  const handleConfirm = async () => {
    if (!selectedBranch || !name.trim() || submitting) return
    setSubmitting(true)
    setError('')

    try {
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('phone', phone)
      fd.append('branch_id', selectedBranch.id)

      const result = await checkinClient(fd)

      if ('error' in result && result.error) {
        setError(result.error)
        setSubmitting(false)
        return
      }

      setPosition(result.position)
      setSubmitting(false)
      goTo('success')
      resetTimer.current = setTimeout(reset, RESET_DELAY_MS)
    } catch {
      setError('Error al registrar. Intentá de nuevo.')
      setSubmitting(false)
    }
  }

  // ── Shared UI pieces ──

  const backButton = (onBack: () => void) => (
    <button
      onClick={onBack}
      className="self-start flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors py-2 -ml-1"
    >
      <ArrowLeft className="size-5" />
      <span className="text-lg">Atrás</span>
    </button>
  )

  // ── Render ──

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center select-none bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.03)_0%,transparent_60%)]">
      {/* ═══════════════ BRANCH SELECTION ═══════════════ */}
      {step === 'branch' && (
        <div
          key={`branch-${animKey}`}
          className="w-full max-w-2xl flex flex-col items-center gap-10 px-8 animate-in fade-in zoom-in-95 duration-500"
        >
          <div className="flex flex-col items-center gap-5">
            <div className="size-24 rounded-3xl bg-white/4 border border-white/10 flex items-center justify-center">
              <Scissors className="size-12 text-white" strokeWidth={1.5} />
            </div>
            <div className="text-center">
              <h1 className="text-5xl font-bold tracking-tight">
                Monaco Smart Barber
              </h1>
              <p className="text-xl text-muted-foreground mt-3">Bienvenido</p>
            </div>
          </div>

          <div className="w-24 h-px bg-white/10" />

          <div className="w-full space-y-4">
            <p className="text-center text-muted-foreground text-lg">
              Seleccioná tu sucursal
            </p>

            {branches.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid gap-4">
                {branches.map((branch) => (
                  <button
                    key={branch.id}
                    onClick={() => selectBranch(branch)}
                    className="group flex items-center gap-5 w-full rounded-2xl border border-white/8 bg-white/2 p-6 text-left transition-all duration-200 hover:bg-white/6 hover:border-white/20 active:scale-[0.98]"
                  >
                    <div className="shrink-0 size-16 rounded-xl bg-white/4 flex items-center justify-center group-hover:bg-white/8 transition-colors duration-200">
                      <MapPin className="size-7 text-white/60 group-hover:text-white/80 transition-colors" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-2xl font-semibold block">
                        {branch.name}
                      </span>
                      {branch.address && (
                        <span className="text-base text-muted-foreground block mt-1 truncate">
                          {branch.address}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════ PHONE ENTRY ═══════════════ */}
      {step === 'phone' && (
        <div
          key={`phone-${animKey}`}
          className="w-full max-w-md flex flex-col items-center gap-5 px-6 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          {backButton(() => {
            setPhone('')
            goTo('branch')
          })}

          <div className="text-center mt-2">
            <h2 className="text-3xl font-bold">Ingresá tu número</h2>
            <p className="text-muted-foreground mt-2 text-lg">
              {selectedBranch?.name}
            </p>
          </div>

          {/* Phone display */}
          <div className="w-full rounded-2xl border border-white/8 bg-white/2 p-6 text-center relative overflow-hidden">
            <p className="text-4xl font-mono font-bold tracking-[0.15em] min-h-12 flex items-center justify-center">
              {phone ? (
                formatPhone(phone)
              ) : (
                <span className="text-white/20">__ ____ ____</span>
              )}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              {phone.length < PHONE_LENGTH
                ? `${PHONE_LENGTH - phone.length} dígitos restantes`
                : 'Buscando...'}
            </p>
            {lookingUp && (
              <div className="absolute inset-0 bg-background/80 flex items-center justify-center backdrop-blur-sm animate-in fade-in duration-200">
                <Loader2 className="size-8 animate-spin" />
              </div>
            )}
          </div>

          {/* Numeric keypad */}
          <div className="w-full grid grid-cols-3 gap-3 mt-1">
            {KEYPAD.map((d) => (
              <button
                key={d}
                onClick={() => pressDigit(d)}
                disabled={lookingUp}
                className="h-[72px] rounded-2xl bg-white/4 border border-white/6 text-2xl font-semibold transition-all duration-150 hover:bg-white/8 active:bg-white/12 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
              >
                {d}
              </button>
            ))}

            <button
              onClick={pressDelete}
              disabled={lookingUp || phone.length === 0}
              className="h-[72px] rounded-2xl bg-white/4 border border-white/6 flex items-center justify-center transition-all duration-150 hover:bg-white/8 active:bg-white/12 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
            >
              <Delete className="size-6" />
            </button>
            <button
              onClick={() => pressDigit('0')}
              disabled={lookingUp}
              className="h-[72px] rounded-2xl bg-white/4 border border-white/6 text-2xl font-semibold transition-all duration-150 hover:bg-white/8 active:bg-white/12 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
            >
              0
            </button>
            <div />
          </div>
        </div>
      )}

      {/* ═══════════════ NAME CONFIRMATION / ENTRY ═══════════════ */}
      {step === 'name' && (
        <div
          key={`name-${animKey}`}
          className="w-full max-w-lg flex flex-col items-center gap-6 px-6 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          {backButton(() => {
            setPhone('')
            setName('')
            setIsReturning(false)
            goTo('phone')
          })}

          {isReturning ? (
            <div className="flex flex-col items-center gap-6 mt-6">
              <div className="size-24 rounded-full bg-white/4 border border-white/10 flex items-center justify-center animate-in zoom-in-75 duration-500">
                <span className="text-5xl">👋</span>
              </div>
              <div className="text-center">
                <h2 className="text-3xl font-bold">
                  ¡Bienvenido de vuelta!
                </h2>
                <p className="text-4xl font-bold mt-4">{name}</p>
                <p className="text-muted-foreground mt-3 text-lg">
                  Tel: {formatPhone(phone)}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-6 mt-6 w-full">
              <div className="text-center">
                <h2 className="text-3xl font-bold">¡Primera vez!</h2>
                <p className="text-xl text-muted-foreground mt-2">
                  Te damos la bienvenida
                </p>
                <p className="text-muted-foreground mt-1 text-base">
                  Ingresá tu nombre para continuar
                </p>
              </div>
              <Input
                ref={nameInputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) handleConfirm()
                }}
                placeholder="Tu nombre"
                className="h-16 text-2xl text-center rounded-2xl border-white/10 bg-white/3"
                autoComplete="off"
              />
            </div>
          )}

          {error && (
            <p className="text-destructive text-center text-lg">{error}</p>
          )}

          <Button
            onClick={handleConfirm}
            disabled={!name.trim() || submitting}
            className="w-full h-16 text-xl rounded-2xl font-semibold mt-2"
            size="lg"
          >
            {submitting ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              'Confirmar'
            )}
          </Button>
        </div>
      )}

      {/* ═══════════════ SUCCESS ═══════════════ */}
      {step === 'success' && (
        <div
          key={`success-${animKey}`}
          className="w-full max-w-lg flex flex-col items-center gap-8 px-6 animate-in fade-in zoom-in-95 duration-500"
        >
          <div className="size-28 rounded-full bg-white/4 border border-white/10 flex items-center justify-center animate-in zoom-in-50 duration-700">
            <CheckCircle2 className="size-16 text-white" strokeWidth={1.5} />
          </div>

          <div className="text-center">
            <h2 className="text-4xl font-bold">¡Estás en la fila!</h2>
            <div className="mt-6 py-8 px-12 rounded-3xl border border-white/10 bg-white/3">
              <p className="text-muted-foreground text-lg">Tu turno</p>
              <p className="text-8xl font-bold mt-2 tabular-nums">
                #{position}
              </p>
            </div>
          </div>

          {/* App promo */}
          <div className="flex items-center gap-4 rounded-2xl border border-white/6 bg-white/2 p-5 mt-2">
            <Smartphone className="size-8 text-muted-foreground shrink-0" />
            <p className="text-base text-muted-foreground leading-relaxed">
              ¿Sabías que podés ver la ocupación en tiempo real?{' '}
              <span className="text-foreground font-medium">
                Descargá nuestra app
              </span>
            </p>
          </div>

          {/* Countdown bar */}
          <div className="w-full max-w-xs h-1 rounded-full bg-white/10 overflow-hidden mt-2">
            <div
              className="h-full bg-white/40 rounded-full origin-left"
              style={{
                animation: `checkin-countdown ${RESET_DELAY_MS}ms linear forwards`,
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Volviendo al inicio...
          </p>

          <style>{`
            @keyframes checkin-countdown {
              from { transform: scaleX(1); }
              to { transform: scaleX(0); }
            }
          `}</style>
        </div>
      )}
    </div>
  )
}
