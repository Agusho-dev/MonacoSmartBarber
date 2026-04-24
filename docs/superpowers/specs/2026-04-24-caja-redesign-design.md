# Rediseño de la sección Caja — Design Spec

**Fecha**: 2026-04-24
**Autor**: Agustin + Claude
**Estado**: Propuesto (esperando review)
**Ruta afectada**: `/dashboard/caja`

## Resumen ejecutivo

La sección Caja (`/dashboard/caja`) se rediseña en torno a tres casos de uso ordenados por prioridad: **(1) monitoreo en tiempo real del día**, **(2) auditoría e historial**, **(3) cierre de caja con rendición de efectivo por barbero**. El registro de cobros sigue en la fila/visita; no se mueve a caja.

Se reemplaza la página actual (dashboard pasivo de un solo día) por una estructura de **tres tabs** dentro de la misma ruta: `Hoy`, `Historial`, `Cierre del día`. Se agrega **auto-refresh de 30s** en `Hoy`, **comparativas vs mismo día de la semana pasada y vs ayer** a la misma hora de corte, **búsqueda por cliente/monto**, y **estado persistido de rendición** vía nueva tabla `cash_handovers`.

El alcance cubre: UI completa, nueva server action para rendición, migración SQL 113, un nuevo permiso `finances.reconcile_cash`. No se tocan las tablas `visits`, `payment_accounts`, `transfer_logs`, `expense_tickets`.

## Motivación / pain points resueltos

Del diseño actual, los problemas que se resuelven explícitamente:

1. **Info mezclada con filtros sin zonas claras** — hoy, dashboard, filtros, "efectivo por barbero" y tickets se apilan sin separación conceptual. Se resuelve con tabs.
2. **"Efectivo por barbero" desaparece cuando aplicás filtros** — para cerrar caja lo necesitás siempre visible; se resuelve mudándolo al tab `Cierre del día`, donde es protagonista.
3. **La página no se siente "viva"** — no hay indicación de que los datos son de ahora; se resuelve con auto-refresh + indicador "● en vivo · actualizado hace Xs".
4. **No hay búsqueda** — se agregan buscadores por cliente/monto en `Hoy` (local sobre el día cargado) y en `Historial` (server-side sobre el rango).
5. **Filtros de pago con dropdown sobrecargado** — se reorganiza con grupos semánticos (`Directo` / `Cuentas (transfer)` / `Grupos`).
6. **Chips de filtros redundantes con el dropdown** — se eliminan; el estado queda en el dropdown.
7. **Sin concepto de rendición persistida** — se crea la tabla `cash_handovers` y el tab `Cierre del día` con flujo de confirmación.

## Decisiones de diseño globales

- **Ruta**: se mantiene `/dashboard/caja`. El tab activo se guarda en query string `?tab=hoy|historial|cierre` (default `hoy`). Esto permite URLs compartibles y que el back del browser funcione entre tabs.
- **Branch selector** persiste entre tabs (Zustand store existente). En `Cierre del día`, si no hay branch seleccionada y la org tiene más de una sucursal, se muestra empty state forzando elección. Si hay solo una, se auto-selecciona.
- **Comparativas "a la misma hora de corte"**: cuando hoy son las 14:30, al comparar con el viernes pasado se usan los cobros de ese viernes **hasta las 14:30**, no el total del día. Razón: comparar parcial contra total es engañoso. Implementado en el servidor vía `start/end` derivados de la hora actual en el timezone activo.
- **Auto-refresh en `Hoy`**: `setInterval(30_000)` que re-fetchea summary + tickets + comparativas cuando la fecha seleccionada es hoy. Se pausa si `document.visibilityState === 'hidden'`; al volver, se dispara refresh inmediato. Botón manual de refresh disponible.
- **Sin Supabase Realtime**: el auto-refresh polling es suficiente para "monitoreo" y más simple de mantener. Si en el futuro se necesita segundo-a-segundo, migrar a realtime sobre `visits` sin romper la API.
- **Consistencia visual**: se mantiene el look actual (zinc-900/60, rounded-xl, borders sutiles). No se introduce un sistema de diseño nuevo; se respetan primitivas shadcn/ui y Tailwind existentes.

