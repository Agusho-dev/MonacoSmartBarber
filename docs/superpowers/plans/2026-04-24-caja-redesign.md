# Caja Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar `/dashboard/caja` en 3 tabs (Hoy / Historial / Cierre del día) con monitoreo en vivo, búsqueda, comparativas vs semana pasada y vs ayer, y rendición de efectivo por barbero persistida.

**Architecture:** Server components que hidratan cliente + server actions en `src/lib/actions/caja.ts`. Nueva tabla `cash_handovers` (migración 113) para persistir el estado de rendición. Polling de 30s con `useVisibilityRefresh` existente. Descomposición del monolito `caja-client.tsx` (886 líneas) en ~12 archivos chicos.

**Tech Stack:** Next.js 16 App Router, React Server Components, Supabase, TypeScript, Tailwind CSS v4, shadcn/ui, date-fns, JSZip (ya instalado), Zustand (branch-store existente).

**Referencia:** `docs/superpowers/specs/2026-04-24-caja-redesign-design.md`.

**Testing note:** Este proyecto **no tiene framework de testing** configurado. El ciclo por task es `implementación → npm run lint → npm run build → commit`. Hay un task final de verificación manual end-to-end en browser.

---

## File Structure

**Created:**
- `supabase/migrations/113_cash_handovers.sql`
- `src/app/dashboard/caja/tab-hoy.tsx`
- `src/app/dashboard/caja/tab-historial.tsx`
- `src/app/dashboard/caja/tab-cierre.tsx`
- `src/app/dashboard/caja/components/hero-card.tsx`
- `src/app/dashboard/caja/components/payment-split.tsx`
- `src/app/dashboard/caja/components/ticket-list.tsx`
- `src/app/dashboard/caja/components/ticket-row.tsx`
- `src/app/dashboard/caja/components/filter-bar.tsx`
- `src/app/dashboard/caja/components/live-indicator.tsx`
- `src/app/dashboard/caja/components/cash-handover-card.tsx`
- `src/app/dashboard/caja/components/handover-dialog.tsx`
- `src/app/dashboard/caja/components/export-dialog.tsx`
- `src/app/dashboard/caja/components/date-range-picker-compact.tsx`

**Modified:**
- `src/lib/actions/caja.ts` — agregar comparativas, paginación, búsqueda, y 3 acciones nuevas de handover
- `src/lib/permissions.ts` — nuevo permiso `finances.reconcile_cash`
- `src/app/dashboard/caja/caja-client.tsx` — shell con tabs (reducir drásticamente de 886 líneas)
- `src/app/dashboard/caja/page.tsx` — pasar `initialTab` y `userPermissions`
- `src/app/dashboard/caja/loading.tsx` — ajustar al layout nuevo

**Unchanged:** `src/app/dashboard/layout.tsx`, `stores/branch-store.ts`, `components/dashboard/branch-selector.tsx`, tablas existentes (`visits`, `payment_accounts`, `transfer_logs`, `expense_tickets`).

---

## Task 1: Migración 113 — tabla `cash_handovers`

**Files:**
- Create: `supabase/migrations/113_cash_handovers.sql`

- [ ] **Step 1: Create migration file**

Write to `supabase/migrations/113_cash_handovers.sql`:

```sql
-- Migración 113: tabla de rendiciones de efectivo por barbero/día.
-- Persiste el estado de "quién ya rindió" para el tab Cierre del día.
-- Idempotente: usa IF NOT EXISTS en todo.

create table if not exists cash_handovers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  barber_id uuid not null references staff(id) on delete cascade,
  handover_date date not null,
  expected_amount numeric(12,2) not null,
  actual_amount numeric(12,2) not null,
  difference numeric(12,2) generated always as (actual_amount - expected_amount) stored,
  notes text,
  confirmed_by uuid not null references staff(id),
  confirmed_at timestamptz not null default now(),
  updated_by uuid references staff(id),
  updated_at timestamptz,
  constraint cash_handovers_unique_per_day unique (branch_id, barber_id, handover_date)
);

create index if not exists cash_handovers_org_date_idx
  on cash_handovers (organization_id, handover_date desc);

create index if not exists cash_handovers_branch_date_idx
  on cash_handovers (branch_id, handover_date desc);

alter table cash_handovers enable row level security;

drop policy if exists cash_handovers_select_same_org on cash_handovers;
create policy cash_handovers_select_same_org on cash_handovers
  for select using (
    organization_id in (
      select s.organization_id
      from staff s
      where s.auth_user_id = auth.uid() and s.is_active = true
    )
  );

drop policy if exists cash_handovers_write_same_org on cash_handovers;
create policy cash_handovers_write_same_org on cash_handovers
  for all using (
    organization_id in (
      select s.organization_id
      from staff s
      where s.auth_user_id = auth.uid() and s.is_active = true
    )
  )
  with check (
    organization_id in (
      select s.organization_id
      from staff s
      where s.auth_user_id = auth.uid() and s.is_active = true
    )
  );

comment on table cash_handovers is
  'Rendiciones de efectivo por barbero/día. Una fila representa la entrega de efectivo de un barbero al encargado al cierre del día. Ver src/lib/actions/caja.ts.';
comment on column cash_handovers.expected_amount is
  'Snapshot del efectivo cobrado al confirmar. No se recalcula si cambian visitas posteriormente.';
comment on column cash_handovers.difference is
  'actual_amount − expected_amount. Negativo = faltó; positivo = sobró.';
```

- [ ] **Step 2: Apply migration (local/remote)**

Run: `supabase db push`
Expected: "Applying migration 113_cash_handovers.sql… done."

Si el usuario prefiere aplicar por separado, el archivo queda listo para ejecutar manualmente en el SQL editor de Supabase.

- [ ] **Step 3: Verify schema**

Run: `supabase db lint 2>&1 | tail -20`
(O correr un query de verificación manual: `select * from cash_handovers limit 0;` para confirmar que existe.)
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/113_cash_handovers.sql
git commit -m "feat(caja): migración 113 tabla cash_handovers para rendición de efectivo"
```

---

## Task 2: Permiso `finances.reconcile_cash`

**Files:**
- Modify: `src/lib/permissions.ts`

- [ ] **Step 1: Agregar permiso en la categoría `finances`**

Abrir `src/lib/permissions.ts`. En el objeto `PERMISSION_CATEGORIES.finances.permissions`, agregar al final antes del cierre `}`:

```typescript
'finances.reconcile_cash': 'Confirmar rendición de efectivo de barberos',
```

El bloque resultante queda:

```typescript
finances: {
    label: 'Finanzas',
    permissions: {
        'finances.view_summary': 'Ver resumen financiero',
        'finances.view_expenses': 'Ver egresos (gastos variables)',
        'finances.view_fixed': 'Ver gastos fijos',
        'finances.manage_fixed': 'Gestionar gastos fijos y pagos mensuales',
        'finances.view_accounts': 'Ver cuentas de cobro',
        'finances.create_expense': 'Crear gastos',
        'finances.manage_accounts': 'Gestionar cuentas de pago',
        'finances.reconcile_cash': 'Confirmar rendición de efectivo de barberos',
    },
},
```

- [ ] **Step 2: Agregar descripción en `PERMISSION_DESCRIPTIONS`**

En el mismo archivo, en el objeto `PERMISSION_DESCRIPTIONS`, debajo de la línea `'finances.manage_accounts': ...`, agregar:

```typescript
'finances.reconcile_cash': 'Permite confirmar que un barbero rindió el efectivo cobrado al cierre del día y registrar diferencias. Owner y admin siempre lo tienen.',
```

- [ ] **Step 3: Lint + build**

Run: `npm run lint`
Expected: sin errores.

Run: `npm run build` (puede tardar; no es crítico correrlo acá si ya se va a correr más adelante — pero sí `tsc --noEmit`)
Expected: build ok o tsc sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/lib/permissions.ts
git commit -m "feat(caja): permiso finances.reconcile_cash para confirmar rendiciones"
```

---

## Task 3: Extender `fetchCajaSummary` con comparativas

**Files:**
- Modify: `src/lib/actions/caja.ts`

- [ ] **Step 1: Agregar tipo nuevo al inicio de la sección de tipos**

En `src/lib/actions/caja.ts`, debajo de la definición actual de `CajaDailySummary` (línea ~52), agregar:

```typescript
export interface CajaSummaryComparison {
  // Totales comparativos (nullables cuando no hay datos para ese período)
  yesterday: number | null          // total hasta la misma hora de corte ayer
  lastWeek: number | null           // total hasta la misma hora de corte hace 7 días
  // Por método/cuenta, para el payment split
  byMethod: {
    key: string                     // 'cash' | 'card' | 'acct:<uuid>'
    current: number
    lastWeek: number | null
  }[]
}
```

- [ ] **Step 2: Reemplazar la firma de `fetchCajaSummary` para aceptar `compareAtHour`**

Ubicar la función `fetchCajaSummary` (línea ~224). Cambiar su firma a:

```typescript
export async function fetchCajaSummary(params: {
  branchId: string | null
  date: string // YYYY-MM-DD
  compareAtHour?: number | null // 0-23; null = día completo (para días pasados)
}): Promise<{ data: CajaDailySummary; comparison: CajaSummaryComparison | null; error: string | null }> {
```

Y cambiar el retorno de error inicial (cuando no hay orgId) para que incluya `comparison: null`:

```typescript
if (!orgId) return { data: emptySummary(), comparison: null, error: 'No autorizado' }
```

Hacer lo mismo en los otros 2 returns tempranos (`No autorizado para esta sucursal` y `branchIds.length === 0`). Todos deben devolver `comparison: null`.

- [ ] **Step 3: Construir ranges comparativos**

Dentro de `fetchCajaSummary`, **después de** la línea `const { start, end } = getDayBounds(params.date, tz)` y **antes del Promise.all**, agregar:

```typescript
// Ranges comparativos: ayer y hace 7 días, con corte a la misma hora si compareAtHour viene.
const buildCompareRange = (daysAgo: number): { start: string; end: string } => {
  const base = new Date(params.date + 'T12:00:00Z')
  base.setUTCDate(base.getUTCDate() - daysAgo)
  const y = base.getUTCFullYear()
  const m = String(base.getUTCMonth() + 1).padStart(2, '0')
  const d = String(base.getUTCDate()).padStart(2, '0')
  const compDate = `${y}-${m}-${d}`
  const { start: dayStart, end: dayEnd } = getDayBounds(compDate, tz)
  if (params.compareAtHour == null) return { start: dayStart, end: dayEnd }
  // Recortar al mismo "hasta hh:59:59.999" de hoy
  const hh = String(params.compareAtHour).padStart(2, '0')
  const offset = dayStart.slice(-6) // "-03:00"
  return { start: dayStart, end: `${compDate}T${hh}:59:59.999${offset}` }
}

const yesterdayRange = buildCompareRange(1)
const lastWeekRange = buildCompareRange(7)
```

- [ ] **Step 4: Agregar queries comparativas al Promise.all**

Reemplazar el Promise.all existente (que tiene 4 queries) por uno con 6 queries (agregando yesterdayVisits y lastWeekVisits):

```typescript
const [
  { data: visits },
  { data: transferLogs },
  { data: cashExpenses },
  { data: accounts },
  { data: yesterdayVisits },
  { data: lastWeekVisits },
] = await Promise.all([
  supabase
    .from('visits')
    .select('amount, payment_method, payment_account_id')
    .in('branch_id', branchIds)
    .gte('completed_at', start)
    .lte('completed_at', end),
  supabase
    .from('transfer_logs')
    .select('amount, payment_account_id, payment_account:payment_accounts(name)')
    .in('branch_id', branchIds)
    .gte('transferred_at', start)
    .lte('transferred_at', end),
  supabase
    .from('expense_tickets')
    .select('amount')
    .in('branch_id', branchIds)
    .is('payment_account_id', null)
    .gte('expense_date', params.date)
    .lte('expense_date', params.date),
  supabase
    .from('payment_accounts')
    .select('id, name')
    .in('branch_id', branchIds)
    .eq('is_active', true)
    .order('sort_order'),
  supabase
    .from('visits')
    .select('amount, payment_method, payment_account_id')
    .in('branch_id', branchIds)
    .gte('completed_at', yesterdayRange.start)
    .lte('completed_at', yesterdayRange.end),
  supabase
    .from('visits')
    .select('amount, payment_method, payment_account_id')
    .in('branch_id', branchIds)
    .gte('completed_at', lastWeekRange.start)
    .lte('completed_at', lastWeekRange.end),
])
```

