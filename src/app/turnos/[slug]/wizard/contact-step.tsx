'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { User, Phone, ShieldCheck } from 'lucide-react'

interface Props {
  name: string
  phone: string
  accepted: boolean
  cancellationHours: number
  onChange: (field: 'name' | 'phone' | 'accepted', value: string | boolean) => void
  branding: { primary: string; bg: string; text: string }
}

// Regex argentino lax: dígitos con o sin +, espacios o guiones, mínimo 8 dígitos
const PHONE_REGEX = /^\+?[\d\s\-]{8,15}$/

export function ContactStep({
  name,
  phone,
  accepted,
  cancellationHours,
  onChange,
  branding,
}: Props) {
  const [nameTouched, setNameTouched] = useState(false)
  const [phoneTouched, setPhoneTouched] = useState(false)

  const nameError = nameTouched && name.trim().length < 2
  const phoneError = phoneTouched && !PHONE_REGEX.test(phone.trim())

  return (
    <div className="space-y-5">
      {/* Nombre */}
      <div className="space-y-1.5">
        <Label
          htmlFor="contact-name"
          className="flex items-center gap-1.5 text-sm font-semibold"
          style={{ color: branding.text }}
        >
          <User className="h-3.5 w-3.5 opacity-60" />
          Nombre completo
        </Label>
        <Input
          id="contact-name"
          type="text"
          autoComplete="name"
          placeholder="Ej: Juan García"
          value={name}
          onChange={e => onChange('name', e.target.value)}
          onBlur={() => setNameTouched(true)}
          className="h-12 text-base"
          aria-invalid={nameError}
          aria-describedby={nameError ? 'name-error' : undefined}
        />
        {nameError && (
          <p id="name-error" className="text-xs text-red-500" role="alert">
            Ingresá tu nombre completo (mínimo 2 caracteres)
          </p>
        )}
      </div>

      {/* Teléfono */}
      <div className="space-y-1.5">
        <Label
          htmlFor="contact-phone"
          className="flex items-center gap-1.5 text-sm font-semibold"
          style={{ color: branding.text }}
        >
          <Phone className="h-3.5 w-3.5 opacity-60" />
          Teléfono (WhatsApp)
        </Label>
        <Input
          id="contact-phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="Ej: 3584402511 o +54 358 440 2511"
          value={phone}
          onChange={e => onChange('phone', e.target.value)}
          onBlur={() => setPhoneTouched(true)}
          className="h-12 text-base"
          aria-invalid={phoneError}
          aria-describedby={phoneError ? 'phone-error' : undefined}
        />
        {phoneError && (
          <p id="phone-error" className="text-xs text-red-500" role="alert">
            Ingresá un número de teléfono válido
          </p>
        )}
        <p className="text-xs" style={{ color: branding.text, opacity: 0.5 }}>
          Te enviamos la confirmación por WhatsApp
        </p>
      </div>

      {/* Checkbox de política de cancelación */}
      <div
        className="flex items-start gap-3 rounded-xl p-4"
        style={{ backgroundColor: `${branding.primary}08`, border: `1px solid ${branding.primary}20` }}
      >
        <Checkbox
          id="cancel-policy"
          checked={accepted}
          onCheckedChange={val => onChange('accepted', Boolean(val))}
          className="mt-0.5"
          aria-label="Acepto la política de cancelación"
        />
        <Label
          htmlFor="cancel-policy"
          className="cursor-pointer text-sm leading-relaxed"
          style={{ color: branding.text, opacity: 0.85 }}
        >
          <span className="flex items-center gap-1.5 font-semibold" style={{ opacity: 1 }}>
            <ShieldCheck className="h-3.5 w-3.5" style={{ color: branding.primary }} />
            Política de cancelación
          </span>
          Entiendo que puedo cancelar mi turno hasta{' '}
          <strong>{cancellationHours} {cancellationHours === 1 ? 'hora' : 'horas'} antes</strong>{' '}
          del horario reservado.
        </Label>
      </div>
    </div>
  )
}