## Layout general (header + tabs)

### Header (arriba, siempre visible)

```
┌────────────────────────────────────────────────────────────┐
│  Caja                                [Sucursal ▾]          │
│  ● en vivo · actualizado hace 12s            [↻]           │
└────────────────────────────────────────────────────────────┘
```

Elementos:
- Título `Caja`.
- Sub-línea con el indicador de vida. Solo visible en `Hoy` con fecha = hoy. En otros tabs o días pasados se oculta.
- `BranchSelector` (componente existente) a la derecha.
- Botón ícono de refresh manual (solo en `Hoy`).

### Tabs

```
  [ Hoy ] [ Historial ] [ Cierre del día ]
```

- Componente: `Tabs` de shadcn/ui con estado sincronizado a URL.
- Default: `hoy`.
- Al navegar entre tabs, el branch seleccionado persiste; la fecha/rango es contextual al tab.

## Tab "Hoy"

### Estructura vertical

1. Selector de día (compacto)
2. Hero del día
3. Payment split con tendencia
4. Buscador + filtros (sticky al scrollear)
5. Lista de tickets agrupada por hora

### 0. Selector de día

Una fila estrecha arriba del hero con un label y un date picker compacto:

```
Viendo: [📅 hoy ▾]    ← shortcut "Hoy" si está en un día pasado
```

- Default `hoy`. Al elegir otro día, el hero/payment-split/tickets se recalculan pero se mantiene en el tab `Hoy` (no se cambia a `Historial` — esos son conceptos distintos: `Hoy` muestra 1 día, `Historial` un rango).
- Si el día seleccionado ≠ hoy, desaparece el indicador "● en vivo" del header y el auto-refresh se pausa; aparece un shortcut `[Volver a hoy]`.
- El date picker es un `Input type="date"` estilizado compacto; el shortcut "Hoy" lo fija a today al clickear.

### 1. Hero del día (bajo el selector de día)

Card ancho. Un número protagonista.

Desktop:
```
┌──────────────────────────────────────────────────────────────────────┐
│  $ 187.400,00                                      14 tickets        │
│  ───────────                                                         │
│  ▲ +18% vs mismo viernes pasado (+$28.600)                           │
│  ▼ -4% vs ayer (-$7.200)                                             │
└──────────────────────────────────────────────────────────────────────┘
```

Mobile: mismo contenido, stackeado vertical.

Lógica:
- `totalRevenue` ya viene de `fetchCajaSummary`.
- Comparaciones: se calcula "misma hora de corte" en el servidor. Si la fecha seleccionada **no es hoy**, las comparaciones usan el día completo (sin recorte horario).
- Si no hay datos para el período de referencia, la comparación se muestra como "sin datos" en gris (no 0% ni NaN).
- Colores: `text-emerald-400` ▲, `text-rose-400` ▼, `text-zinc-500` =.

### 2. Payment split con tendencia

