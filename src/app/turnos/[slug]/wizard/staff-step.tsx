'use client'

import Image from 'next/image'
import { cn } from '@/lib/utils'
import { User, Check } from 'lucide-react'
import type { PublicStaff } from '@/lib/actions/public-booking'

interface Props {
  staff: PublicStaff[]
  selected: string | null   // null = cualquiera
  onSelect: (id: string | null) => void
  branding: { primary: string; bg: string; text: string }
}

export function StaffStep({ staff, selected, onSelect, branding }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {/* Opción "Cualquiera" */}
      <StaffCard
        id={null}
        name="Cualquiera disponible"
        avatarUrl={null}
        isSelected={selected === null}
        onSelect={onSelect}
        branding={branding}
        isAny
      />

      {staff.map(member => (
        <StaffCard
          key={member.id}
          id={member.id}
          name={member.full_name}
          avatarUrl={member.avatar_url}
          isSelected={selected === member.id}
          onSelect={onSelect}
          branding={branding}
          isAny={false}
        />
      ))}
    </div>
  )
}

interface StaffCardProps {
  id: string | null
  name: string
  avatarUrl: string | null
  isSelected: boolean
  onSelect: (id: string | null) => void
  branding: { primary: string; bg: string; text: string }
  isAny: boolean
}

function StaffCard({ id, name, avatarUrl, isSelected, onSelect, branding, isAny }: StaffCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={cn(
        'relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all active:scale-[0.98]',
        'min-h-[120px]'
      )}
      style={{
        borderColor: isSelected ? branding.primary : 'rgba(0,0,0,0.10)',
        backgroundColor: isSelected ? `${branding.primary}12` : 'transparent',
      }}
      aria-pressed={isSelected}
    >
      {/* Indicador de selección */}
      {isSelected && (
        <div
          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full"
          style={{ backgroundColor: branding.primary }}
        >
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        </div>
      )}

      {/* Avatar */}
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full"
        style={{
          backgroundColor: isAny ? `${branding.primary}20` : `${branding.primary}15`,
          border: isSelected ? `2px solid ${branding.primary}` : '2px solid rgba(0,0,0,0.08)',
        }}
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={name}
            fill
            sizes="64px"
            unoptimized
            className="object-cover"
          />
        ) : (
          <User
            className="h-6 w-6"
            style={{ color: branding.primary, opacity: 0.8 }}
          />
        )}
      </div>

      <p
        className="line-clamp-2 text-xs font-semibold leading-tight"
        style={{ color: branding.text }}
      >
        {name}
      </p>
    </button>
  )
}