Nota: la query original pide `amount, payment_method` sin `payment_account_id`. Agregar `payment_account_id` es necesario para el byMethod comparativo.

- [ ] **Step 5: Calcular comparativas**

Al final de la función, antes del `return`, reemplazar el bloque de return para incluir `comparison`:

```typescript
// Totales comparativos
const sumAmounts = (arr: typeof visits) =>
  (arr ?? []).reduce((s, v) => s + Number(v.amount), 0)

const byMethodMap = new Map<string, { current: number; lastWeek: number | null }>()
const keyOf = (v: { payment_method: string; payment_account_id: string | null }) => {
  if (v.payment_method === 'transfer' && v.payment_account_id) {
    return `acct:${v.payment_account_id}`
  }
  return v.payment_method // 'cash' | 'card' | 'transfer' (sin account_id, raro)
}
for (const v of visits ?? []) {
  const k = keyOf(v)
  const existing = byMethodMap.get(k) ?? { current: 0, lastWeek: null }
  existing.current += Number(v.amount)
  byMethodMap.set(k, existing)
}
for (const v of lastWeekVisits ?? []) {
  const k = keyOf(v)
  const existing = byMethodMap.get(k) ?? { current: 0, lastWeek: null }
  existing.lastWeek = (existing.lastWeek ?? 0) + Number(v.amount)
  byMethodMap.set(k, existing)
}

const comparison: CajaSummaryComparison = {
  yesterday: yesterdayVisits ? sumAmounts(yesterdayVisits) : null,
  lastWeek: lastWeekVisits ? sumAmounts(lastWeekVisits) : null,
  byMethod: Array.from(byMethodMap.entries()).map(([key, v]) => ({
    key,
    current: v.current,
    lastWeek: v.lastWeek,
  })),
}

return {
  data: {
    totalCash,
    totalCard,
    totalTransfer,
    accounts: Array.from(accountTotals.entries()).map(([id, v]) => ({
      accountId: id,
      accountName: v.name,
      total: v.total,
    })),
    totalRevenue: totalCash + totalCard + totalTransfer,
    ticketCount,
    cashExpenses: cashExp,
  },
  comparison,
  error: null,
}
```

- [ ] **Step 6: Actualizar `emptySummary` y callers**

En `page.tsx` (server component) ajustar la destructuración:

```typescript
const [
  { data: tickets },
  { data: summary, comparison },
  ...
```

Buscar con `grep -rn "fetchCajaSummary" src/` las otras llamadas. Solo `page.tsx` y `caja-client.tsx` la llaman. Actualizar ambas.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: sin errores en `caja.ts` ni en los callers actualizados.

- [ ] **Step 8: Commit**

```bash
git add src/lib/actions/caja.ts src/app/dashboard/caja/page.tsx src/app/dashboard/caja/caja-client.tsx
git commit -m "feat(caja): agregar comparativas vs ayer/semana pasada a fetchCajaSummary"
```

---

## Task 4: Extender `fetchCajaTickets` con rango + paginación + búsqueda

**Files:**
- Modify: `src/lib/actions/caja.ts`

- [ ] **Step 1: Cambiar firma de la función**

Ubicar `fetchCajaTickets` (línea ~79). Cambiar su firma para soportar rangos opcionales:

```typescript
export async function fetchCajaTickets(params: {
  branchId: string | null
  date?: string                   // backward-compat: si no vienen startDate/endDate
  startDate?: string              // YYYY-MM-DD (inclusive)
  endDate?: string                // YYYY-MM-DD (inclusive)
  barberId?: string | null
  paymentMethod?: string | null
  paymentAccountId?: string | null
  search?: string | null          // filtra por cliente (ilike) o monto (eq numérico)
  limit?: number                  // default 500
  offset?: number                 // default 0
}): Promise<{ data: CajaTicket[]; total: number; error: string | null }>
```

- [ ] **Step 2: Normalizar startDate/endDate dentro de la función**

Al inicio del cuerpo, después de los checks de auth:

```typescript
const startDate = params.startDate ?? params.date
const endDate = params.endDate ?? params.date
if (!startDate || !endDate) {
  return { data: [], total: 0, error: 'Fecha requerida' }
}
```

Reemplazar `getDayBounds(params.date, tz)` por:

```typescript
const { start } = getDayBounds(startDate, tz)
const { end } = getDayBounds(endDate, tz)
```

- [ ] **Step 3: Agregar count y paginación al query base**

Modificar el `.select(...)` para incluir count exact:

```typescript
let query = supabase
  .from('visits')
  .select(`
    id, completed_at, amount, payment_method, payment_account_id,
    barber_id, client_id, service_id, extra_services,
    client:clients!inner(id, name, phone),
    barber:staff!inner(full_name),
    service:services(name, price),
    payment_account:payment_accounts(name)
  `, { count: 'exact' })
  .in('branch_id', branchIds)
  .gte('completed_at', start)
  .lte('completed_at', end)
  .order('completed_at', { ascending: false })
```

Más abajo, **después** de aplicar los filtros existentes (barberId, paymentMethod, paymentAccountId), agregar:

```typescript
// Búsqueda: matchea cliente (ilike) o monto exacto si parsea como número
if (params.search && params.search.trim()) {
  const q = params.search.trim()
  const asNumber = Number(q.replace(/[.,]/g, ''))
  if (!Number.isNaN(asNumber) && asNumber > 0) {
    // Resolver como OR: client name ilike o amount eq
    // Supabase .or() con fk requires foreignTable config
    const { data: matchingClients } = await supabase
      .from('clients')
      .select('id')
      .ilike('name', `%${q}%`)
    const clientIds = (matchingClients ?? []).map(c => c.id)
    if (clientIds.length > 0) {
      query = query.or(`client_id.in.(${clientIds.join(',')}),amount.eq.${asNumber}`)
    } else {
      query = query.eq('amount', asNumber)
    }
  } else {
    const { data: matchingClients } = await supabase
      .from('clients')
      .select('id')
      .ilike('name', `%${q}%`)
    const clientIds = (matchingClients ?? []).map(c => c.id)
    if (clientIds.length === 0) return { data: [], total: 0, error: null }
    query = query.in('client_id', clientIds)
  }
}

// Paginación
const limit = params.limit ?? 500
const offset = params.offset ?? 0
query = query.range(offset, offset + limit - 1)
```

- [ ] **Step 4: Devolver `total` del count**

Cambiar la destructuración del execute del query a:

```typescript
const { data: visits, count, error } = await query
if (error) return { data: [], total: 0, error: error.message }
if (!visits || visits.length === 0) return { data: [], total: count ?? 0, error: null }
```

Y el return final:

```typescript
return { data: tickets, total: count ?? tickets.length, error: null }
```

- [ ] **Step 5: Actualizar callers**

Buscar con `grep -rn "fetchCajaTickets" src/`. Encontrarás `page.tsx` y `caja-client.tsx`. Ambos usan `date: today`, lo cual sigue funcionando por backward compat. La destructuración existente `{ data: tickets }` sigue siendo válida (total es un campo extra que pueden ignorar por ahora).

- [ ] **Step 6: Lint**

Run: `npm run lint`

- [ ] **Step 7: Commit**

```bash
git add src/lib/actions/caja.ts
git commit -m "feat(caja): fetchCajaTickets soporta rango + paginación + búsqueda"
```

---

## Task 5: Server action `fetchCashHandoverStatus`

**Files:**
- Modify: `src/lib/actions/caja.ts`

- [ ] **Step 1: Agregar tipo en la sección de tipos**

En `src/lib/actions/caja.ts`, en la sección de tipos del inicio:

```typescript
export interface CashHandoverStatus {
  barberId: string
  barberName: string
  expectedCash: number
  cashTicketCount: number
  handover: {
    id: string
    actualAmount: number
    difference: number
    notes: string | null
    confirmedBy: { id: string; name: string }
    confirmedAt: string
    updatedAt: string | null
  } | null
}
```

- [ ] **Step 2: Implementar la función al final de `caja.ts`**

Agregar al final del archivo (después de `fetchCajaCSVData`):

```typescript
// ─── fetchCashHandoverStatus ──────────────────────────────────────────────────

export async function fetchCashHandoverStatus(params: {
  branchId: string
  date: string // YYYY-MM-DD
}): Promise<{ data: CashHandoverStatus[]; error: string | null }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: [], error: 'No autorizado' }

  const orgBranchIds = await getScopedBranchIds()
  if (!orgBranchIds.includes(params.branchId)) {
    return { data: [], error: 'No autorizado para esta sucursal' }
  }

  const tz = await getActiveTimezone()
  const supabase = createAdminClient()
  const { start, end } = getDayBounds(params.date, tz)

  // 1) Sumar efectivo por barbero en el día
  const { data: cashVisits, error: vErr } = await supabase
    .from('visits')
    .select('barber_id, amount, barber:staff!inner(full_name)')
    .eq('branch_id', params.branchId)
    .eq('payment_method', 'cash')
    .gte('completed_at', start)
    .lte('completed_at', end)
  if (vErr) return { data: [], error: vErr.message }

  const aggByBarber = new Map<string, { name: string; cash: number; count: number }>()
  for (const v of cashVisits ?? []) {
    const barber = v.barber as unknown as { full_name: string }
    const existing = aggByBarber.get(v.barber_id) ?? { name: barber.full_name, cash: 0, count: 0 }
    existing.cash += Number(v.amount)
    existing.count += 1
    aggByBarber.set(v.barber_id, existing)
  }

  if (aggByBarber.size === 0) return { data: [], error: null }

  // 2) Traer handovers ya existentes para ese día
  const { data: handovers } = await supabase
    .from('cash_handovers')
    .select(`
      id, barber_id, actual_amount, difference, notes,
      confirmed_by, confirmed_at, updated_at,
      confirmed_staff:staff!cash_handovers_confirmed_by_fkey(id, full_name)
    `)
    .eq('branch_id', params.branchId)
    .eq('handover_date', params.date)

  const handoverMap = new Map<string, NonNullable<CashHandoverStatus['handover']>>()
  for (const h of handovers ?? []) {
    const confirmedStaff = h.confirmed_staff as unknown as { id: string; full_name: string } | null
    handoverMap.set(h.barber_id, {
      id: h.id,
      actualAmount: Number(h.actual_amount),
      difference: Number(h.difference),
      notes: h.notes,
      confirmedBy: {
        id: confirmedStaff?.id ?? h.confirmed_by,
        name: confirmedStaff?.full_name ?? '—',
      },
      confirmedAt: h.confirmed_at,
      updatedAt: h.updated_at,
    })
  }

  // 3) Construir resultado
  const result: CashHandoverStatus[] = Array.from(aggByBarber.entries())
    .map(([barberId, agg]) => ({
      barberId,
      barberName: agg.name,
      expectedCash: agg.cash,
      cashTicketCount: agg.count,
      handover: handoverMap.get(barberId) ?? null,
    }))
    .sort((a, b) => b.expectedCash - a.expectedCash)

  return { data: result, error: null }
}
```

- [ ] **Step 3: Lint**

Run: `npm run lint`

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/caja.ts
git commit -m "feat(caja): fetchCashHandoverStatus server action"
```

---

## Task 6: Server action `confirmCashHandover`

**Files:**
- Modify: `src/lib/actions/caja.ts`

- [ ] **Step 1: Agregar helper para resolver staff actual**

En `src/lib/actions/caja.ts`, al inicio del archivo después de los imports, agregar:

```typescript
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

async function getCurrentStaffId(): Promise<{ staffId: string | null; isOwnerAdmin: boolean; permissions: Record<string, boolean> }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { staffId: null, isOwnerAdmin: false, permissions: {} }

  const admin = createAdminClient()
  const { data: staff } = await admin
    .from('staff')
    .select('id, role, role_id, role:roles(permissions)')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()
  if (!staff) return { staffId: null, isOwnerAdmin: false, permissions: {} }

  const isOwnerAdmin = staff.role === 'owner' || staff.role === 'admin'
  const role = staff.role as unknown as { permissions: Record<string, boolean> | null } | null
  return {
    staffId: staff.id,
    isOwnerAdmin,
    permissions: role?.permissions ?? {},
  }
}
```

Nota: `createClient` (no admin) es necesario para `auth.getUser()`. Si el import ya está, no duplicar.

- [ ] **Step 2: Implementar `confirmCashHandover`**

Al final de `caja.ts`, agregar:

```typescript
// ─── confirmCashHandover ──────────────────────────────────────────────────────