Card horizontal. Una fila por método/cuenta, ordenadas por monto descendente.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Por medio de pago                                                   │
│                                                                      │
│  Efectivo       $ 72.000  (38%)  ███████████████░░░░░░  ▲ +12%      │
│    −$ 12.000 egresos                                                 │
│  Tarjeta        $ 45.400  (24%)  █████████░░░░░░░░░░░░  ▼ -8%       │
│  Mercado Pago   $ 50.000  (27%)  ██████████░░░░░░░░░░░  ▲ +31%      │
│  Cuenta sueldos $ 20.000  (11%)  ████░░░░░░░░░░░░░░░░░  ═ =0%       │
└──────────────────────────────────────────────────────────────────────┘
```

- Fila `Efectivo` con subtag de egresos si `summary.cashExpenses > 0`. Esto resuelve el pain point "el summary de efectivo resta egresos sin decirlo": acá se ve explícito el bruto y el egreso como sustractivo.
- `% vs mismo día semana pasada` por método/cuenta. Misma lógica del hero (misma hora de corte).
- Click en una fila aplica filtro a la lista de tickets de abajo.
- La barra horizontal es proporción del día actual.

### 3. Buscador + filtros (sticky)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🔍 Buscar cliente o monto...   [Barbero ▾]  [Pago ▾]  [× Limpiar]   │
└──────────────────────────────────────────────────────────────────────┘
```

- Input de búsqueda: filtra `clientName` (contains, case-insensitive) o `amount` (match exacto o prefijo numérico). Resolución local sobre tickets ya cargados. Sin debounce (es local).
- Dropdown `Barbero`: todos los barberos activos de la(s) sucursal(es) visibles.
- Dropdown `Pago` con estructura jerárquica:
  ```
  Todos los pagos
  ──── Directo ────
    Efectivo
    Tarjeta
  ──── Cuentas (transfer) ────
    (cada cuenta activa de la sucursal)
  ──── Grupos ────
    Cuentas de sueldos (si existe ≥1 cuenta con is_salary_account)
  ```
- Botón `× Limpiar` aparece solo si hay filtros activos.
- Sin chips redundantes — el estado se ve en cada dropdown.

### 4. Lista de tickets agrupada por hora

- Headers de hora: `── 10:00 ── 5 tickets · $ 52.000 ──`. Se recalculan al aplicar filtros.
- Fila compacta (una línea + chip de pago):
  ```
  10:23  Juan Pérez · Nico     ✂ Corte + Barba · 🎁 Pomada      $ 3.200 [Efectivo]
  ```
- Click expande detalle (servicios/productos desglosados, "Contactar cliente").
- Footer sticky dentro de la lista cuando hay filtros: `Mostrando 8 de 14 · $ 72.000`.
- Empty state cuando la lista está vacía pero hay tickets del día (filtros excluyen todo): mensaje + botón `Limpiar filtros`.
- Empty state cuando no hay tickets del día en absoluto: estado distinto ("Todavía no se registraron cobros hoy").

### Elementos removidos de "Hoy"

- El bloque "Efectivo a rendir por barbero" → se mueve a `Cierre del día`.
- Botón "Exportar" → se mueve a `Historial` (con rango preconfigurable a "hoy").

## Tab "Historial"

