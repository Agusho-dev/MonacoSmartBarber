'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ExternalLink, FileEdit, Info, MessageCircleQuestionMark, Search, Sparkles, User, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { checkinClient } from '@/lib/actions/queue'
import { asesoriaHabilitadaEnSucursal, type MotivoPedidoAsesoria } from '@/lib/actions/asesoria'
import { searchClients } from '@/lib/actions/clients'
import { avisarYRecargarPorVersion, esErrorDeVersion, TEXTO_RECARGA_MANUAL } from '@/lib/recarga-version'
import { useBranchStore } from '@/stores/branch-store'
import type { Service } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { BarberRow } from './_tablero/derivados'

/**
 * Valor del desplegable de servicio que significa «pidió asesoría» (mig 217).
 * Como en la tablet, la asesoría REEMPLAZA al servicio: se manda `asesoria=1`
 * y ningún `service_id`.
 */
const OPCION_ASESORIA = '__asesoria__'
const MENOR_ESPERA = '__dynamic__'

const COLUMNAS_BARBERO = 'id, full_name, branch_id, status, is_active, hidden_from_checkin, avatar_url'

/** Una acción que no volvió (la red o un deploy nuevo): se dice, nunca en silencio. */
function avisarAccionFallida(e: unknown, texto: string) {
  console.error('[fila/alta]', texto, e)
  if (esErrorDeVersion(e)) {
    if (!avisarYRecargarPorVersion()) toast.error(TEXTO_RECARGA_MANUAL, { id: 'recarga-manual' })
    return
  }
  toast.error(texto)
}

/** «Pidió asesoría» al pie del desplegable de servicio del registro (mig 217). */
function OpcionAsesoriaDelRegistro() {
  return (
    <>
      <SelectSeparator />
      <SelectItem value={OPCION_ASESORIA}>
        <MessageCircleQuestionMark className="text-fuchsia-300" aria-hidden />
        Pidió asesoría · sin costo
      </SelectItem>
    </>
  )
}

/** Qué pasa con un cliente anotado pidiendo asesoría, dicho debajo del desplegable. */
function AyudaAsesoriaDelRegistro() {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <MessageCircleQuestionMark className="mt-px size-3.5 shrink-0 text-fuchsia-300" aria-hidden />
      No sabe qué hacerse: le avisamos en el panel del barbero y él elige el servicio al cobrar.
    </p>
  )
}

/**
 * «Anotar cliente» de la fila: buscar a alguien que ya vino, dar de alta a uno
 * nuevo (con o sin teléfono) o abrir la tablet de check-in. Vive en el
 * encabezado de la pantalla y no en el tablero, así el botón está también en
 * la pestaña de turnos. Las altas aparecen en la fila solas, por Realtime.
 */