export async function confirmCashHandover(params: {
  branchId: string
  barberId: string
  date: string
  actualAmount: number
  notes: string | null
}): Promise<{ ok: boolean; error: string | null }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { ok: false, error: 'No autorizado' }

  const orgBranchIds = await getScopedBranchIds()
  if (!orgBranchIds.includes(params.branchId)) {
    return { ok: false, error: 'No autorizado para esta sucursal' }
  }

  const { staffId, isOwnerAdmin, permissions } = await getCurrentStaffId()
  if (!staffId) return { ok: false, error: 'Sesión inválida' }
  if (!isOwnerAdmin && !permissions['finances.reconcile_cash']) {
    return { ok: false, error: 'Permiso insuficiente' }
  }

  if (!Number.isFinite(params.actualAmount) || params.actualAmount < 0) {
    return { ok: false, error: 'Monto inválido' }
  }

  const tz = await getActiveTimezone()
  const supabase = createAdminClient()
  const { start, end } = getDayBounds(params.date, tz)

  // Calcular expected en el server (no confiar en cliente)
  const { data: cashVisits, error: vErr } = await supabase
    .from('visits')
    .select('amount')
    .eq('branch_id', params.branchId)
    .eq('barber_id', params.barberId)
    .eq('payment_method', 'cash')
    .gte('completed_at', start)
    .lte('completed_at', end)
  if (vErr) return { ok: false, error: vErr.message }
  const expectedAmount = (cashVisits ?? []).reduce((s, v) => s + Number(v.amount), 0)

  const diff = Math.abs(params.actualAmount - expectedAmount)
  const hasDiff = diff > 0.009 // tolerancia centavos
  const trimmedNotes = (params.notes ?? '').trim() || null
  if (hasDiff && !trimmedNotes) {
    return { ok: false, error: 'Nota requerida cuando hay diferencia' }
  }

  // Ver si ya existe handover
  const { data: existing } = await supabase
    .from('cash_handovers')
    .select('id')
    .eq('branch_id', params.branchId)
    .eq('barber_id', params.barberId)
    .eq('handover_date', params.date)
    .maybeSingle()

  const row = {
    organization_id: orgId,
    branch_id: params.branchId,
    barber_id: params.barberId,
    handover_date: params.date,
    expected_amount: expectedAmount,
    actual_amount: params.actualAmount,
    notes: trimmedNotes,
  }

  if (existing) {
    // Update: preserva confirmed_by/at originales
    const { error } = await supabase
      .from('cash_handovers')
      .update({
        ...row,
        updated_by: staffId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await supabase
      .from('cash_handovers')
      .insert({
        ...row,
        confirmed_by: staffId,
        confirmed_at: new Date().toISOString(),
      })
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/dashboard/caja')
  return { ok: true, error: null }
}
```

- [ ] **Step 3: Lint**

Run: `npm run lint`

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/caja.ts
git commit -m "feat(caja): confirmCashHandover server action"
```

---

## Task 7: Server action `revertCashHandover`

**Files:**
- Modify: `src/lib/actions/caja.ts`

- [ ] **Step 1: Implementar al final de `caja.ts`**

```typescript
// ─── revertCashHandover ───────────────────────────────────────────────────────

export async function revertCashHandover(params: {
  handoverId: string
}): Promise<{ ok: boolean; error: string | null }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { ok: false, error: 'No autorizado' }

  const { staffId, isOwnerAdmin } = await getCurrentStaffId()
  if (!staffId) return { ok: false, error: 'Sesión inválida' }
  if (!isOwnerAdmin) return { ok: false, error: 'Solo owner/admin pueden revertir' }

  const supabase = createAdminClient()

  // Verificar que el handover pertenece a la org actual
  const { data: handover } = await supabase
    .from('cash_handovers')
    .select('id, organization_id')
    .eq('id', params.handoverId)
    .maybeSingle()

  if (!handover) return { ok: false, error: 'Rendición no encontrada' }
  if (handover.organization_id !== orgId) return { ok: false, error: 'No autorizado' }

  const { error } = await supabase
    .from('cash_handovers')
    .delete()
    .eq('id', params.handoverId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/dashboard/caja')
  return { ok: true, error: null }
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/caja.ts
git commit -m "feat(caja): revertCashHandover server action (owner/admin)"
```

---

## Task 8: Componente `LiveIndicator`

**Files:**
- Create: `src/app/dashboard/caja/components/live-indicator.tsx`

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LiveIndicatorProps {
  isLive: boolean              // false oculta el indicador
  lastUpdatedAt: number        // Date.now() del último refresh
  onManualRefresh: () => void
  isRefreshing: boolean
}

export function LiveIndicator({ isLive, lastUpdatedAt, onManualRefresh, isRefreshing }: LiveIndicatorProps) {
  const [, force] = useState(0)

  // Re-render cada 5s para actualizar el "hace Xs"
  useEffect(() => {
    if (!isLive) return
    const id = setInterval(() => force(v => v + 1), 5_000)
    return () => clearInterval(id)
  }, [isLive])

  if (!isLive) return null

  const elapsed = Math.floor((Date.now() - lastUpdatedAt) / 1000)
  const relative = elapsed < 5 ? 'ahora' : elapsed < 60 ? `hace ${elapsed}s` : `hace ${Math.floor(elapsed / 60)}m`

  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        en vivo · actualizado {relative}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={onManualRefresh}
        disabled={isRefreshing}
        aria-label="Refrescar ahora"
      >
        <RefreshCw className={`size-3 ${isRefreshing ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Lint + build**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/components/live-indicator.tsx
git commit -m "feat(caja): componente LiveIndicator con ping + refresh manual"
```

---

## Task 9: Componente `FilterBar`

**Files:**
- Create: `src/app/dashboard/caja/components/filter-bar.tsx`

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

import { Search, User, DollarSign, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  SelectGroup, SelectLabel, SelectSeparator,
} from '@/components/ui/select'

export interface BarberOption { id: string; name: string }
export interface AccountOption { id: string; name: string; isSalaryAccount?: boolean }

interface FilterBarProps {
  search: string
  onSearchChange: (v: string) => void
  searchPlaceholder?: string

  barberId: string // 'all' | uuid
  onBarberChange: (id: string) => void
  barbers: BarberOption[]

  payment: string // 'all' | 'cash' | 'card' | 'salary_accounts' | 'acct:<uuid>'
  onPaymentChange: (v: string) => void
  accounts: AccountOption[]

  sticky?: boolean
}

export function FilterBar({
  search, onSearchChange, searchPlaceholder = 'Buscar cliente o monto...',
  barberId, onBarberChange, barbers,
  payment, onPaymentChange, accounts,
  sticky = false,
}: FilterBarProps) {
  const hasActive = barberId !== 'all' || payment !== 'all' || search.trim().length > 0
  const hasSalary = accounts.some(a => a.isSalaryAccount)

  return (
    <div className={`${sticky ? 'sticky top-0 z-10 bg-background/95 backdrop-blur' : ''} flex flex-col gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="pl-8 h-9 text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={barberId} onValueChange={onBarberChange}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <User className="size-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="Todos los barberos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los barberos</SelectItem>
            {barbers.map(b => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={payment} onValueChange={onPaymentChange}>
          <SelectTrigger className="w-[200px] h-8 text-xs">
            <DollarSign className="size-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="Todos los pagos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los pagos</SelectItem>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel className="text-[10px]">Directo</SelectLabel>
              <SelectItem value="cash">Efectivo</SelectItem>
              <SelectItem value="card">Tarjeta</SelectItem>
            </SelectGroup>
            {accounts.length > 0 && (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel className="text-[10px]">Cuentas (transfer)</SelectLabel>
                  {accounts.map(a => (
                    <SelectItem key={a.id} value={`acct:${a.id}`}>
                      {a.name}{a.isSalaryAccount ? ' · Sueldos' : ''}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            )}
            {hasSalary && (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel className="text-[10px]">Grupos</SelectLabel>
                  <SelectItem value="salary_accounts">Todas las cuentas de sueldos</SelectItem>
                </SelectGroup>
              </>
            )}
          </SelectContent>
        </Select>

        {hasActive && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs px-2 gap-1"
            onClick={() => { onSearchChange(''); onBarberChange('all'); onPaymentChange('all') }}
          >
            <X className="size-3" />
            Limpiar
          </Button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/components/filter-bar.tsx
git commit -m "feat(caja): componente FilterBar con búsqueda + dropdowns reorganizados"
```

---

## Task 10: Componente `TicketRow`

**Files:**
- Create: `src/app/dashboard/caja/components/ticket-row.tsx`

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

import Link from 'next/link'
import {
  ChevronDown, ChevronRight, Scissors, Package, MessageSquare,
  Banknote, CreditCard, ArrowRightLeft,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { formatCurrency } from '@/lib/format'
import type { CajaTicket } from '@/lib/actions/caja'

interface TicketRowProps {
  ticket: CajaTicket
  isExpanded: boolean
  onToggle: () => void
}

function paymentBadge(method: string, accountName: string | null) {
  switch (method) {
    case 'cash':
      return <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><Banknote className="size-3" />Efectivo</Badge>
    case 'card':
      return <Badge variant="outline" className="gap-1 border-blue-500/30 bg-blue-500/10 text-blue-400"><CreditCard className="size-3" />Tarjeta</Badge>
    case 'transfer':
      return <Badge variant="outline" className="gap-1 border-violet-500/30 bg-violet-500/10 text-violet-400"><ArrowRightLeft className="size-3" />{accountName ?? 'Transferencia'}</Badge>
    default:
      return <Badge variant="outline">{method}</Badge>
  }
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export function TicketRow({ ticket, isExpanded, onToggle }: TicketRowProps) {
  const hasDetails = ticket.services.length > 0 || ticket.products.length > 0

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 overflow-hidden transition-colors hover:border-zinc-700/80">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
          {isExpanded ? <ChevronDown className="size-4 text-zinc-400" /> : <ChevronRight className="size-4 text-zinc-400" />}
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_1fr_auto] items-center gap-x-3 gap-y-0.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100 truncate">{ticket.clientName}</p>
            <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
              <Scissors className="size-3 inline shrink-0" />
              {ticket.barberName}
              <span className="mx-1 opacity-50">·</span>
              {formatTime(ticket.completedAt)}
            </p>
          </div>

          <div className="hidden sm:flex items-center">
            {paymentBadge(ticket.paymentMethod, ticket.paymentAccountName)}
          </div>

          <div className="text-right">
            <p className="text-sm font-bold text-zinc-100">{formatCurrency(ticket.amount)}</p>
            <div className="sm:hidden mt-0.5">
              {paymentBadge(ticket.paymentMethod, ticket.paymentAccountName)}
            </div>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-zinc-800/60 px-4 py-3 space-y-3 bg-zinc-950/40">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/mensajeria?clientId=${ticket.clientId}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 text-green-400 text-xs px-2.5 py-1 transition-colors"
            >
              <MessageSquare className="size-3.5" />
              Contactar cliente
            </Link>
            {ticket.clientPhone && (
              <span className="text-[11px] text-muted-foreground">{ticket.clientPhone}</span>
            )}
          </div>

          {hasDetails && (
            <>
              {ticket.services.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Servicios</p>
                  {ticket.services.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-0.5">
                      <span className="flex items-center gap-1.5 text-zinc-300">
                        <Scissors className="size-3 text-zinc-500" />
                        {s.name}
                      </span>
                      <span className="text-zinc-400">{formatCurrency(s.price)}</span>
                    </div>
                  ))}
                </div>
              )}
              {ticket.products.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Productos</p>
                  {ticket.products.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-0.5">
                      <span className="flex items-center gap-1.5 text-zinc-300">
                        <Package className="size-3 text-zinc-500" />
                        {p.name} {p.quantity > 1 && <span className="text-zinc-500">x{p.quantity}</span>}
                      </span>
                      <span className="text-zinc-400">{formatCurrency(p.unitPrice * p.quantity)}</span>
                    </div>
                  ))}
                </div>
              )}
              <Separator className="bg-zinc-800/60" />
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-zinc-400">Total</span>
                <span className="text-zinc-100">{formatCurrency(ticket.amount)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/components/ticket-row.tsx
git commit -m "feat(caja): componente TicketRow extraído del monolito"
```

---

## Task 11: Componente `TicketList` con agrupación

**Files:**
- Create: `src/app/dashboard/caja/components/ticket-list.tsx`

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

import { useMemo, useState } from 'react'
import { Receipt } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { TicketRow } from './ticket-row'
import type { CajaTicket } from '@/lib/actions/caja'

interface TicketListProps {
  tickets: CajaTicket[]
  groupBy: 'hour' | 'day'
  emptyMessage?: string
  showFilteredFooter?: boolean
  totalUnfiltered?: number
}

function hourKey(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getHours()).padStart(2, '0')}:00`
}

function dayKey(dateStr: string) {
  return new Date(dateStr).toISOString().slice(0, 10)
}

function dayLabel(iso: string) {
  const d = new Date(iso + 'T12:00:00Z')
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'short', day: '2-digit', month: 'short',
  }).format(d)
}

export function TicketList({
  tickets,
  groupBy,
  emptyMessage = 'No hay tickets',
  showFilteredFooter = false,
  totalUnfiltered,
}: TicketListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; items: CajaTicket[]; total: number }>()
    for (const t of tickets) {
      const k = groupBy === 'hour' ? hourKey(t.completedAt) : dayKey(t.completedAt)
      const existing = map.get(k) ?? { key: k, items: [], total: 0 }
      existing.items.push(t)
      existing.total += t.amount
      map.set(k, existing)
    }
    const arr = Array.from(map.values())
    // Orden: hour asc dentro del día (los headers se leen bien); day desc para historial
    arr.sort((a, b) => groupBy === 'hour' ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key))
    return arr
  }, [tickets, groupBy])

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-2">
        <Receipt className="size-10 opacity-20" />
        {emptyMessage}
      </div>
    )
  }

  const totalAmount = tickets.reduce((s, t) => s + t.amount, 0)

  return (
    <div className="space-y-4">
      {groups.map(g => (
        <div key={g.key} className="space-y-1.5">
          <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
            <div className="h-px flex-1 bg-zinc-800/60" />
            <span className="font-medium text-zinc-400">
              {groupBy === 'hour' ? g.key : dayLabel(g.key)}
            </span>
            <span>· {g.items.length} {g.items.length === 1 ? 'ticket' : 'tickets'}</span>
            <span>· {formatCurrency(g.total)}</span>
            <div className="h-px flex-1 bg-zinc-800/60" />
          </div>
          {g.items.map(t => (
            <TicketRow
              key={t.visitId}
              ticket={t}
              isExpanded={expanded.has(t.visitId)}
              onToggle={() => toggle(t.visitId)}
            />
          ))}
        </div>
      ))}

      {showFilteredFooter && typeof totalUnfiltered === 'number' && totalUnfiltered !== tickets.length && (
        <div className="sticky bottom-0 flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-900/95 backdrop-blur px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            Mostrando {tickets.length} de {totalUnfiltered} tickets
          </span>
          <span className="font-semibold text-zinc-100">{formatCurrency(totalAmount)}</span>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/components/ticket-list.tsx
git commit -m "feat(caja): componente TicketList con agrupación por hora/día"
```

---

## Task 12: Componente `HeroCard` (Tab Hoy)

**Files:**
- Create: `src/app/dashboard/caja/components/hero-card.tsx`

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { formatCurrency } from '@/lib/format'

interface HeroCardProps {
  totalRevenue: number
  ticketCount: number
  comparison: {
    yesterday: number | null
    lastWeek: number | null
  }
  date: string // YYYY-MM-DD — para el label "viernes pasado" vs "ayer"
  isToday: boolean
}

function weekdayNameEs(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const names = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  return names[d.getUTCDay()]
}

interface DeltaProps { current: number; previous: number | null; label: string }

function Delta({ current, previous, label }: DeltaProps) {
  if (previous == null) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Minus className="size-3.5" />
        <span>{label}: sin datos</span>
      </div>
    )
  }
  const diff = current - previous
  const pct = previous === 0 ? (current === 0 ? 0 : 100) : Math.round((diff / previous) * 100)
  const up = diff > 0
  const down = diff < 0
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus
  const color = up ? 'text-emerald-400' : down ? 'text-rose-400' : 'text-zinc-400'
  const sign = diff > 0 ? '+' : ''
  return (
    <div className={`flex items-center gap-1.5 text-xs ${color}`}>
      <Icon className="size-3.5 shrink-0" />
      <span>{sign}{pct}% {label} ({sign}{formatCurrency(diff)})</span>
    </div>
  )
}

export function HeroCard({ totalRevenue, ticketCount, comparison, date, isToday }: HeroCardProps) {
  const lastWeekLabel = isToday
    ? `vs ${weekdayNameEs(date)} pasado`
    : `vs hace 7 días`
  const yesterdayLabel = isToday ? 'vs ayer' : 'vs día anterior'

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900/80 to-zinc-950/60 p-5 lg:p-6 shadow-lg">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <p className="text-4xl lg:text-5xl font-bold text-zinc-50 tracking-tight">
            {formatCurrency(totalRevenue)}
          </p>
          <div className="space-y-1.5">
            <Delta current={totalRevenue} previous={comparison.lastWeek} label={lastWeekLabel} />
            <Delta current={totalRevenue} previous={comparison.yesterday} label={yesterdayLabel} />
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-zinc-100">{ticketCount}</p>
          <p className="text-xs text-muted-foreground">{ticketCount === 1 ? 'ticket' : 'tickets'}</p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/components/hero-card.tsx
git commit -m "feat(caja): HeroCard con comparativas vs semana pasada y vs ayer"
```

---

## Task 13: Componente `PaymentSplit`

**Files:**
- Create: `src/app/dashboard/caja/components/payment-split.tsx`

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

import { Banknote, CreditCard, ArrowRightLeft, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import type { CajaDailySummary, CajaSummaryComparison } from '@/lib/actions/caja'

interface PaymentSplitProps {
  summary: CajaDailySummary
  comparison: CajaSummaryComparison | null
  onMethodClick?: (key: string) => void
}

interface Row {
  key: string               // 'cash' | 'card' | 'acct:<uuid>'
  label: string
  amount: number
  icon: React.ReactNode
  color: string             // clase tailwind del icono / barra
}

function deltaPct(current: number, prev: number | null): { pct: number; icon: 'up' | 'down' | 'flat'; hasData: boolean } {
  if (prev == null) return { pct: 0, icon: 'flat', hasData: false }
  if (prev === 0 && current === 0) return { pct: 0, icon: 'flat', hasData: true }
  if (prev === 0) return { pct: 100, icon: 'up', hasData: true }
  const pct = Math.round(((current - prev) / prev) * 100)
  return { pct, icon: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat', hasData: true }
}

export function PaymentSplit({ summary, comparison, onMethodClick }: PaymentSplitProps) {
  const rows: Row[] = []

  if (summary.totalCash > 0) {
    rows.push({
      key: 'cash', label: 'Efectivo', amount: summary.totalCash,
      icon: <Banknote className="size-4" />, color: 'emerald',
    })
  }
  if (summary.totalCard > 0) {
    rows.push({
      key: 'card', label: 'Tarjeta', amount: summary.totalCard,
      icon: <CreditCard className="size-4" />, color: 'blue',
    })
  }
  for (const acc of summary.accounts) {
    if (acc.total > 0) {
      rows.push({
        key: `acct:${acc.accountId}`, label: acc.accountName, amount: acc.total,
        icon: <ArrowRightLeft className="size-4" />, color: 'violet',
      })
    }
  }

  rows.sort((a, b) => b.amount - a.amount)
  const total = rows.reduce((s, r) => s + r.amount, 0)

  const compMap = new Map(comparison?.byMethod.map(b => [b.key, b]) ?? [])

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 text-sm text-muted-foreground text-center">
        Sin cobros todavía
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-zinc-200">Por medio de pago</h3>

      <div className="space-y-2.5">
        {rows.map(row => {
          const pctOfTotal = total > 0 ? Math.round((row.amount / total) * 100) : 0
          const comp = compMap.get(row.key)
          const delta = deltaPct(row.amount, comp?.lastWeek ?? null)
          const DeltaIcon = delta.icon === 'up' ? TrendingUp : delta.icon === 'down' ? TrendingDown : Minus
          const deltaColor = !delta.hasData
            ? 'text-zinc-500'
            : delta.icon === 'up' ? 'text-emerald-400'
            : delta.icon === 'down' ? 'text-rose-400'
            : 'text-zinc-400'

          const isCash = row.key === 'cash'
          const hasExpenses = isCash && summary.cashExpenses > 0

          return (
            <button
              key={row.key}
              type="button"
              onClick={() => onMethodClick?.(row.key)}
              className="w-full group flex flex-col gap-1 rounded-lg border border-transparent hover:border-zinc-700 hover:bg-zinc-900 px-2 py-1.5 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-md bg-${row.color}-500/15 text-${row.color}-400`}>
                  {row.icon}
                </span>
                <span className="text-sm font-medium text-zinc-100 truncate flex-1">{row.label}</span>
                <span className="text-sm font-semibold text-zinc-100">{formatCurrency(row.amount)}</span>
                <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{pctOfTotal}%</span>
              </div>
              <div className="flex items-center gap-2 pl-9">
                <div className="relative h-1.5 flex-1 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full bg-${row.color}-500/80`}
                    style={{ width: `${pctOfTotal}%` }}
                  />
                </div>
                <span className={`flex items-center gap-1 text-[11px] ${deltaColor} w-20 justify-end`}>
                  <DeltaIcon className="size-3" />
                  {delta.hasData ? `${delta.pct > 0 ? '+' : ''}${delta.pct}%` : 'sin datos'}
                </span>
              </div>
              {hasExpenses && (
                <div className="pl-9 text-[11px] text-rose-400/80">
                  − {formatCurrency(summary.cashExpenses)} egresos
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/components/payment-split.tsx
git commit -m "feat(caja): PaymentSplit con barras + tendencia + egresos visibles"
```

---

## Task 14: Componente `DateRangePickerCompact`

**Files:**
- Create: `src/app/dashboard/caja/components/date-range-picker-compact.tsx`

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

import { useState } from 'react'
import { Calendar as CalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover'

export interface DateRange { start: string; end: string }

interface DateRangePickerCompactProps {
  value: DateRange
  onChange: (v: DateRange) => void
  shortcuts?: Array<{ label: string; rangeFn: () => DateRange }>
}

function shortLabel(start: string, end: string): string {
  if (start === end) {
    return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' })
      .format(new Date(start + 'T12:00:00Z'))
  }
  const fmt = (d: string) => new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' })
    .format(new Date(d + 'T12:00:00Z'))
  return `${fmt(start)} — ${fmt(end)}`
}

export function DateRangePickerCompact({ value, onChange, shortcuts = [] }: DateRangePickerCompactProps) {
  const [open, setOpen] = useState(false)
  const [draftStart, setDraftStart] = useState(value.start)
  const [draftEnd, setDraftEnd] = useState(value.end)

  const apply = () => {
    const s = draftStart > draftEnd ? draftEnd : draftStart
    const e = draftStart > draftEnd ? draftStart : draftEnd
    onChange({ start: s, end: e })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={(o) => {
      setOpen(o)
      if (o) { setDraftStart(value.start); setDraftEnd(value.end) }
    }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <CalIcon className="size-3.5" />
          {shortLabel(value.start, value.end)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Desde</Label>
            <Input type="date" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hasta</Label>
            <Input type="date" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} className="h-8 text-sm" />
          </div>
        </div>
        {shortcuts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {shortcuts.map((s, i) => (
              <Button key={i} variant="ghost" size="sm" className="h-7 text-[11px]"
                onClick={() => { const r = s.rangeFn(); setDraftStart(r.start); setDraftEnd(r.end); onChange(r); setOpen(false) }}>
                {s.label}
              </Button>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button size="sm" onClick={apply}>Aplicar</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/components/date-range-picker-compact.tsx
git commit -m "feat(caja): DateRangePickerCompact con shortcuts"
```

---

## Task 15: Componente `ExportDialog` (extraído y simplificado)

**Files:**
- Create: `src/app/dashboard/caja/components/export-dialog.tsx`

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

import { useEffect, useState, useMemo } from 'react'
import { Download, FileSpreadsheet, Loader2, User, DollarSign, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { fetchCajaCSVData, type CajaCSVRow } from '@/lib/actions/caja'

interface AccountRef { id: string; name: string; isSalaryAccount?: boolean }
interface BarberRef { id: string; name: string }

interface ExportDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  branchId: string | null
  initialStart: string
  initialEnd: string
  filterBarber: string // 'all' | uuid
  filterPayment: string
  barbers: BarberRef[]
  accounts: AccountRef[]
}

function csvFromRows(headers: string[], rows: (string | number)[][]): string {
  return [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n')
}

function safeFilePart(s: string) {
  return s.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'archivo'
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ExportDialog({
  open, onOpenChange, branchId,
  initialStart, initialEnd,
  filterBarber, filterPayment,
  barbers, accounts,
}: ExportDialogProps) {
  const [startDate, setStartDate] = useState(initialStart)
  const [endDate, setEndDate] = useState(initialEnd)
  const [splitPerBarber, setSplitPerBarber] = useState(false)
  const [includeDailySummary, setIncludeDailySummary] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (open) {
      setStartDate(initialStart)
      setEndDate(initialEnd)
      const accountFilterActive = filterPayment !== 'all'
      setSplitPerBarber(filterBarber === 'all' && accountFilterActive)
      setIncludeDailySummary(false)
    }
  }, [open, initialStart, initialEnd, filterBarber, filterPayment])

  const paymentParams = useMemo<{
    paymentMethod: 'cash' | 'card' | 'transfer' | null
    paymentAccountId: string | null
  }>(() => {
    if (filterPayment === 'all') return { paymentMethod: null, paymentAccountId: null }
    if (filterPayment === 'cash') return { paymentMethod: 'cash', paymentAccountId: null }
    if (filterPayment === 'card') return { paymentMethod: 'card', paymentAccountId: null }
    if (filterPayment === 'salary_accounts') return { paymentMethod: 'transfer', paymentAccountId: 'salary_accounts' }
    if (filterPayment.startsWith('acct:')) return { paymentMethod: 'transfer', paymentAccountId: filterPayment.slice(5) }
    return { paymentMethod: null, paymentAccountId: null }
  }, [filterPayment])

  const paymentLabel = useMemo(() => {
    if (filterPayment === 'all') return 'Todos los pagos'
    if (filterPayment === 'cash') return 'Efectivo'
    if (filterPayment === 'card') return 'Tarjeta'
    if (filterPayment === 'salary_accounts') return 'Cuentas sueldos'
    if (filterPayment.startsWith('acct:')) {
      const id = filterPayment.slice(5)
      return accounts.find(a => a.id === id)?.name ?? 'Cuenta'
    }
    return 'Todos los pagos'
  }, [filterPayment, accounts])

  const barberLabel = useMemo(() => {
    if (filterBarber === 'all') return 'Todos los barberos'
    return barbers.find(b => b.id === filterBarber)?.name ?? 'Barbero'
  }, [filterBarber, barbers])

  const handleExport = async () => {
    if (endDate < startDate) {
      toast.error('La fecha hasta debe ser posterior a la fecha desde')
      return
    }
    setExporting(true)
    try {
      const barberIds = filterBarber === 'all' ? [] : [filterBarber]
      const { data, error } = await fetchCajaCSVData({
        branchId, startDate, endDate, barberIds,
        paymentMethod: paymentParams.paymentMethod,
        paymentAccountId: paymentParams.paymentAccountId,
      })
      if (error) { toast.error(error); return }
      if (data.length === 0) { toast.info('No hay datos para exportar con los filtros seleccionados'); return }

      const headers = ['Fecha', 'Hora', 'Cliente', 'Telefono', 'Barbero', 'Monto', 'Metodo de Pago', 'Cuenta']
      const toRow = (r: CajaCSVRow) => [r.fecha, r.hora, r.cliente, r.telefono, r.barbero, r.monto, r.metodoPago, r.cuenta]
      const rangeLabel = startDate === endDate ? startDate : `${startDate}-a-${endDate}`
      const paymentSuffix = filterPayment === 'all' ? 'todos' : safeFilePart(paymentLabel)

      const buildCsv = (rows: CajaCSVRow[]): string => {
        const body = rows.map(toRow)
        if (includeDailySummary) {
          const byDay = new Map<string, number>()
          for (const r of rows) byDay.set(r.fecha, (byDay.get(r.fecha) ?? 0) + Number(r.monto))
          for (const [fecha, total] of byDay) {
            body.push([`TOTAL DIA ${fecha}`, '', '', '', '', total, '', ''])
          }
        }
        return csvFromRows(headers, body)
      }

      if (splitPerBarber && filterBarber === 'all') {
        const byBarber = new Map<string, { name: string; rows: CajaCSVRow[] }>()
        for (const r of data) {
          const existing = byBarber.get(r.barberoId)
          if (existing) existing.rows.push(r)
          else byBarber.set(r.barberoId, { name: r.barbero, rows: [r] })
        }
        const { default: JSZip } = await import('jszip')
        const zip = new JSZip()
        for (const [, { name, rows }] of byBarber) {
          zip.file(`caja-${safeFilePart(name)}-${rangeLabel}-${paymentSuffix}.csv`, '﻿' + buildCsv(rows))
        }
        const blob = await zip.generateAsync({ type: 'blob' })
        triggerDownload(blob, `caja-por-barbero-${rangeLabel}-${paymentSuffix}.zip`)
        toast.success(`ZIP generado: ${byBarber.size} barbero(s)`)
      } else {
        const csv = buildCsv(data)
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
        const barberSuffix = filterBarber === 'all' ? 'todos' : safeFilePart(barberLabel)
        triggerDownload(blob, `caja-${barberSuffix}-${rangeLabel}-${paymentSuffix}.csv`)
        toast.success('CSV exportado correctamente')
      }
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast.error('Error al exportar')
    } finally {
      setExporting(false)
    }
  }

  const canSplit = filterBarber === 'all'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" />
            Exportar reporte CSV
          </DialogTitle>
          <DialogDescription>
            Los filtros aplicados en la vista se usan para el export. Solo podés ajustar el rango de fechas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Filtros aplicados</p>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5"><User className="size-3" />Barbero</span>
              <span className="text-zinc-200 font-medium">{barberLabel}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5"><DollarSign className="size-3" />Pago</span>
              <span className="text-zinc-200 font-medium">{paymentLabel}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5"><Calendar className="size-3" />Rango</span>
              <span className="text-zinc-200 font-medium">{startDate === endDate ? startDate : `${startDate} — ${endDate}`}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>

          {canSplit && (
            <label className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 cursor-pointer hover:border-zinc-700 transition-colors">
              <Checkbox checked={splitPerBarber} onCheckedChange={(v) => setSplitPerBarber(v === true)} className="mt-0.5" />
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-zinc-200">Un CSV por barbero (ZIP)</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Genera un CSV separado por cada barbero dentro de un ZIP.
                </p>
              </div>
            </label>
          )}

          <label className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 cursor-pointer hover:border-zinc-700 transition-colors">
            <Checkbox checked={includeDailySummary} onCheckedChange={(v) => setIncludeDailySummary(v === true)} className="mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-zinc-200">Incluir resumen por día</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Agrega al final del CSV filas "TOTAL DIA YYYY-MM-DD" con el subtotal del día.
              </p>
            </div>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={exporting}>Cancelar</Button>
          <Button onClick={handleExport} disabled={exporting} className="gap-1.5">
            {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {exporting ? 'Exportando...' : splitPerBarber && canSplit ? 'Descargar ZIP' : 'Descargar CSV'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/components/export-dialog.tsx
git commit -m "feat(caja): ExportDialog extraído + opción resumen por día"
```

---

## Task 16: Tab "Hoy" (`tab-hoy.tsx`)

**Files:**
- Create: `src/app/dashboard/caja/tab-hoy.tsx`

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calendar } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useBranchStore } from '@/stores/branch-store'
import { useVisibilityRefresh } from '@/hooks/use-visibility-refresh'
import { getLocalDateStr } from '@/lib/time-utils'
import {
  fetchCajaTickets, fetchCajaSummary,
  type CajaTicket, type CajaDailySummary, type CajaSummaryComparison,
} from '@/lib/actions/caja'
import { HeroCard } from './components/hero-card'
import { PaymentSplit } from './components/payment-split'
import { FilterBar, type BarberOption, type AccountOption } from './components/filter-bar'
import { TicketList } from './components/ticket-list'
import { LiveIndicator } from './components/live-indicator'

interface TabHoyProps {
  initialDate: string
  initialTickets: CajaTicket[]
  initialSummary: CajaDailySummary
  initialComparison: CajaSummaryComparison | null
  barbers: BarberOption[]
  accounts: AccountOption[]
  today: string
}

export function TabHoy({
  initialDate, initialTickets, initialSummary, initialComparison,
  barbers, accounts, today,
}: TabHoyProps) {
  const [date, setDate] = useState(initialDate)
  const [tickets, setTickets] = useState<CajaTicket[]>(initialTickets)
  const [summary, setSummary] = useState<CajaDailySummary>(initialSummary)
  const [comparison, setComparison] = useState<CajaSummaryComparison | null>(initialComparison)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(Date.now())

  const [search, setSearch] = useState('')
  const [filterBarber, setFilterBarber] = useState('all')
  const [filterPayment, setFilterPayment] = useState('all')

  const selectedBranchId = useBranchStore(s => s.selectedBranchId)
  const prevBranchRef = useRef(selectedBranchId)

  const isToday = date === today

  const fetchData = useCallback(async (d: string, branchId: string | null) => {
    const now = new Date()
    const compareAtHour = d === today ? now.getHours() : null
    const [t, s] = await Promise.all([
      fetchCajaTickets({ branchId, date: d }),
      fetchCajaSummary({ branchId, date: d, compareAtHour }),
    ])
    return { tickets: t.data, summary: s.data, comparison: s.comparison }
  }, [today])

  const refresh = useCallback(async (d?: string, b?: string | null) => {
    const useDate = d ?? date
    const useBranch = b !== undefined ? b : selectedBranchId
    setRefreshing(true)
    try {
      const { tickets, summary, comparison } = await fetchData(useDate, useBranch)
      setTickets(tickets)
      setSummary(summary)
      setComparison(comparison)
      setLastUpdatedAt(Date.now())
    } finally {
      setRefreshing(false)
    }
  }, [date, selectedBranchId, fetchData])

  // Branch change
  useEffect(() => {
    if (prevBranchRef.current !== selectedBranchId) {
      prevBranchRef.current = selectedBranchId
      refresh(undefined, selectedBranchId)
    }
  }, [selectedBranchId, refresh])

  // Auto-refresh solo cuando es hoy
  useVisibilityRefresh(
    () => { if (isToday) refresh() },
    isToday ? 30_000 : 0,
  )

  const onDateChange = (d: string) => {
    setDate(d)
    refresh(d)
  }

  // ── Filtrado local ──
  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qNum = q ? Number(q.replace(/[.,]/g, '')) : NaN

    return tickets.filter(t => {
      if (filterBarber !== 'all' && t.barberId !== filterBarber) return false
      if (filterPayment !== 'all') {
        if (filterPayment === 'cash' && t.paymentMethod !== 'cash') return false
        if (filterPayment === 'card' && t.paymentMethod !== 'card') return false
        if (filterPayment === 'salary_accounts') {
          const salaryIds = new Set(accounts.filter(a => a.isSalaryAccount).map(a => a.id))
          if (!(t.paymentMethod === 'transfer' && t.paymentAccountId != null && salaryIds.has(t.paymentAccountId))) return false
        }
        if (filterPayment.startsWith('acct:')) {
          const id = filterPayment.slice(5)
          if (!(t.paymentMethod === 'transfer' && t.paymentAccountId === id)) return false
        }
      }
      if (q) {
        const matchName = t.clientName.toLowerCase().includes(q)
        const matchAmount = !Number.isNaN(qNum) && qNum > 0 && (t.amount === qNum || String(t.amount).startsWith(String(qNum)))
        if (!matchName && !matchAmount) return false
      }
      return true
    })
  }, [tickets, filterBarber, filterPayment, search, accounts])

  return (
    <div className="space-y-4">
      {/* Selector de día */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Viendo:</span>
        <div className="relative">
          <Calendar className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          <Input type="date" value={date} onChange={(e) => onDateChange(e.target.value)}
            className="w-[150px] h-8 text-xs pl-7" />
        </div>
        {!isToday && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => onDateChange(today)}>
            Volver a hoy
          </Button>
        )}
        <div className="ml-auto">
          <LiveIndicator
            isLive={isToday}
            lastUpdatedAt={lastUpdatedAt}
            onManualRefresh={() => refresh()}
            isRefreshing={refreshing}
          />
        </div>
      </div>

      {/* Hero */}
      <HeroCard
        totalRevenue={summary.totalRevenue}
        ticketCount={summary.ticketCount}
        comparison={{
          yesterday: comparison?.yesterday ?? null,
          lastWeek: comparison?.lastWeek ?? null,
        }}
        date={date}
        isToday={isToday}
      />

      {/* Payment split */}
      <PaymentSplit
        summary={summary}
        comparison={comparison}
        onMethodClick={(key) => setFilterPayment(filterPayment === key ? 'all' : key)}
      />

      {/* Filtros */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        barberId={filterBarber}
        onBarberChange={setFilterBarber}
        barbers={barbers}
        payment={filterPayment}
        onPaymentChange={setFilterPayment}
        accounts={accounts}
      />

      {/* Lista */}
      <TicketList
        tickets={filteredTickets}
        groupBy="hour"
        emptyMessage={tickets.length === 0 ? 'Todavía no se registraron cobros hoy' : 'No hay tickets para los filtros seleccionados'}
        showFilteredFooter
        totalUnfiltered={tickets.length}
      />
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/tab-hoy.tsx
git commit -m "feat(caja): tab Hoy con hero, payment split, filtros y lista"
```

---

## Task 17: Tab "Historial" (`tab-historial.tsx`)

**Files:**
- Create: `src/app/dashboard/caja/tab-historial.tsx`

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useBranchStore } from '@/stores/branch-store'
import { getLocalDateStr } from '@/lib/time-utils'
import { fetchCajaTickets, type CajaTicket } from '@/lib/actions/caja'
import { formatCurrency } from '@/lib/format'
import { FilterBar, type BarberOption, type AccountOption } from './components/filter-bar'
import { TicketList } from './components/ticket-list'
import { DateRangePickerCompact } from './components/date-range-picker-compact'
import { ExportDialog } from './components/export-dialog'

interface TabHistorialProps {
  barbers: BarberOption[]
  accounts: AccountOption[]
  today: string
}

const PAGE_SIZE = 100
const MAX_RANGE_DAYS = 60

function daysBetween(start: string, end: string): number {
  const a = new Date(start + 'T12:00:00Z').getTime()
  const b = new Date(end + 'T12:00:00Z').getTime()
  return Math.abs(Math.round((b - a) / (1000 * 60 * 60 * 24)))
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function firstOfMonth(dateStr: string): string {
  return dateStr.slice(0, 7) + '-01'
}

function endOfMonth(dateStr: string): string {
  const y = parseInt(dateStr.slice(0, 4), 10)
  const m = parseInt(dateStr.slice(5, 7), 10)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${dateStr.slice(0, 7)}-${String(last).padStart(2, '0')}`
}

export function TabHistorial({ barbers, accounts, today }: TabHistorialProps) {
  const [range, setRange] = useState({ start: shiftDate(today, -6), end: today })
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterBarber, setFilterBarber] = useState('all')
  const [filterPayment, setFilterPayment] = useState('all')

  const [tickets, setTickets] = useState<CajaTicket[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [showExport, setShowExport] = useState(false)

  const selectedBranchId = useBranchStore(s => s.selectedBranchId)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const firstLoadRef = useRef(true)

  // Debounce de búsqueda
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(id)
  }, [search])

  const paymentParams = useMemo(() => {
    if (filterPayment === 'all') return { paymentMethod: null as string | null, paymentAccountId: null as string | null }
    if (filterPayment === 'cash') return { paymentMethod: 'cash', paymentAccountId: null }
    if (filterPayment === 'card') return { paymentMethod: 'card', paymentAccountId: null }
    if (filterPayment === 'salary_accounts') return { paymentMethod: null, paymentAccountId: 'salary_accounts' }
    if (filterPayment.startsWith('acct:')) return { paymentMethod: null, paymentAccountId: filterPayment.slice(5) }
    return { paymentMethod: null, paymentAccountId: null }
  }, [filterPayment])

  const load = useCallback(async (offset: number, append: boolean) => {
    if (daysBetween(range.start, range.end) > MAX_RANGE_DAYS) {
      if (!append) {
        toast.error(`Elegí un rango menor a ${MAX_RANGE_DAYS} días`)
        setTickets([])
        setTotal(0)
      }
      return
    }
    if (append) setLoadingMore(true); else setLoading(true)
    try {
      const { data, total: t } = await fetchCajaTickets({
        branchId: selectedBranchId,
        startDate: range.start,
        endDate: range.end,
        barberId: filterBarber === 'all' ? null : filterBarber,
        paymentMethod: paymentParams.paymentMethod,
        paymentAccountId: paymentParams.paymentAccountId,
        search: debouncedSearch.trim() || null,
        limit: PAGE_SIZE,
        offset,
      })
      setTotal(t)
      setTickets(prev => append ? [...prev, ...data] : data)
    } finally {
      if (append) setLoadingMore(false); else setLoading(false)
    }
  }, [range, filterBarber, paymentParams, debouncedSearch, selectedBranchId])

  // Reset cuando cambian filtros/rango/branch
  useEffect(() => {
    load(0, false)
  }, [load])

  // Scroll infinito
  useEffect(() => {
    if (!sentinelRef.current) return
    const el = sentinelRef.current
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && tickets.length < total && !loading && !loadingMore) {
        load(tickets.length, true)
      }
    }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [tickets.length, total, loading, loadingMore, load])

  // Summary del rango (cliente)
  const rangeSummary = useMemo(() => {
    let cash = 0, card = 0, transfer = 0
    for (const t of tickets) {
      if (t.paymentMethod === 'cash') cash += t.amount
      else if (t.paymentMethod === 'card') card += t.amount
      else if (t.paymentMethod === 'transfer') transfer += t.amount
    }
    return { cash, card, transfer, total: cash + card + transfer }
  }, [tickets])

  const shortcuts = useMemo(() => [
    { label: 'Ayer', rangeFn: () => ({ start: shiftDate(today, -1), end: shiftDate(today, -1) }) },
    { label: 'Últimos 7d', rangeFn: () => ({ start: shiftDate(today, -6), end: today }) },
    { label: 'Este mes', rangeFn: () => ({ start: firstOfMonth(today), end: today }) },
    { label: 'Mes pasado', rangeFn: () => {
      const prev = shiftDate(firstOfMonth(today), -1)
      return { start: firstOfMonth(prev), end: endOfMonth(prev) }
    }},
  ], [today])

  const isShortcutActive = (r: { start: string; end: string }) =>
    r.start === range.start && r.end === range.end

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="space-y-2">
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          barberId={filterBarber}
          onBarberChange={setFilterBarber}
          barbers={barbers}
          payment={filterPayment}
          onPaymentChange={setFilterPayment}
          accounts={accounts}
        />
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePickerCompact value={range} onChange={setRange} shortcuts={shortcuts} />
          <div className="flex flex-wrap gap-1">
            {shortcuts.map((s, i) => (
              <Button
                key={i}
                variant={isShortcutActive(s.rangeFn()) ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setRange(s.rangeFn())}
              >
                {s.label}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="ml-auto gap-1.5 h-8 text-xs" onClick={() => setShowExport(true)}>
            <Download className="size-3.5" />
            Exportar
          </Button>
        </div>
      </div>

      {/* Resumen del rango */}
      <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-y-1">
          <span className="font-semibold text-zinc-100">
            Total: {formatCurrency(rangeSummary.total)} · {total} {total === 1 ? 'ticket' : 'tickets'}
          </span>
          <span className="text-xs text-muted-foreground">
            Efectivo {formatCurrency(rangeSummary.cash)} · Tarjeta {formatCurrency(rangeSummary.card)} · Transfer {formatCurrency(rangeSummary.transfer)}
          </span>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
          <Loader2 className="size-4 animate-spin" />
          Cargando...
        </div>
      ) : (
        <TicketList
          tickets={tickets}
          groupBy="day"
          emptyMessage="No se encontraron cobros para este período y filtros"
        />
      )}

      {/* Sentinel para scroll infinito */}
      {tickets.length < total && (
        <div ref={sentinelRef} className="flex justify-center py-4">
          {loadingMore && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      )}

      {/* Export dialog */}
      <ExportDialog
        open={showExport}
        onOpenChange={setShowExport}
        branchId={selectedBranchId}
        initialStart={range.start}
        initialEnd={range.end}
        filterBarber={filterBarber}
        filterPayment={filterPayment}
        barbers={barbers}
        accounts={accounts}
      />
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/tab-historial.tsx
git commit -m "feat(caja): tab Historial con rango, scroll infinito y export"
```

---

## Task 18: Componente `HandoverDialog`

**Files:**
- Create: `src/app/dashboard/caja/components/handover-dialog.tsx`

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

import { useEffect, useState, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { confirmCashHandover } from '@/lib/actions/caja'

interface HandoverDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  branchId: string
  barberId: string
  barberName: string
  date: string
  expectedCash: number
  cashTicketCount: number
  initialActual?: number
  initialNotes?: string | null
  onDone: () => void
}

export function HandoverDialog({
  open, onOpenChange,
  branchId, barberId, barberName, date,
  expectedCash, cashTicketCount,
  initialActual, initialNotes,
  onDone,
}: HandoverDialogProps) {
  const [actual, setActual] = useState<string>(String(initialActual ?? expectedCash))
  const [notes, setNotes] = useState<string>(initialNotes ?? '')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setActual(String(initialActual ?? expectedCash))
      setNotes(initialNotes ?? '')
    }
  }, [open, initialActual, initialNotes, expectedCash])

  const actualNum = useMemo(() => {
    const n = Number(actual.replace(/[.,]/g, '.'))
    return Number.isFinite(n) ? n : NaN
  }, [actual])

  const diff = useMemo(() => Number.isNaN(actualNum) ? 0 : actualNum - expectedCash, [actualNum, expectedCash])
  const hasDiff = Math.abs(diff) > 0.009

  const handleConfirm = async () => {
    if (Number.isNaN(actualNum) || actualNum < 0) {
      toast.error('Monto inválido')
      return
    }
    if (hasDiff && !notes.trim()) {
      toast.error('Nota requerida cuando hay diferencia')
      return
    }
    setSubmitting(true)
    try {
      const { ok, error } = await confirmCashHandover({
        branchId, barberId, date, actualAmount: actualNum, notes: notes.trim() || null,
      })
      if (!ok) { toast.error(error ?? 'Error al confirmar'); return }
      toast.success('Rendición confirmada')
      onOpenChange(false)
      onDone()
    } finally {
      setSubmitting(false)
    }
  }

  const diffColor = !hasDiff
    ? 'text-zinc-400'
    : diff > 0 ? 'text-emerald-400' : 'text-rose-400'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rendir efectivo de {barberName}</DialogTitle>
          <DialogDescription>
            {cashTicketCount} {cashTicketCount === 1 ? 'ticket' : 'tickets'} en efectivo · A rendir: <span className="font-semibold text-zinc-200">{formatCurrency(expectedCash)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="actual-amount" className="text-xs">Monto entregado</Label>
            <Input
              id="actual-amount"
              type="number"
              step="0.01"
              min="0"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              className="h-10 text-base"
            />
          </div>

          <div className={`flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm ${diffColor}`}>
            <span>Diferencia</span>
            <span className="font-semibold">
              {diff > 0 ? '+' : ''}{Number.isNaN(actualNum) ? '—' : formatCurrency(diff)}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="handover-notes" className="text-xs flex items-center gap-1">
              Nota {hasDiff && <span className="text-rose-400">(requerida)</span>}
              {!hasDiff && <span className="text-muted-foreground">(opcional)</span>}
            </Label>
            <Textarea
              id="handover-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={hasDiff ? 'Ej: se usó un vale adelantado' : ''}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={submitting} className="gap-1.5">
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            Confirmar rendición
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/components/handover-dialog.tsx
git commit -m "feat(caja): HandoverDialog con diff en vivo + validación de nota"
```

---

## Task 19: Componente `CashHandoverCard`

**Files:**
- Create: `src/app/dashboard/caja/components/cash-handover-card.tsx`

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

import { CheckCircle2, AlertTriangle, User, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/format'
import type { CashHandoverStatus } from '@/lib/actions/caja'

interface CashHandoverCardProps {
  status: CashHandoverStatus
  canReconcile: boolean
  onRendir: () => void
  onEditar: () => void
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export function CashHandoverCard({ status, canReconcile, onRendir, onEditar }: CashHandoverCardProps) {
  const h = status.handover
  const hasDiff = h != null && Math.abs(h.difference) > 0.009

  const borderClass = h == null
    ? 'border-zinc-800/80'
    : hasDiff ? 'border-amber-500/40' : 'border-emerald-500/40'

  return (
    <div className={`rounded-xl border ${borderClass} bg-zinc-900/60 p-3`}>
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
          <User className="size-4 text-zinc-400" />
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-zinc-100 truncate">{status.barberName}</span>
            {h != null && !hasDiff && <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />}
            {h != null && hasDiff && <AlertTriangle className="size-4 text-amber-400 shrink-0" />}
          </div>

          {h == null ? (
            <>
              <p className="text-xs text-muted-foreground">
                {status.cashTicketCount} {status.cashTicketCount === 1 ? 'ticket' : 'tickets'} en efectivo · A rendir: <span className="font-semibold text-zinc-200">{formatCurrency(status.expectedCash)}</span>
              </p>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {status.cashTicketCount} {status.cashTicketCount === 1 ? 'ticket' : 'tickets'} · Rendido: <span className="font-semibold text-zinc-200">{formatCurrency(h.actualAmount)}</span>
                {hasDiff && (
                  <> · Esperado: {formatCurrency(status.expectedCash)} · <span className={h.difference < 0 ? 'text-rose-400' : 'text-emerald-400'}>Diferencia: {h.difference > 0 ? '+' : ''}{formatCurrency(h.difference)}</span></>
                )}
              </p>
              {h.notes && (
                <p className="text-[11px] italic text-zinc-400">&ldquo;{h.notes}&rdquo;</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Confirmado por {h.confirmedBy.name} · {formatDateTime(h.confirmedAt)}
                {h.updatedAt && <> · editado {formatDateTime(h.updatedAt)}</>}
              </p>
            </>
          )}
        </div>

        <div className="shrink-0">
          {h == null ? (
            canReconcile && (
              <Button size="sm" onClick={onRendir} className="h-8">Rendir</Button>
            )
          ) : (
            canReconcile && (
              <Button size="sm" variant="outline" onClick={onEditar} className="h-8 gap-1.5">
                <Pencil className="size-3" /> Editar
              </Button>
            )
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/components/cash-handover-card.tsx
git commit -m "feat(caja): CashHandoverCard con estados pendiente/confirmado/con-diferencia"
```

---

## Task 20: Tab "Cierre del día" (`tab-cierre.tsx`)

**Files:**
- Create: `src/app/dashboard/caja/tab-cierre.tsx`

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useBranchStore } from '@/stores/branch-store'
import {
  fetchCashHandoverStatus, fetchCajaSummary,
  type CashHandoverStatus, type CajaDailySummary,
} from '@/lib/actions/caja'
import { formatCurrency } from '@/lib/format'
import { CashHandoverCard } from './components/cash-handover-card'
import { HandoverDialog } from './components/handover-dialog'

interface TabCierreProps {
  today: string
  canReconcile: boolean
  availableBranches: { id: string; name: string }[]
}

export function TabCierre({ today, canReconcile, availableBranches }: TabCierreProps) {
  const [date, setDate] = useState(today)
  const [statuses, setStatuses] = useState<CashHandoverStatus[]>([])
  const [summary, setSummary] = useState<CajaDailySummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<CashHandoverStatus | null>(null)

  const selectedBranchId = useBranchStore(s => s.selectedBranchId)
  const prevKeyRef = useRef<string>('')

  const branchName = useMemo(
    () => availableBranches.find(b => b.id === selectedBranchId)?.name ?? null,
    [availableBranches, selectedBranchId],
  )

  const load = useCallback(async () => {
    if (!selectedBranchId) {
      setStatuses([])
      setSummary(null)
      return
    }
    setLoading(true)
    try {
      const [s, sum] = await Promise.all([
        fetchCashHandoverStatus({ branchId: selectedBranchId, date }),
        fetchCajaSummary({ branchId: selectedBranchId, date, compareAtHour: null }),
      ])
      setStatuses(s.data)
      setSummary(sum.data)
    } finally {
      setLoading(false)
    }
  }, [selectedBranchId, date])

  useEffect(() => {
    const key = `${selectedBranchId ?? 'none'}|${date}`
    if (prevKeyRef.current === key) return
    prevKeyRef.current = key
    load()
  }, [selectedBranchId, date, load])

  // Empty state: sin sucursal seleccionada
  if (!selectedBranchId) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center space-y-2">
        <p className="text-sm font-medium text-zinc-100">Elegí una sucursal arriba para ver la rendición del día.</p>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          El cierre de caja se hace por sucursal — cada encargado rinde los barberos de su local.
        </p>
      </div>
    )
  }

  const confirmedCount = statuses.filter(s => s.handover != null).length
  const pendingCount = statuses.length - confirmedCount

  const totalExpected = statuses.reduce((s, x) => s + x.expectedCash, 0)
  const totalRendered = statuses.reduce((s, x) => s + (x.handover?.actualAmount ?? 0), 0)
  const totalDiff = statuses.reduce((s, x) => s + (x.handover?.difference ?? 0), 0)

  const progress = statuses.length === 0 ? 100 : Math.round((confirmedCount / statuses.length) * 100)

  const dateLabel = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long', day: '2-digit', month: 'long',
  }).format(new Date(date + 'T12:00:00Z'))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-zinc-100">
              Cierre del {dateLabel}
            </p>
            {branchName && <p className="text-xs text-muted-foreground">{branchName}</p>}
          </div>
          <div className="relative">
            <Calendar className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={today}
              className="w-[150px] h-8 text-xs pl-7" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {confirmedCount} de {statuses.length} barberos rindieron · {formatCurrency(totalRendered)} / {formatCurrency(totalExpected)}
          </p>
          <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full bg-emerald-500/70 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
          <Loader2 className="size-4 animate-spin" />
          Cargando...
        </div>
      ) : statuses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No hay barberos con efectivo a rendir este día.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {statuses.map(st => (
            <CashHandoverCard
              key={st.barberId}
              status={st}
              canReconcile={canReconcile}
              onRendir={() => setEditing(st)}
              onEditar={() => setEditing(st)}
            />
          ))}
        </div>
      )}

      {/* Resumen final */}
      {statuses.length > 0 && summary && (
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3 space-y-1.5 text-sm">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Resumen del día</p>
          <div className="flex justify-between"><span className="text-zinc-400">Total efectivo cobrado</span><span className="text-zinc-200">{formatCurrency(summary.totalCash)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-400">Total efectivo rendido</span><span className="text-zinc-200">{formatCurrency(totalRendered)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-400">Egresos en efectivo</span><span className="text-rose-400">− {formatCurrency(summary.cashExpenses)}</span></div>
          <div className="border-t border-zinc-800/60 pt-1.5 flex justify-between font-semibold">
            <span className="text-zinc-300">Efectivo que debería quedar</span>
            <span className="text-zinc-100">{formatCurrency(totalRendered - summary.cashExpenses)}</span>
          </div>
          {pendingCount > 0 && (
            <p className="text-[11px] text-amber-400/80">
              ⚠ Hay {pendingCount} {pendingCount === 1 ? 'barbero pendiente' : 'barberos pendientes'} de rendir — el efectivo rendido todavía es parcial.
            </p>
          )}
          {Math.abs(totalDiff) > 0.009 && (
            <p className={`text-[11px] ${totalDiff < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              Diferencias totales: {totalDiff > 0 ? '+' : ''}{formatCurrency(totalDiff)}
            </p>
          )}
        </div>
      )}

      {editing && selectedBranchId && (
        <HandoverDialog
          open={!!editing}
          onOpenChange={(o) => { if (!o) setEditing(null) }}
          branchId={selectedBranchId}
          barberId={editing.barberId}
          barberName={editing.barberName}
          date={date}
          expectedCash={editing.expectedCash}
          cashTicketCount={editing.cashTicketCount}
          initialActual={editing.handover?.actualAmount}
          initialNotes={editing.handover?.notes ?? null}
          onDone={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/tab-cierre.tsx
git commit -m "feat(caja): tab Cierre con cards por barbero + resumen del día"
```

---

## Task 21: Shell `caja-client.tsx` con tabs

**Files:**
- Modify: `src/app/dashboard/caja/caja-client.tsx` (reemplazar contenido)

- [ ] **Step 1: Reemplazar el contenido del archivo**

Borrar todo el contenido actual de `caja-client.tsx` y poner:

```typescript
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import { TabHoy } from './tab-hoy'
import { TabHistorial } from './tab-historial'
import { TabCierre } from './tab-cierre'
import type { BarberOption, AccountOption } from './components/filter-bar'
import type { CajaTicket, CajaDailySummary, CajaSummaryComparison } from '@/lib/actions/caja'

type TabKey = 'hoy' | 'historial' | 'cierre'

interface Branch { id: string; name: string }

interface CajaClientProps {
  initialTab: TabKey
  initialDate: string
  today: string
  initialTickets: CajaTicket[]
  initialSummary: CajaDailySummary
  initialComparison: CajaSummaryComparison | null
  branches: Branch[]
  barbers: BarberOption[]
  accounts: AccountOption[]
  canReconcile: boolean
}

export function CajaClient(props: CajaClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<TabKey>(props.initialTab)

  const setTabAndUrl = useCallback((next: TabKey) => {
    setTab(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'hoy') params.delete('tab')
    else params.set('tab', next)
    const qs = params.toString()
    router.replace(`/dashboard/caja${qs ? '?' + qs : ''}`, { scroll: false })
  }, [router, searchParams])

  // Sincronizar si cambia la URL externamente
  useEffect(() => {
    const fromUrl = searchParams.get('tab')
    const next: TabKey = fromUrl === 'historial' || fromUrl === 'cierre' ? fromUrl : 'hoy'
    if (next !== tab) setTab(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-5rem)] flex-col overflow-hidden">
      {/* Header fijo */}
      <div className="shrink-0 px-4 pt-3 pb-2 border-b border-zinc-800/60">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg lg:text-xl font-bold tracking-tight">Caja</h2>
          </div>
          <BranchSelector branches={props.branches} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs value={tab} onValueChange={(v) => setTabAndUrl(v as TabKey)} className="flex-1 overflow-hidden flex flex-col gap-0">
          <div className="shrink-0 px-4 pt-2 pb-3 border-b border-zinc-800/60">
            <TabsList variant="line" className="w-fit">
              <TabsTrigger value="hoy">Hoy</TabsTrigger>
              <TabsTrigger value="historial">Historial</TabsTrigger>
              <TabsTrigger value="cierre">Cierre del día</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="hoy" className="flex-1 overflow-y-auto px-4 py-4">
            <TabHoy
              initialDate={props.initialDate}
              initialTickets={props.initialTickets}
              initialSummary={props.initialSummary}
              initialComparison={props.initialComparison}
              barbers={props.barbers}
              accounts={props.accounts}
              today={props.today}
            />
          </TabsContent>

          <TabsContent value="historial" className="flex-1 overflow-y-auto px-4 py-4">
            <TabHistorial
              barbers={props.barbers}
              accounts={props.accounts}
              today={props.today}
            />
          </TabsContent>

          <TabsContent value="cierre" className="flex-1 overflow-y-auto px-4 py-4">
            <TabCierre
              today={props.today}
              canReconcile={props.canReconcile}
              availableBranches={props.branches}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/caja-client.tsx
git commit -m "refactor(caja): caja-client como shell con tabs + URL state"
```

---

## Task 22: Actualizar `page.tsx` (server component)

**Files:**
- Modify: `src/app/dashboard/caja/page.tsx` (reemplazar contenido)

- [ ] **Step 1: Reemplazar el contenido del archivo**

```typescript
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { redirect } from 'next/navigation'
import { getLocalDateStr } from '@/lib/time-utils'
import { fetchCajaTickets, fetchCajaSummary } from '@/lib/actions/caja'
import { getEffectivePermissions } from '@/lib/permissions'
import { CajaClient } from './caja-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Caja | BarberOS',
}

type TabKey = 'hoy' | 'historial' | 'cierre'

export default async function CajaPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: tabParam } = await searchParams
  const initialTab: TabKey = tabParam === 'historial' || tabParam === 'cierre' ? tabParam : 'hoy'

  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getScopedBranchIds()

  const supabase = createAdminClient()
  const today = getLocalDateStr()

  // Resolver permisos del usuario actual
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  let canReconcile = false
  if (user) {
    const { data: staff } = await supabase
      .from('staff')
      .select('role, role_id, role:roles(permissions)')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()
    const isOwnerAdmin = staff?.role === 'owner' || staff?.role === 'admin'
    const role = staff?.role as unknown as { permissions: Record<string, boolean> | null } | null
    const perms = getEffectivePermissions(role?.permissions ?? null, isOwnerAdmin)
    canReconcile = isOwnerAdmin || perms['finances.reconcile_cash'] === true
  }

  // Fetch inicial solo si el tab default es "hoy" (los otros tabs fetchean lazy en cliente)
  const now = new Date()
  const compareAtHour = now.getHours()

  const [
    ticketsResult,
    summaryResult,
    { data: branches },
    { data: barbersRaw },
    { data: accountsRaw },
  ] = await Promise.all([
    initialTab === 'hoy'
      ? fetchCajaTickets({ branchId: null, date: today })
      : Promise.resolve({ data: [], total: 0, error: null }),
    initialTab === 'hoy'
      ? fetchCajaSummary({ branchId: null, date: today, compareAtHour })
      : Promise.resolve({
          data: { totalCash: 0, totalCard: 0, totalTransfer: 0, accounts: [], totalRevenue: 0, ticketCount: 0, cashExpenses: 0 },
          comparison: null,
        }),
    branchIds.length > 0
      ? supabase.from('branches').select('id, name')
          .eq('organization_id', orgId)
          .in('id', branchIds)
          .eq('is_active', true)
          .order('name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('staff').select('id, full_name, branch_id')
          .eq('organization_id', orgId)
          .in('branch_id', branchIds)
          .or('role.eq.barber,is_also_barber.eq.true')
          .eq('is_active', true)
          .order('full_name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('payment_accounts')
          .select('id, name, branch_id, is_salary_account')
          .in('branch_id', branchIds)
          .eq('is_active', true)
          .order('sort_order')
      : Promise.resolve({ data: [] }),
  ])

  const barbers = (barbersRaw ?? []).map(b => ({ id: b.id, name: b.full_name }))
  const accounts = (accountsRaw ?? []).map(a => ({ id: a.id, name: a.name, isSalaryAccount: a.is_salary_account }))

  return (
    <CajaClient
      initialTab={initialTab}
      initialDate={today}
      today={today}
      initialTickets={ticketsResult.data}
      initialSummary={summaryResult.data}
      initialComparison={summaryResult.comparison}
      branches={branches ?? []}
      barbers={barbers}
      accounts={accounts}
      canReconcile={canReconcile}
    />
  )
}
```

- [ ] **Step 2: Lint + build**

Run: `npm run lint`
Run: `npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/page.tsx
git commit -m "feat(caja): page.tsx con initialTab, canReconcile y fetch condicional"
```

---

## Task 23: Actualizar `loading.tsx`

**Files:**
- Modify: `src/app/dashboard/caja/loading.tsx`

- [ ] **Step 1: Reemplazar el contenido**

```typescript
import { Skeleton } from '@/components/ui/skeleton'

export default function CajaLoading() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-5rem)] flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 pt-3 pb-2 border-b border-zinc-800/60">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>

      {/* Tabs */}
      <div className="shrink-0 px-4 pt-2 pb-3 border-b border-zinc-800/60">
        <div className="flex gap-1">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Selector de día */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-32" />
        </div>

        {/* Hero */}
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-6 space-y-3">
          <Skeleton className="h-12 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-52" />
        </div>

        {/* Payment split */}
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 space-y-3">
          <Skeleton className="h-4 w-36" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="size-7 rounded-md" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>

        {/* Filtros */}
        <Skeleton className="h-20 rounded-xl" />

        {/* Lista */}
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/caja/loading.tsx
git commit -m "chore(caja): skeleton loading adaptado al nuevo layout"
```

---

## Task 24: Verificación manual end-to-end

No hay tests automatizados. Este task es obligatorio — **la feature no está completa hasta que los 6 escenarios pasen**.

- [ ] **Step 1: Levantar dev server**

```bash
npm run dev
```

Abrir `http://localhost:3000/dashboard/caja` en el browser.

- [ ] **Step 2: Escenario 1 — Tab Hoy con día = hoy**

1. Verificar que el indicador "● en vivo · actualizado hace Xs" aparece arriba a la derecha.
2. Verificar que el hero muestra facturación del día + 2 comparaciones (vs semana pasada, vs ayer).
3. Esperar 30s sin hacer nada. Verificar que el "hace Xs" vuelve a "ahora" (re-fetcheó).
4. Minimizar la ventana o cambiar de tab por ≥ 5s, volver. Verificar que se re-fetchea al volver.
5. Apretar botón ícono de refresh. Verificar spinner y update.
6. Click en una fila del `PaymentSplit` (ej. `Efectivo`). Verificar que el filtro de la `FilterBar` cambia a "Efectivo" y la lista se filtra.
7. Escribir un nombre parcial en el buscador. Verificar filtrado inmediato.
8. Escribir un monto exacto (ej. `3200`). Verificar match por monto.
9. Expandir un ticket. Verificar servicios, productos, "Contactar cliente".
10. Apretar "Limpiar" en la filter bar. Verificar que vuelve a ver todos.

- [ ] **Step 3: Escenario 2 — Tab Hoy con día pasado**

1. Cambiar el date picker de "Viendo" a un día pasado.
2. Verificar que el indicador "● en vivo" desaparece.
3. Verificar que aparece el botón "Volver a hoy".
4. Verificar que las comparaciones en el hero muestran labels "vs hace 7 días" / "vs día anterior".
5. Click "Volver a hoy" → vuelve al día actual con indicador en vivo.

- [ ] **Step 4: Escenario 3 — Tab Historial**

1. Cambiar a tab `Historial`. Verificar que la URL cambió a `?tab=historial`.
2. Verificar que por default trae "últimos 7 días" (botón `Últimos 7d` marcado como activo).
3. Click en `Ayer`. Verificar que la lista se recarga con tickets de ayer.
4. Click en `Este mes`. Verificar que trae del día 1 hasta hoy.
5. Abrir el date range picker manual. Elegir un rango mayor a 60 días. Verificar que aparece toast de aviso.
6. Escribir en el buscador. Esperar 350ms. Verificar que recarga (debounce).
7. Si hay más de 100 tickets en el rango: scrollear hasta el final. Verificar que carga más (scroll infinito).
8. Click `Exportar`. Verificar que el dialog pre-carga las fechas y filtros actuales. Tildar "Incluir resumen por día". Descargar CSV. Abrir en un editor; verificar que hay filas "TOTAL DIA …" al final.

- [ ] **Step 5: Escenario 4 — Tab Cierre**

1. Cambiar a tab `Cierre del día`.
2. Si hay más de una sucursal y `BranchSelector` está en "Todas": verificar que aparece empty state forzando selección.
3. Elegir una sucursal. Verificar que aparecen cards por barbero con cash del día.
4. Apretar `Rendir` en una card. Verificar que el modal se abre con:
   - Monto entregado pre-cargado con el esperado.
   - Diferencia = 0.
   - Nota opcional.
5. Cambiar el monto a un valor distinto (ej. menos). Verificar que la diferencia aparece en rojo en vivo y la nota pasa a "requerida". Intentar confirmar sin nota → toast error.
6. Escribir una nota y confirmar. Verificar que la card cambia a estado "confirmado con diferencia" (⚠ amber) con el nombre del confirmador y el timestamp.
7. Confirmar otro barbero sin diferencia. Verificar estado "confirmado" (✓ emerald).
8. Verificar que la barra de progreso del header se actualiza (X de N barberos).
9. Verificar el bloque "Resumen del día" al final: `Total rendido`, `Egresos en efectivo`, `Efectivo que debería quedar`, `Diferencias totales`.
10. Click `Editar` en una card ya confirmada. Verificar que el modal trae los valores previos. Cambiar y confirmar.

- [ ] **Step 6: Escenario 5 — Multi-branch**

1. Si la org tiene más de una sucursal: cambiar branch en el `BranchSelector`. Verificar que todos los tabs recargan los datos correspondientes.
2. Como usuario con `role_branch_scope` limitado: verificar que solo ve sus sucursales y que no puede forzar por URL.

- [ ] **Step 7: Escenario 6 — Permisos**

1. Como usuario con rol sin `finances.view_summary`: verificar que NO puede entrar a `/dashboard/caja` (el sidebar lo oculta y el layout bloquea).
2. Como usuario con `finances.view_summary` pero sin `finances.reconcile_cash`: verificar que ve el tab `Cierre` pero que los botones `Rendir` / `Editar` **no aparecen** en las cards.
3. Como owner/admin: verificar que todo funciona.

- [ ] **Step 8: Verificación cruzada — comparativas correctas**

1. En Tab Hoy a las 15:00: el número "vs mismo día pasado" debe comparar contra cobros **hasta las 15:00** de 7 días atrás (no el día completo).
2. Para verificar: mirar brevemente en el SQL editor de Supabase, query:
```sql
select sum(amount) from visits
where branch_id = '<branch>' and completed_at >= '<hace 7 días 00:00>' and completed_at <= '<hace 7 días 15:59>';
```
3. El número debe matchear (o ser muy cercano módulo segundos) al que la UI usa como base del delta.

- [ ] **Step 9: Verificación cruzada — snapshot de expected_amount**

1. Rendir a un barbero con su monto exacto ($X).
2. En Supabase SQL editor: anular (update a `cancelled` o delete) una visita en cash de ese barbero de ese día. Esto hace que el "cash actual" del día baje.
3. Volver al tab Cierre del día. Verificar que la card sigue mostrando `expected_amount` = $X original (snapshot). El `expected_amount` en la DB NO se recalcula.
4. La única forma de actualizar es `Editar` manualmente.

- [ ] **Step 10: Declarar hecho**

Si los 9 pasos anteriores pasaron, hacer un commit final con mensaje explícito:

```bash
git commit --allow-empty -m "verify(caja): verificación manual end-to-end completa ✓"
```

---

## Self-Review (del plan)

**Spec coverage:**
- Layout + tabs + URL → Task 21
- Header + LiveIndicator → Task 8 + Task 21
- Tab Hoy: date picker + hero + payment split + filters + tickets → Tasks 12-13, 16
- Tab Historial: rango + shortcuts + scroll infinito + búsqueda server-side + export → Tasks 14-15, 17
- Tab Cierre: cards + dialog + resumen final + empty states → Tasks 18-20
- Migration `cash_handovers` → Task 1
- Permiso `finances.reconcile_cash` → Task 2
- Server actions extendidas (summary con comparativas, tickets con range+paginación+search) → Tasks 3, 4
- Server actions nuevas (status, confirm, revert) → Tasks 5, 6, 7
- Loading state → Task 23
- Testing manual cubriendo los 9 escenarios del spec → Task 24

**Placeholders:** ninguno. Todos los steps tienen código literal o comandos exactos.

**Type consistency:**
- `CajaSummaryComparison.byMethod[].key` = `'cash' | 'card' | 'acct:<uuid>'` — usado consistentemente en Task 3 (definición), Task 13 (consumo en PaymentSplit).
- `PaymentFilter` = `'all' | 'cash' | 'card' | 'salary_accounts' | 'acct:<uuid>'` — usado en Tasks 9 (FilterBar), 15 (ExportDialog), 16 (TabHoy), 17 (TabHistorial). Consistente.
- `CashHandoverStatus` — definido en Task 5, consumido en Tasks 19, 20. Consistente.
- `BarberOption` y `AccountOption` — definidos en Task 9 (exportados desde `filter-bar.tsx`), consumidos en Tasks 16, 17, 20, 21. Consistente.

---

## Execution Handoff

Plan listo y guardado en `docs/superpowers/plans/2026-04-24-caja-redesign.md`. 24 tasks + 1 de verificación manual.