### Barra superior

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🔍 Buscar cliente o monto...                                         │
│                                                                      │
│ [📅 1–15 abr ▾]  [Barbero ▾]  [Pago ▾]   [↓ Exportar]                │
│                                                                      │
│ Rápido:  [Ayer] [Últimos 7d] [Este mes] [Mes pasado]                 │
└──────────────────────────────────────────────────────────────────────┘
```

- **Buscador**: server-side sobre el rango activo. Debounce 350ms. Matchea cliente (ilike) o monto (eq numérico si parsea, else prefix-like sobre `amount::text`).
- **Date range picker**: popover con 2 `Input type="date"`; los shortcuts modifican ambos.
- **Shortcuts**: botones con estado visual activo cuando el rango seleccionado los matchea exactamente.
- **Límite de rango en la UI**: 60 días. Si el usuario elige más → toast "Elegí un rango menor a 60 días". El export CSV sí permite ilimitado.
- **Barbero / Pago**: mismos dropdowns que `Hoy`.
- **Exportar**: botón prominente, abre el `ExportDialog` existente con rango y filtros pre-cargados del estado actual.

### Resumen compacto del rango

Una fila estrecha arriba de la lista:
```
┌──────────────────────────────────────────────────────────────────────┐
│  Total: $ 2.450.000 · 187 tickets                                    │
│  Efectivo $ 920k (38%) · Tarjeta $ 630k (26%) · Transf $ 900k (36%) │
└──────────────────────────────────────────────────────────────────────┘
```
- Es resumen del rango activo, no del día.
- No se repite el hero del tab `Hoy` — aquí la lista es protagonista.

### Lista

- Agrupada por día: header `── Vie 18 abr · 14 tickets · $ 187.400 ──`.
- Dentro de cada día, tickets por hora descendente.
- Scroll infinito (lazy-load de 100 en 100). Detectar con `IntersectionObserver` sobre un sentinel al final.
- Cada ticket expandible igual que en `Hoy`.
- Empty state específico: "No se encontraron cobros para este período y filtros" + botón `Limpiar filtros`.

### Export

- Se conserva el flujo actual (CSV único o ZIP por barbero).
- El dialog ya no pide re-seleccionar filtros — pre-carga del estado de la barra.
- Nuevo checkbox `Incluir resumen por día`: si está activo, el CSV al final trae filas `TOTAL DIA YYYY-MM-DD` con subtotales agrupados por día (útil para pegar en Excel).

## Tab "Cierre del día"

Requiere sucursal seleccionada. Si no hay una (y la org tiene más de una), empty state:
> "Elegí una sucursal arriba para ver la rendición del día. El cierre de caja se hace por sucursal — cada encargado rinde sus barberos."

### Header del tab

```
┌──────────────────────────────────────────────────────────────────────┐
│  Cierre del viernes 19 abr · Sucursal Centro       [📅 19/04 ▾]      │
│                                                                      │
│  Estado: 2 de 4 barberos rindieron · $ 92.000 / $ 148.000            │
│  ████████████░░░░░░░░░░  62%                                         │
└──────────────────────────────────────────────────────────────────────┘
```
- Fecha default = hoy. Se puede retroceder con el picker.
- Barra de progreso: `confirmados / barberos con efectivo a rendir`.
- Totales: `sum(actual_amount de confirmados) / sum(expected para todos)`.

### Tarjetas por barbero

Una por barbero que haya cobrado al menos un ticket en efectivo en la fecha seleccionada + sucursal. Si no hubo cash de un barbero, no aparece (no tiene nada que rendir).

Estados posibles:

**Pendiente**
```
┌──────────────────────────────────────────────────────────────────────┐
│  👤 Nico Fernández                                        [Rendir]  │
│     7 tickets en efectivo · A rendir: $ 48.400                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Confirmado sin diferencia**
```
┌──────────────────────────────────────────────────────────────────────┐
│  👤 Nico Fernández ✓                                                 │
│     7 tickets · Rendido $ 48.400                                     │
│     Confirmado por Carlos · 19:42 · [Editar]                         │
└──────────────────────────────────────────────────────────────────────┘
```

**Confirmado con diferencia**
```
┌──────────────────────────────────────────────────────────────────────┐
│  👤 Nico Fernández ⚠                                                 │
│     A rendir $ 48.400 · Entregó $ 45.000                             │
│     Diferencia: −$ 3.400  · "Uso un vale adelantado"                 │
│     Confirmado por Carlos · 19:42 · [Editar]                         │
└──────────────────────────────────────────────────────────────────────┘
```

### Modal "Rendir"

Abierto desde el botón `[Rendir]` o `[Editar]`:

```
┌─────────────────────────────────────────────────┐
│  Rendir efectivo de Nico Fernández              │
│                                                 │
│  Tickets en efectivo: 7                         │
│  A rendir: $ 48.400                             │
│                                                 │
│  Monto entregado  [ $ 48.400 ]                  │
│                                                 │
│  Diferencia: $ 0                                │
│                                                 │
│  Nota (requerida si hay diferencia)             │
│  [                                            ] │
│                                                 │
│            [Cancelar]  [Confirmar rendición]    │
└─────────────────────────────────────────────────┘
```