export function AltaCliente({ orgId, barberosIniciales }: { orgId: string; barberosIniciales: BarberRow[] }) {
  const selectedBranchId = useBranchStore((s) => s.selectedBranchId)
  const supabase = useMemo(() => createClient(), [])

  const [barberos, setBarberos] = useState<BarberRow[]>(barberosIniciales)
  const [services, setServices] = useState<Service[]>([])

  const [manualDialogOpen, setManualDialogOpen] = useState(false)
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)
  const [manualForm, setManualForm] = useState({ phone: '', name: '', serviceId: '', barberId: MENOR_ESPERA, isSpecial: false })
  const [manualLoading, setManualLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; phone: string }[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchExecuted, setSearchExecuted] = useState(false)
  const [selectedSearchClient, setSelectedSearchClient] = useState<{ id: string; name: string; phone: string } | null>(null)
  const [searchServiceId, setSearchServiceId] = useState('')
  const [searchBarberId, setSearchBarberId] = useState(MENOR_ESPERA)
  const [searchCheckinLoading, setSearchCheckinLoading] = useState(false)
  // Asesoría (mig 217): el interruptor de la sucursal elegida, leído al abrir el
  // registro. Guarda de qué sucursal es: cambiar de sucursal no hereda el valor.
  const [asesoriaSucursal, setAsesoriaSucursal] = useState<{ branchId: string; habilitada: boolean } | null>(null)

  // Servicios principales para el desplegable (los mismos que ofrece la tablet).
  useEffect(() => {
    supabase
      .from('services')
      .select('*')
      .eq('is_active', true)
      .in('availability', ['checkin', 'both'])
      .order('name')
      .then(({ data }) => { if (data) setServices(data as Service[]) })
  }, [supabase])

  const dialogoDeAltaAbierto = manualDialogOpen || searchDialogOpen

  // Al abrir un alta se vuelve a leer el equipo: un barbero que se ocultó de la
  // tablet a media mañana no tiene que aparecer en «Barbero».
  useEffect(() => {
    if (!dialogoDeAltaAbierto) return
    let vigente = true
    supabase
      .from('staff')
      .select(COLUMNAS_BARBERO)
      .eq('organization_id', orgId)
      .or('role.eq.barber,is_also_barber.eq.true')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => { if (vigente && data) setBarberos(data as BarberRow[]) })
    return () => { vigente = false }
  }, [dialogoDeAltaAbierto, supabase, orgId])

  // «Pidió asesoría» se ofrece sólo si la sucursal la tiene prendida, igual que
  // en la tablet. Falla CERRADA: sin el interruptor confirmado no se ofrece, y
  // el servidor la vuelve a validar al anotar.
  useEffect(() => {
    if (!dialogoDeAltaAbierto || !selectedBranchId) return
    let vigente = true
    asesoriaHabilitadaEnSucursal(selectedBranchId)
      .then((habilitada) => {
        if (vigente) setAsesoriaSucursal({ branchId: selectedBranchId, habilitada })
      })
      .catch((e: unknown) => {
        console.error('[fila/alta] interruptor de asesoría', e)
        if (vigente) setAsesoriaSucursal({ branchId: selectedBranchId, habilitada: false })
      })
    return () => { vigente = false }
  }, [dialogoDeAltaAbierto, selectedBranchId])

  const asesoriaDisponible =
    !!selectedBranchId && asesoriaSucursal?.branchId === selectedBranchId && asesoriaSucursal.habilitada
  // Lo elegido en cada desplegable, sin una «asesoría» que la sucursal ya no ofrece.
  const servicioManual = manualForm.serviceId === OPCION_ASESORIA && !asesoriaDisponible ? '' : manualForm.serviceId
  const servicioBuscado = searchServiceId === OPCION_ASESORIA && !asesoriaDisponible ? '' : searchServiceId

  const serviciosDeLaSucursal = services.filter((s) => !selectedBranchId || s.branch_id === selectedBranchId || !s.branch_id)
  const barberosElegibles = barberos.filter(
    (b) => b.is_active && !b.hidden_from_checkin && (!selectedBranchId || b.branch_id === selectedBranchId),
  )

  /** Pone el servicio o el pedido de asesoría en el FormData de `checkinClient`. */
  function cargarServicioOAsesoria(fd: FormData, valor: string): boolean {
    if (valor === OPCION_ASESORIA) {
      fd.set('asesoria', '1')
      return true
    }
    if (valor) fd.set('service_id', valor)
    return false
  }

  /**
   * El cliente ya tenía lugar: si pidió asesoría, qué pasó con el pedido.
   * `asesoriaMotivo` dice por qué NO se sumó (null = se sumó o no la pidió).
   */
  function avisarYaEnFila(r: {
    asesoriaPedida?: boolean
    asesoriaSumada?: boolean
    asesoriaMotivo?: MotivoPedidoAsesoria | null
  }) {
    const titulo = 'El cliente ya está en la fila'
    if (r.asesoriaSumada) {
      toast.info(titulo, { description: 'Sumamos su pedido de asesoría: le avisamos en el panel del barbero.' })
      return
    }
    if (!r.asesoriaPedida) {
      toast.info(titulo)
      return
    }
    switch (r.asesoriaMotivo) {
      case 'turno':
        // Un turno no tiene la salida «solo asesoría»: la marca no se le suma.
        toast.info(titulo, { description: 'Tiene turno: la asesoría se la pide a su barbero cuando lo atienda.' })
        return
      case 'limite':
        toast.warning(titulo, {
          description: 'No pudimos sumar su pedido de asesoría: esperá un momento y volvé a intentar.',
        })
        return
      case 'en_curso':
        toast.info(titulo, { description: 'Ya lo están atendiendo: avisale a su barbero que quiere asesoría.' })
        return
      case 'deshabilitada':
        toast.info(titulo, { description: 'La sucursal tiene la asesoría apagada: avisale a su barbero.' })
        return
      default:
        toast.info(titulo, { description: 'Avisale a su barbero que quiere asesoría.' })
    }
  }

  /** Alta hecha. Si pidió asesoría y el servidor la descartó (la apagaron en el medio), se dice. */
  function avisarAlta(titulo: string, pidioAsesoria: boolean, asesoriaQuedo: boolean) {
    if (pidioAsesoria && !asesoriaQuedo) {
      toast.warning(titulo, { description: 'Quedó sin el pedido de asesoría: la sucursal la tiene apagada.' })
    } else if (pidioAsesoria) {
      toast.success(titulo, { description: 'Pidió asesoría: le avisamos en el panel del barbero.' })
    } else {
      toast.success(titulo)
    }
  }

  const handleManualCheckin = async () => {
    if (!selectedBranchId) {
      toast.error('Seleccioná una sucursal primero')
      return
    }
    // Cliente especial: sin teléfono y con nombre opcional (lo resuelve el server).
    if (!manualForm.isSpecial && (!manualForm.phone || !manualForm.name)) {
      toast.error('Nombre y teléfono son obligatorios')
      return
    }
    setManualLoading(true)
    const fd = new FormData()
    fd.set('name', manualForm.name)
    fd.set('branch_id', selectedBranchId)
    if (manualForm.isSpecial) {
      fd.set('special', '1')
    } else {
      fd.set('phone', manualForm.phone)
    }
    // Alta manual del dashboard: el origen que queda en `clients.signup_source`
    // es 'staff', no la tablet (mig 210).
    fd.set('origen', 'staff')
    // La asesoría reemplaza al servicio, como en la tablet (mig 217).
    const pideAsesoria = cargarServicioOAsesoria(fd, servicioManual)
    if (manualForm.barberId && manualForm.barberId !== MENOR_ESPERA) {
      fd.set('barber_id', manualForm.barberId)
    }
    let result: Awaited<ReturnType<typeof checkinClient>>
    try {
      result = await checkinClient(fd)
    } catch (e) {
      avisarAccionFallida(e, 'No pudimos registrar al cliente. Revisá la conexión y probá de nuevo.')
      return
    } finally {
      setManualLoading(false)
    }
    if (result.error) {
      toast.error(result.error)
    } else if (result.alreadyInQueue) {
      avisarYaEnFila(result)
    } else {
      avisarAlta(
        manualForm.isSpecial ? 'Cliente especial agregado a la fila' : 'Cliente registrado en la fila',
        pideAsesoria,
        result.asesoria === true,
      )
      setManualForm({ phone: '', name: '', serviceId: '', barberId: MENOR_ESPERA, isSpecial: false })
      setManualDialogOpen(false)
    }
  }

  const handleSearch = useCallback(async (query: string) => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setSearchResults([])
      setSearchExecuted(false)
      return
    }
    setSearchLoading(true)
    setSearchExecuted(true)
    let result: Awaited<ReturnType<typeof searchClients>>
    try {
      result = await searchClients(trimmed)
    } catch (e) {
      avisarAccionFallida(e, 'No pudimos buscar clientes. Revisá la conexión y probá de nuevo.')
      return
    } finally {
      setSearchLoading(false)
    }
    if (result.error) {
      toast.error(result.error)
    } else {
      setSearchResults(result.data ?? [])
    }
  }, [])

  // Búsqueda automática al escribir (debounce). Los resets van en un timeout
  // para que los setState corran fuera del cuerpo del effect.
  useEffect(() => {
    let cancelled = false
    if (searchQuery.trim().length < 2) {
      const resetId = setTimeout(() => {
        if (cancelled) return
        setSearchResults([])
        setSearchExecuted(false)
      }, 0)
      return () => { cancelled = true; clearTimeout(resetId) }
    }
    const timer = setTimeout(() => handleSearch(searchQuery), 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchQuery, handleSearch])

  const handleSearchCheckin = async (client: { id: string; name: string; phone: string }) => {
    if (!selectedBranchId) {
      toast.error('Seleccioná una sucursal primero')
      return
    }
    setSearchCheckinLoading(true)
    const fd = new FormData()
    fd.set('name', client.name)
    fd.set('phone', client.phone)
    fd.set('branch_id', selectedBranchId)
    // El cliente ya existe (sale del buscador), así que acá no se crea ninguna
    // ficha; el origen viaja igual por si el alta terminara ocurriendo.
    fd.set('origen', 'staff')
    const pideAsesoria = cargarServicioOAsesoria(fd, servicioBuscado)
    if (searchBarberId && searchBarberId !== MENOR_ESPERA) {
      fd.set('barber_id', searchBarberId)
    }
    let result: Awaited<ReturnType<typeof checkinClient>>
    try {
      result = await checkinClient(fd)
    } catch (e) {
      avisarAccionFallida(e, 'No pudimos registrar al cliente. Revisá la conexión y probá de nuevo.')
      return
    } finally {
      setSearchCheckinLoading(false)
    }
    if (result.error) {
      toast.error(result.error)
    } else if (result.alreadyInQueue) {
      avisarYaEnFila(result)
    } else {
      avisarAlta(`${client.name} registrado en la fila`, pideAsesoria, result.asesoria === true)
      setSearchQuery('')
      setSearchResults([])
      setSelectedSearchClient(null)
      setSearchServiceId('')
      setSearchBarberId(MENOR_ESPERA)
      setSearchDialogOpen(false)
    }
  }

  const selectorDeBarbero = (valor: string, onCambiar: (v: string) => void) => (
    <Select value={valor} onValueChange={onCambiar}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Elegir barbero" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={MENOR_ESPERA}>Menor espera · el primero que se libere</SelectItem>
        {barberosElegibles.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.full_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  const selectorDeServicio = (valor: string, onCambiar: (v: string) => void) => (
    <Select value={valor} onValueChange={onCambiar}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Seleccionar servicio (opcional)" />
      </SelectTrigger>
      <SelectContent>
        {serviciosDeLaSucursal.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
        {asesoriaDisponible && <OpcionAsesoriaDelRegistro />}
      </SelectContent>
    </Select>
  )

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="h-10 gap-2 px-3.5 font-semibold sm:px-4">
            <UserPlus className="size-4" aria-hidden />
            Anotar cliente
            <ChevronDown className="size-3.5 opacity-70" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem onSelect={() => setSearchDialogOpen(true)} className="items-start gap-3 py-2.5">
            <Search className="mt-0.5 size-4" aria-hidden />
            <span>
              <span className="block font-medium">Buscar cliente</span>
              <span className="block text-xs text-muted-foreground">Ya vino antes: por nombre o teléfono</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setManualDialogOpen(true)} className="items-start gap-3 py-2.5">
            <FileEdit className="mt-0.5 size-4" aria-hidden />
            <span>
              <span className="block font-medium">Cliente nuevo</span>
              <span className="block text-xs text-muted-foreground">Con teléfono, o sin teléfono (niños, invitados)</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a
              href={`/checkin${selectedBranchId ? `?branch=${selectedBranchId}` : ''}`}
              target="_blank"
              rel="noopener noreferrer"
              className="items-start gap-3 py-2.5"
            >
              <ExternalLink className="mt-0.5 size-4" aria-hidden />
              <span>
                <span className="block font-medium">Abrir la tablet de check-in</span>
                <span className="block text-xs text-muted-foreground">En otra pestaña, para que se anote solo</span>
              </span>
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Cliente nuevo */}
      <Dialog
        open={manualDialogOpen}
        onOpenChange={(open) => {
          setManualDialogOpen(open)
          if (!open) setManualForm({ phone: '', name: '', serviceId: '', barberId: MENOR_ESPERA, isSpecial: false })
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cliente nuevo</DialogTitle>
            <DialogDescription>Entra a la fila al final, en orden de llegada.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-1">
            {/* Toggle "cliente especial": walk-in sin teléfono (niño, invitado, etc.).
                Label + Switch como hermanos (no anidados) para no meter un button
                dentro de otro y evitar el doble-toggle. */}
            <div
              className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                manualForm.isSpecial ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/30'
              }`}
            >
              <label htmlFor="manual-special-switch" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-md transition-colors ${
                    manualForm.isSpecial ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <Sparkles className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">Cliente especial</span>
                  <span className="mt-0.5 block text-xs leading-tight text-muted-foreground">
                    Sin teléfono — niños, invitados o quien no deja su número
                  </span>
                </span>
              </label>
              <Switch
                id="manual-special-switch"
                checked={manualForm.isSpecial}
                onCheckedChange={(v) => setManualForm((f) => ({ ...f, isSpecial: v }))}
              />
            </div>

            {manualForm.isSpecial ? (
              <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>Se agrega sin teléfono. Cada cliente especial queda como un registro aparte en la fila.</span>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="manual-phone">Teléfono</Label>
                <Input
                  id="manual-phone"
                  inputMode="tel"
                  placeholder="Ej: 1122334455"
                  value={manualForm.phone}
                  onChange={(e) => setManualForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-name">{manualForm.isSpecial ? 'Nombre (opcional)' : 'Nombre'}</Label>
              <Input
                id="manual-name"
                placeholder={manualForm.isSpecial ? 'Ej: Niño, Invitado…' : 'Nombre del cliente'}
                value={manualForm.name}
                onChange={(e) => setManualForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Servicio</Label>
              {selectorDeServicio(servicioManual, (v) => setManualForm((f) => ({ ...f, serviceId: v })))}
              {servicioManual === OPCION_ASESORIA && <AyudaAsesoriaDelRegistro />}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Barbero</Label>
              {selectorDeBarbero(manualForm.barberId, (v) => setManualForm((f) => ({ ...f, barberId: v })))}
            </div>
            <Button onClick={handleManualCheckin} disabled={manualLoading} className="h-11 w-full">
              {manualLoading ? 'Registrando…' : manualForm.isSpecial ? 'Agregar cliente especial' : 'Agregar a la fila'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Buscar cliente existente */}
      <Dialog
        open={searchDialogOpen}
        onOpenChange={(open) => {
          setSearchDialogOpen(open)
          if (!open) {
            setSearchQuery('')
            setSearchResults([])
            setSearchExecuted(false)
            setSelectedSearchClient(null)
            setSearchServiceId('')
            setSearchBarberId(MENOR_ESPERA)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buscar cliente</DialogTitle>
            <DialogDescription>Por nombre o por teléfono, aunque sea una parte.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                placeholder="Nombre o teléfono…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                autoFocus
                aria-label="Buscar por nombre o teléfono"
              />
            </div>

            {searchLoading && <p className="py-4 text-center text-sm text-muted-foreground">Buscando…</p>}

            {searchResults.length > 0 && (
              <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
                {searchResults.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => setSelectedSearchClient(client)}
                    aria-pressed={selectedSearchClient?.id === client.id}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      selectedSearchClient?.id === client.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-white/[0.04] hover:bg-white/[0.07]'
                    }`}
                  >
                    <User className="size-4 shrink-0" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{client.name}</p>
                      <p className="text-xs opacity-70">{client.phone}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {searchResults.length === 0 && searchExecuted && !searchLoading && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No encontramos a nadie. Probá con otra parte del nombre o el teléfono, o dalo de alta como cliente nuevo.
              </p>
            )}

            {selectedSearchClient && (
              <div className="flex flex-col gap-3 border-t pt-3">
                <p className="text-sm font-medium">
                  Anotar a <span className="text-primary">{selectedSearchClient.name}</span>
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label>Servicio</Label>
                  {selectorDeServicio(servicioBuscado, setSearchServiceId)}
                  {servicioBuscado === OPCION_ASESORIA && <AyudaAsesoriaDelRegistro />}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Barbero</Label>
                  {selectorDeBarbero(searchBarberId, setSearchBarberId)}
                </div>
                <Button
                  onClick={() => handleSearchCheckin(selectedSearchClient)}
                  disabled={searchCheckinLoading}
                  className="h-11 w-full"
                >
                  {searchCheckinLoading ? 'Registrando…' : 'Agregar a la fila'}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
