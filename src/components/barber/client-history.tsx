'use client'

import { useState, useEffect, useMemo } from 'react'
import Image from 'next/image'
import {
  getClientProfile,
  type ClientProfileData,
} from '@/lib/actions/visit-history'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/format'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'

interface ClientHistoryProps {
  clientId: string
}

export function ClientHistory({ clientId }: ClientHistoryProps) {
  const supabase = useMemo(() => createClient(), [])
  const [profile, setProfile] = useState<ClientProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Diferimos los setState con queueMicrotask para evitar cascading renders.
    queueMicrotask(() => { if (!cancelled) setLoading(true) })
    getClientProfile(clientId).then((data) => {
      if (cancelled) return
      setProfile(data)
      setLoading(false)
    })
    return () => { cancelled = true }
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

  const visitsWithPhotos = profile.visits.filter((v) => v.photos.length > 0)

  if (visitsWithPhotos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-3 text-center text-sm text-muted-foreground">
        No hay fotos aún
      </div>
    )
  }

  return (
    <>
      <div className="space-y-4">
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-3 pr-2">
            {visitsWithPhotos.slice(0, 10).map((visit) => (
              <div key={visit.id} className="space-y-2 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">
                    {visit.service_name ?? 'Servicio'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(visit.completed_at)}
                  </p>
                </div>
                <div className="flex gap-2 overflow-x-auto">
                  {visit.photos.map((photo) => (
                    <Image
                      key={photo.id}
                      src={getUrl(photo.storage_path)}
                      alt="Corte"
                      width={80}
                      height={80}
                      className="size-20 rounded-md border object-cover cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => setExpandedPhoto(getUrl(photo.storage_path))}
                      unoptimized
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      <Dialog open={!!expandedPhoto} onOpenChange={(open) => !open && setExpandedPhoto(null)}>
        <DialogContent className="max-w-3xl border-none bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">Foto ampliada</DialogTitle>
          {expandedPhoto && (
            <Image
              src={expandedPhoto}
              alt="Corte ampliado"
              width={1280}
              height={1280}
              className="max-h-[85vh] w-full rounded-md object-contain"
              unoptimized
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