- Monto entregado pre-cargado con `expected_amount`.
- Diferencia se recalcula en vivo al editar el monto, con color (verde / rojo / neutro).
- Si `abs(difference) > 0`, el campo Nota pasa a ser requerido (validación client + server).
- Confirmar dispara server action `confirmCashHandover`.

### Resumen final

Al final de la lista de barberos:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Resumen del día                                                     │
│                                                                      │
│  Total efectivo cobrado       $ 148.000                              │
│  Total efectivo rendido       $ 144.600                              │
│  Egresos en efectivo          −$ 12.000                              │
│  ───────────────                                                     │
│  Efectivo que debería quedar  $ 132.600                              │
│  Diferencias totales          −$ 3.400                               │
└──────────────────────────────────────────────────────────────────────┘
```

- `cobrado` = summary del día (sin egresos).
- `rendido` = suma de `actual_amount` de handovers confirmados.
- `egresos` = `summary.cashExpenses`.
- `debería quedar` = `rendido − egresos`.
- `diferencias` = suma de `actual_amount − expected_amount` (negativo si faltó, positivo si sobró).

## Cambios de datos

### Migración 113: `113_cash_handovers.sql`

```sql
-- Migración 113: tabla de rendiciones de efectivo por barbero/día.
-- Permite persistir el estado de "quién ya rindió" para el tab Cierre del día.

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

-- SELECT: miembros autenticados del dashboard de la misma org
create policy cash_handovers_select_same_org on cash_handovers
  for select using (
    organization_id in (
      select s.organization_id
      from staff s
      where s.auth_user_id = auth.uid() and s.is_active = true
    )
  );

-- INSERT / UPDATE: owner/admin o roles con permiso finances.reconcile_cash
-- La validación fina de branch_scope se hace en el server action (getScopedBranchIds).
-- Aquí solo se chequea org match.
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

-- Comentarios para documentación
comment on table cash_handovers is
  'Rendiciones de efectivo por barbero/día. Una fila representa la entrega de efectivo de un barbero al encargado al cierre del día. Ver src/lib/actions/caja.ts.';
comment on column cash_handovers.expected_amount is
  'Snapshot del efectivo cobrado por el barbero al momento de confirmar. No se recalcula si cambian visitas posteriormente.';
comment on column cash_handovers.difference is
  'actual_amount − expected_amount. Negativo = faltó; positivo = sobró.';
```

**Unique constraint**: `(branch_id, barber_id, handover_date)`. Un barbero rinde una vez por día por sucursal. Re-rendir = UPDATE (no insert duplicado). El server action usa `upsert` con `onConflict`.

**`expected_amount` como snapshot**: si después se anula un ticket de ese día, el `expected` almacenado no cambia. Si esto genera una inconsistencia, el encargado puede editar la rendición (hay `[Editar]`). Razón: el histórico debe reflejar el momento de la rendición.

**`difference` generada**: columna `generated always as ... stored` para queries rápidos sin cálculo en cliente.

**RLS**: scope por org en SELECT/INSERT/UPDATE. El enforcement de permisos y branch scope se hace en el server action (ver patrón de `caja.ts` existente, que valida `getScopedBranchIds()`).

### Permiso nuevo: `finances.reconcile_cash`

Agregar a `src/lib/permissions.ts` en la categoría `finances`:

```typescript
'finances.reconcile_cash': 'Confirmar rendición de efectivo de barberos',
```

Y la descripción:
```typescript
'finances.reconcile_cash': 'Permite confirmar que un barbero rindió el efectivo cobrado al cierre del día. Owner y admin siempre lo tienen.',
```

El tab `Cierre del día` es visible para quien tenga `finances.view_summary` (ya necesario para entrar a Caja). Pero el botón `Rendir` / `Editar` solo lo ve y usa quien tiene `finances.reconcile_cash` (u owner/admin).

## Server actions

### Modificadas en `src/lib/actions/caja.ts`

#### `fetchCajaSummary`

Extender para devolver, opcionalmente, comparativas:

```typescript
export interface CajaSummaryComparison {
  yesterday: number | null      // null si no hay datos
  lastWeek: number | null       // mismo día-de-semana, 7 días atrás
  byPaymentMethod: {
    method: string              // 'cash' | 'card' | 'transfer:<accountId>'
    current: number
    lastWeek: number | null
  }[]
}

