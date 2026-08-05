'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { User, Phone, ShieldCheck } from 'lucide-react'

interface Props {
  name: string
  phone: string
  accepted: boolean
  cancellationHours: number
  onChange: (field: 'name' | 'phone' | 'accepted', value: string | boolean) => void
}

// Regex argentino lax: dígitos con o sin +, espacios o guiones, mínimo 8 dígitos
const PHONE_REGEX = /^\+?[\d\s\-]{8,15}$/

/**
 * El Input de shadcn asume fondo claro (`bg-transparent`, `border-input`,
 * `placeholder:text-muted-foreground`): sobre el fondo de marca el borde
 * desaparecía y el placeholder quedaba gris sobre gris. Se lo viste con los
 * tokens del tema en vez de tocar `src/components/ui/`, que es compartido.
 */
const INPUT_CLASS =
  'h-13 rounded-xl border bg-[var(--t-surface)] text-base text-[var(--t-text)] ' +
  'placeholder:text-[var(--t-text-faint)] border-[var(--t-text-faint)] ' +
  'focus-visible:border-[var(--t-accent)] focus-visible:ring-[var(--t-ring)] ' +
  'aria-invalid:border-[var(--t-danger)]'

export function ContactStep({
  name,
  phone,
  accepted,
  cancellationHours,
  onChange,
}: Props) {
  const [nameTouched, setNameTouched] = useState(false)
  const [phoneTouched, setPhoneTouched] = useState(false)

  const nameError = nameTouched && name.trim().length < 2
  const phoneError = phoneTouched && !PHONE_REGEX.test(phone.trim())

  const horas = `${cancellationHours} ${cancellationHours === 1 ? 'hora' : 'horas'}`

  return (
    <div className="space-y-5">
      {/* Nombre */}
      <div className="space-y-2">
        <label
          htmlFor="contact-name"
          className="flex items-center gap-1.5 text-sm font-semibold text-[var(--t-text)]"
        >
          <User className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
          Nombre completo
        </label>
        <Input
          id="contact-name"
          type="text"
          autoComplete="name"
          placeholder="Ej: Juan García"
          value={name}
          onChange={e => onChange('name', e.target.value)}
          onBlur={() => setNameTouched(true)}
          className={INPUT_CLASS}
          aria-invalid={nameError}
          aria-describedby={nameError ? 'name-error' : undefined}
        />
        {nameError && (
          <p id="name-error" className="text-xs font-medium text-[var(--t-danger-text)]" role="alert">
            Ingresá tu nombre completo (mínimo 2 caracteres)
          </p>
        )}
      </div>

      {/* Teléfono */}
      <div className="space-y-2">
        <label
          htmlFor="contact-phone"
          className="flex items-center gap-1.5 text-sm font-semibold text-[var(--t-text)]"
        >
          <Phone className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
          Teléfono (WhatsApp)
        </label>
        <Input
          id="contact-phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="Ej: 3584402511"
          value={phone}
          onChange={e => onChange('phone', e.target.value)}
          onBlur={() => setPhoneTouched(true)}
          className={INPUT_CLASS}
          aria-invalid={phoneError}
          aria-describedby={phoneError ? 'phone-error' : undefined}
        />
        {phoneError && (
          <p id="phone-error" className="text-xs font-medium text-[var(--t-danger-text)]" role="alert">
            Ingresá un número de teléfono válido
          </p>
        )}
        <p className="text-xs text-[var(--t-text-muted)]">
          Te enviamos la confirmación por WhatsApp.
        </p>
      </div>

      {/* Política de cancelación */}
      <div
        className="flex items-start gap-3 rounded-2xl border p-4"
        style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
      >
        <Checkbox
          id="cancel-policy"
          checked={accepted}
          onCheckedChange={val => onChange('accepted', Boolean(val))}
          className="mt-0.5 size-5 rounded-[6px] border-[var(--t-text-faint)] bg-[var(--t-surface-alt)] data-[state=checked]:border-[var(--t-primary)] data-[state=checked]:bg-[var(--t-primary)] data-[state=checked]:text-[var(--t-on-primary)] focus-visible:border-[var(--t-accent)] focus-visible:ring-[var(--t-ring)]"
        />
        {/* El Label de shadcn trae `flex items-center gap-2`: metiendo texto rico
            adentro, cada corrida de texto se volvía un flex item y el párrafo se
            renderizaba en cuatro columnas. El label queda sólo para el
            encabezado corto; el cuerpo va en un <p> normal. */}
        <div className="min-w-0 flex-1 space-y-1">
          <label
            htmlFor="cancel-policy"
            className="flex cursor-pointer items-center gap-1.5 text-sm font-bold text-[var(--t-text)]"
          >
            <ShieldCheck className="h-4 w-4 text-[var(--t-accent)]" />
            Política de cancelación
          </label>
          <p className="text-sm leading-relaxed text-[var(--t-text-muted)]">
            Entiendo que puedo cancelar mi turno hasta{' '}
            <strong className="font-semibold text-[var(--t-text)]">{horas} antes</strong> del
            horario reservado.
          </p>
        </div>
      </div>
    </div>
  )
}
