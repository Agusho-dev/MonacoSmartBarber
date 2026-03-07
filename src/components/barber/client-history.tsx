'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  getClientProfile,
  type ClientProfileData,
} from '@/lib/actions/visit-history'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { History, Star, ChevronDown, ChevronUp } from 'lucide-react'

interface ClientHistoryProps {
  clientId: string
}

export function ClientHistory({ clientId }: ClientHistoryProps) {
  const supabase = useMemo(() => createClient(), [])
  const [profile, setProfile] = useState<ClientProfileData | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setExpanded(false)
    getClientProfile(clientId).then((data) => {
      setProfile(data)
      setLoading(false)
    })
  }, [clientId])

  function getUrl(path: string) {
    const { data } = supabase.storage.from('visit-photos').getPublicUrl(path)
    return data.publicUrl
  }

  if (loading) {
    return <Skeleton className="h-10 w-full rounded-lg" />
  }

  if (!profile || profile.visits.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-3 text-center text-sm text-muted-foreground">
        Primera visita del cliente
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {profile.frequentBarber && (
        <div className="flex items-center gap-2 text-sm">
          <Star className="size-3.5 text-yellow-400" />
          <span className="text-muted-foreground">
            Barbero habitual:{' '}
            <strong className="text-foreground">
              {profile.frequentBarber.name}
            </strong>{' '}
            ({profile.frequentBarber.count} visitas)
          </span>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-2">
          <History className="size-4" />
          Historial ({profile.totalVisits} visitas)
        </span>
        {expanded ? (
          <ChevronUp className="size-4" />
        ) : (
          <ChevronDown className="size-4" />
        )}
      </Button>

      {expanded && (
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-3 pr-2">
            {profile.visits.slice(0, 10).map((visit) => (
              <div key={visit.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {visit.service_name ?? 'Servicio'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {visit.barber_name} &middot;{' '}
                      {formatDate(visit.completed_at)}
                    </p>
                  </div>
                </div>
                {visit.notes && (
                  <p className="text-xs text-muted-foreground">{visit.notes}</p>
                )}
                {visit.tags && visit.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {visit.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-xs"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                {visit.photos.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto">
                    {visit.photos.map((photo) => (
                      <img
                        key={photo.id}
                        src={getUrl(photo.storage_path)}
                        alt="Corte"
                        className="size-16 rounded-md border object-cover"
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