export async function fetchCajaSummary(params: {
  branchId: string | null
  date: string
  compareAtHour?: number | null  // hora de corte para "mismo hora"; null = día completo
}): Promise<{
  data: CajaDailySummary
  comparison: CajaSummaryComparison | null
  error: string | null
}>
```

- Cuando `compareAtHour` viene, el servidor calcula los `start/end` de ayer y de hace 7 días usando esa hora como límite superior (con el timezone activo).
- Cuando `date` no es hoy, el cliente manda `compareAtHour = null` y el servidor compara contra días completos.
- La comparación de `byPaymentMethod` matchea por método directo y por `payment_account_id` para transferencias (mapea a `'transfer:<accountId>'`).

#### `fetchCajaTickets`

Agregar soporte para rangos y paginación (para el tab `Historial`):

```typescript
export async function fetchCajaTickets(params: {
  branchId: string | null
  startDate: string             // antes: date
  endDate: string               // nuevo; para backward-compat, si falta = startDate
  barberId?: string | null
  paymentMethod?: string | null
  paymentAccountId?: string | null
  search?: string | null        // nuevo: busca por cliente (ilike) o monto
  limit?: number | null         // nuevo: default 500 para Hoy; para Historial se controla desde cliente
  offset?: number | null        // nuevo: paginación infinita
}): Promise<{ data: CajaTicket[]; total: number; error: string | null }>
```

- `search`: si parsea como número, se agrega cláusula `.eq('amount', n)`; si no, `.ilike('clients.name', '%...%')` — pero ilike sobre joined cliente requiere que el filtro vaya sobre el select con `foreignTable`. Para simplificar, se puede resolver en dos queries: primero IDs de clientes que matchean, luego visits con `.in('client_id', ids)`. Decisión en implementación; ambas están OK.
- `total` devuelve el count completo del filtro (sin limit) para que el cliente muestre "187 resultados" aunque solo carguemos 100.

La firma actual (con `date` singular) debe seguir funcionando para no romper llamadas existentes; se puede aceptar `date` y mapear internamente a `startDate`/`endDate`.

### Nuevas en `src/lib/actions/caja.ts`

#### `fetchCashHandoverStatus`

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

export async function fetchCashHandoverStatus(params: {
  branchId: string
  date: string
}): Promise<{ data: CashHandoverStatus[]; error: string | null }>
```

- Agrega cash por barbero de `visits` (payment_method = 'cash') en la fecha.
- LEFT JOIN con `cash_handovers` para incluir estado.
- Solo devuelve barberos con cash > 0 del día (los que no cobraron efectivo no aparecen).

#### `confirmCashHandover`

```typescript
export async function confirmCashHandover(params: {
  branchId: string
  barberId: string
  date: string
  actualAmount: number
  notes: string | null
}): Promise<{ ok: boolean; error: string | null }>
```

Lógica:
1. Auth + `assertBranchAccess(branchId)`.
2. Chequear permiso `finances.reconcile_cash` (u owner/admin).
3. Calcular `expectedAmount` en el servidor (no confiar en el cliente) → suma `amount` de `visits` donde `branch_id=?`, `barber_id=?`, `payment_method='cash'`, `completed_at` en el bucket del día en timezone activo.
4. Validar: si `actualAmount !== expectedAmount` y `!notes?.trim()` → error "Nota requerida cuando hay diferencia".
5. Upsert en `cash_handovers` con `onConflict: 'branch_id,barber_id,handover_date'`. En insert: `confirmed_by = currentStaffId`, `confirmed_at = now()`. En update: preservar `confirmed_by/at` originales, actualizar `updated_by = currentStaffId`, `updated_at = now()`.
6. `revalidatePath('/dashboard/caja')`.

