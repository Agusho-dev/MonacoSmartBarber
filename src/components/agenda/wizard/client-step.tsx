'use client'

import { useState, useCallback, useRef, useTransition } from 'react'
import { User, Phone, Plus, Search, Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { searchClientsForAgenda, findOrCreateClient } from '@/lib/actions/turnos'
import type { TurnosClientResult } from '@/lib/actions/turnos'

interface Props {
  selectedClient: TurnosClientResult | null
  onSelect: (client: TurnosClientResult) => void
}

type Mode = 'search' | 'create'

export function ClientStep({ selectedClient, onSelect }: Props) {
  const [mode, setMode] = useState<Mode>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TurnosClientResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')

  // Formulario de creación
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [isPending, startTransition] = useTransition()

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    setError('')

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (value.trim().length < 2) {
      setResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      const res = await searchClientsForAgenda(value)
      if ('error' in res) {
        setError(res.error)
        setResults([])
      } else {
        setResults(res.data)
      }
      setSearching(false)
    }, 300)
  }, [])

  function handleCreate() {
    if (!newName.trim() || !newPhone.trim()) {
      setError('Completá nombre y teléfono')
      return
    }
    setError('')
    startTransition(async () => {
      const res = await findOrCreateClient({ name: newName.trim(), phone: newPhone.trim() })
      if ('error' in res) {
        setError(res.error)
        return
      }
      onSelect(res.data)
    })
  }

  if (selectedClient) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-green-500/15">
            <Check className="size-4 text-green-600" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{selectedClient.name}</p>
            <p className="truncate text-xs text-muted-foreground">{selectedClient.phone}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto shrink-0"
            onClick={() => onSelect(null as unknown as TurnosClientResult)}
          >
            Cambiar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          variant={mode === 'search' ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setMode('search'); setError('') }}
        >
          <Search className="mr-1.5 size-3.5" />
          Buscar cliente
        </Button>
        <Button
          variant={mode === 'create' ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setMode('create'); setError(''); setResults([]) }}
        >
          <Plus className="mr-1.5 size-3.5" />
          Crear cliente
        </Button>
      </div>

      {mode === 'search' && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Nombre o teléfono..."
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              className="pl-8"
              autoFocus
            />
            {searching && (
              <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>

          {results.length > 0 && (
            <ul className="divide-y rounded-md border">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      <User className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.phone}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {query.trim().length >= 2 && !searching && results.length === 0 && (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              <p>No se encontró ningún cliente.</p>
              <Button
                variant="link"
                size="sm"
                className="mt-1 h-auto p-0 text-xs"
                onClick={() => {
                  setMode('create')
                  setNewName(query)
                  setNewPhone(query.match(/^\+?\d/)  ? query : '')
                  setError('')
                }}
              >
                Crear &quot;{query}&quot; como cliente nuevo
              </Button>
            </div>
          )}

          {query.trim().length < 2 && (
            <p className="text-xs text-muted-foreground">
              Escribí al menos 2 caracteres para buscar.
            </p>
          )}
        </div>
      )}

      {mode === 'create' && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-client-name">Nombre completo</Label>
            <div className="relative">
              <User className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="new-client-name"
                placeholder="Juan García"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="pl-8"
                autoFocus
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-client-phone">Teléfono</Label>
            <div className="relative">
              <Phone className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="new-client-phone"
                type="tel"
                placeholder="+54 11 1234-5678"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <Button
            onClick={handleCreate}
            disabled={isPending || !newName.trim() || !newPhone.trim()}
            className="w-full"
          >
            {isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Plus className="mr-2 size-4" />
            )}
            Guardar cliente
          </Button>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  )
}