#### `revertCashHandover`

```typescript
export async function revertCashHandover(params: {
  handoverId: string
}): Promise<{ ok: boolean; error: string | null }>
```

- Solo owner/admin.
- Hard delete (pocos casos, y si hace falta se puede reinsertar).
- Alternativa considerada: soft delete con campo `reverted_at`. Descarto por simplicidad: si el encargado se equivocó, mejor borrar y rehacer.

## Cambios en el frontend

### Nueva estructura de archivos

```
src/app/dashboard/caja/
├── page.tsx                    # server component, fetch inicial para el tab por defecto
├── caja-client.tsx             # shell con tabs + header
├── tab-hoy.tsx                 # nuevo
├── tab-historial.tsx           # nuevo
├── tab-cierre.tsx              # nuevo
├── loading.tsx                 # se mantiene (adaptado)
└── components/
    ├── hero-card.tsx           # hero del tab Hoy
    ├── payment-split.tsx       # tabla de medios de pago con trend
    ├── ticket-list.tsx         # lista reusable (Hoy e Historial)
    ├── ticket-row.tsx          # extraído del actual TicketRow
    ├── cash-handover-card.tsx  # card por barbero en Cierre
    ├── handover-dialog.tsx     # modal de rendición
    ├── export-dialog.tsx       # extraído del actual
    ├── filter-bar.tsx          # buscador + dropdowns (reusable)
    └── live-indicator.tsx      # "● en vivo · actualizado hace Xs"
```

Razón para partir: el archivo actual tiene 886 líneas con múltiples responsabilidades. Al dividir por tab y componente, cada archivo queda bajo 300 líneas y se puede razonar sin tener que cargar todo el contexto.

### Hooks custom

- `useLiveRefresh(date, refreshFn, intervalMs = 30_000)`: gestiona el timer, pausa en background, expone `lastUpdatedAt`. Solo activo si `date === today`.
- `useDebouncedSearch(value, delay = 350)`: util reusable para el tab `Historial`.

### Página server component

```typescript
export default async function CajaPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const activeTab = (tab === 'historial' || tab === 'cierre') ? tab : 'hoy'

  // Fetch inicial según tab activo.
  // Tab 'hoy': summary + tickets del día + comparativas
  // Tab 'historial': default sin fetch (se hace al interactuar), solo resources de filtros
  // Tab 'cierre': fetchCashHandoverStatus si hay branch única

  // ... render <CajaClient initialTab={activeTab} initialData={...} />
}
```

### Loading states

- El `loading.tsx` se simplifica a un skeleton que respeta la estructura nueva (header + tabs + zona de carga común).
- Refetch en cliente (auto-refresh, cambio de tab, filtros) usa un indicador sutil en la live-indicator, no un loader pantalla-completa. Razón: no queremos "parpadeos" al auto-refresh.

## Plan de refactor del código existente

El archivo actual `caja-client.tsx` (886 líneas) se descompone según la estructura nueva. Se preserva:
- `fetchCajaTickets`, `fetchCajaSummary`, `fetchCajaCSVData` — APIs (evolucionadas con parámetros nuevos).
- Comportamiento de filtros (`cash`, `card`, `salary_accounts`, `acct:<id>`).
- Export CSV/ZIP flujo.

Se elimina:
- `BarberCashBreakdown` (se reemplaza por el tab `Cierre del día`).
- Chips redundantes de filtros.

## Fuera de scope (explícito)

- Registro de cobros **desde** caja. Se siguen creando desde fila/visita.
- Comparaciones contra meta/proyección/ticket promedio/ranking de barberos en el hero. El usuario marcó B-G-A como prioridades; el resto no.
- Drill-down desde un total agregado al detalle. Se puede hacer en iteración futura.
- Transfers entre cuentas visibles directamente. `transfer_logs` sigue influyendo en el summary pero no hay UI de edición en caja.
- Supabase Realtime sobre `visits`. El polling de 30s cumple.
- Multi-select de barberos en filtros. Un solo barbero por filtro, como hoy.

## Testing manual (verificación end-to-end)

Flujo que se testea después de implementar, en este orden:

1. **Tab Hoy con día = hoy**:
   - Abrir caja a mitad del día. Verificar que el hero muestra facturación actual con comparativas vs ayer y vs semana pasada (mismo horario de corte).
   - Esperar 30s sin hacer nada. Verificar que el "actualizado hace Xs" vuelve a "hace <5s" (se re-fetcheó).
   - Minimizar browser 2 min, volver. Verificar que se re-fetchea inmediatamente.
   - Apretar botón refresh manual. Verificar actualización.
   - Click en fila `Efectivo` del payment split → aplica filtro en tickets de abajo.
   - Buscar cliente por nombre parcial → filtra.
   - Buscar por monto → filtra.
   - Expandir un ticket → servicios y productos visibles, `Contactar cliente` funciona.
2. **Tab Hoy con día pasado** (date picker):
   - Comparativas muestran día completo (no "hasta la misma hora").
   - Indicador "en vivo" desaparece; auto-refresh se pausa.
3. **Tab Historial**:
   - Shortcuts `Ayer`, `Últimos 7d`, etc. funcionan y se marcan activos.
   - Rango > 60 días: muestra toast de aviso.
   - Buscador server-side con 350ms debounce.
   - Scroll infinito carga más tickets al llegar al final.
   - Export con filtros aplicados pre-carga el dialog correctamente.
   - Checkbox "Incluir resumen por día" agrega filas de subtotal al CSV.
4. **Tab Cierre**:
   - Sin branch seleccionada (org multi-branch): empty state forzando selección.
   - Con branch: aparecen solo barberos que cobraron efectivo ese día.
   - Click `Rendir` → modal con monto pre-cargado = esperado. Diferencia = 0, nota opcional.
   - Cambiar monto a distinto → diferencia en vivo, nota pasa a requerida.
   - Confirmar → card cambia a estado "confirmado", resumen del día se actualiza.
   - Re-abrir con `Editar` → modal trae valores guardados, permite modificar.
   - Como rol sin `finances.reconcile_cash`: no ve botones `Rendir/Editar`.
5. **Multi-branch**:
   - Cambiar branch en header → tabs se recargan con datos correspondientes.
   - Scope por rol: usuario con scope a sucursal X no ve datos de sucursal Y ni puede forzarlo por URL.
6. **Permisos**:
   - Sin `finances.view_summary`: no entra a la página.
   - Con `finances.view_summary` pero sin `finances.reconcile_cash`: ve el tab Cierre pero no puede confirmar.
   - Owner: todo.

## Migración/rollout

1. Merge migración 113.
2. Merge código nuevo.
3. Un deploy; la página se rediseña para todos los usuarios de la org al mismo tiempo. No hay feature flag porque el usuario prefiere cambio directo sobre los pain points marcados.

## Preguntas que quedaron abiertas al spec (usuario ya confirmó)

1. Auto-refresh 30s — confirmado.
2. Comparativas "a la misma hora de corte" — confirmado.
3. Agrupación por hora en Hoy, por día en Historial — confirmado.
4. Cierre forzando sucursal — confirmado.
5. Unique por (branch, barber, date) en handovers — confirmado.
6. Nuevo permiso `finances.reconcile_cash` (bajo categoría `finances`) — confirmado.
7. Rango máximo 60 días en Historial — confirmado.
8. Scroll infinito en Historial — confirmado.
