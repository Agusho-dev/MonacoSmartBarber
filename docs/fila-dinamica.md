# Fila Dinámica — Documentación del Sistema

> **Versión**: post-mig 131 (push-on-complete activo)
> **Última actualización**: 2026-05-09
> **Owners**: equipo de plataforma
> **Alcance**: queue de walk-ins (no incluye sistema de turnos/appointments — ese tema está en su propia documentación)

Este documento describe el funcionamiento end-to-end de la fila dinámica: modelo de datos, flujos, RPCs, componentes de UI, reglas de negocio, concurrencia y configuración. La sección final (§14) contiene el plan de cambios para Phase 2.

---

## 1. Resumen ejecutivo

La fila dinámica es el sistema que asigna **clientes walk-in** a **barberos** en una sucursal, en tiempo real. Cada cliente puede llegar:

- **Específico**: en el check-in elige un barbero concreto. El entry se inserta con `barber_id = ese barbero`.
- **Dinámico**: en el check-in elige "cualquiera". El entry se inserta con `barber_id = NULL` y vive en un pool compartido.

El sistema decide a quién va cada cliente en tres momentos:

1. **Al check-in** — solo se fija si es específico o dinámico; no se "asigna" todavía si es dinámico.
2. **Visualización en panel barbero** — cada panel rankea localmente quién debería ver el dinámico (pre-asignación visual no vinculante).
3. **Al iniciar el corte** — claim atómico server-side, único que mueve `barber_id` real. Dos paths:
   - **Push-on-complete (mig 131)**: cuando un barbero finaliza un corte, el server claim automáticamente el siguiente entry — sin tap manual.
   - **Manual ("Atender")**: el barbero toca el botón en su panel; el server hace el claim atómico.

La **atomicidad** la garantiza `FOR UPDATE SKIP LOCKED` de Postgres + un partial UNIQUE index (mig 127) que prohíbe que un barbero tenga dos `in_progress` simultáneos.

---

## 2. Glosario

| Término | Definición |
|---|---|
| **entry** | fila de `queue_entries`, representa "alguien en la fila" o un descanso. |
| **dinámico** | entry con `barber_id = NULL`. Vive en el pool, lo claim quien termine primero. |
| **específico** | entry con `barber_id = X`. Solo X puede atenderlo (o admin lo reasigna). |
| **ghost de descanso** | entry con `is_break = true`. Marca el descanso del barbero como un "cliente" que respeta el orden FIFO. |
| **claim atómico** | la transacción que mueve un entry de `waiting → in_progress` y le setea `barber_id` + `started_at`. |
| **fairness gate** | filtro server-side (mig 129) que bloqueaba el claim si el caller no era "el más justo". **Eliminado en mig 131.** |
| **push-on-complete** | modelo en el que el server reclama el siguiente entry automáticamente cuando un barbero finaliza. |
| **Mi fila** | la sección del panel barbero que muestra solo los entries asignados a ese barbero (incluye pre-asignaciones locales de dinámicos). |
| **Fila general** | vista admin del dashboard `/dashboard/fila` con todos los entries de todas las sucursales del scope. |

---

## 3. Modelo de datos

### 3.1 Tabla `queue_entries` (campos relevantes)

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | PK |
| `branch_id` | UUID | sucursal donde vive el entry |
| `client_id` | UUID nullable | NULL para ghost de descanso |
| `barber_id` | UUID nullable | NULL = dinámico (en pool) |
| `service_id` | UUID nullable | servicio elegido al check-in (si lo hubo) |
| `appointment_id` | UUID nullable | si proviene de un turno reservado |
| `position` | INTEGER | orden visual del drag&drop, NO ordena el claim |
| `priority_order` | TIMESTAMPTZ | **el verdadero orden FIFO**. Default = `now()` al insert |
| `status` | TEXT | `waiting` \| `in_progress` \| `completed` \| `cancelled` |
| `is_dynamic` | BOOLEAN | atajo de `barber_id IS NULL` (denormalizado) |
| `is_break` | BOOLEAN | `true` para ghost de descanso |
| `is_appointment` | BOOLEAN | `true` si viene de un turno (no compite con walk-ins) |
| `checked_in_at` | TIMESTAMPTZ | cuándo entró a la fila |
| `started_at` | TIMESTAMPTZ | cuándo empezó el corte |
| `completed_at` | TIMESTAMPTZ | cuándo finalizó |
| `paused_at` | TIMESTAMPTZ | si está pausado |
| `paused_duration_seconds` | INTEGER | acumulado de pausas previas |
| `reward_claimed` | BOOLEAN | el cliente quiere canjear puntos |

### 3.2 Índices y restricciones críticos

```
-- Mig 127: defensa estructural — un solo in_progress por barbero
CREATE UNIQUE INDEX idx_queue_one_in_progress_per_barber
  ON queue_entries (barber_id)
  WHERE status = 'in_progress' AND barber_id IS NOT NULL;

-- Mig 127: lookup O(1) para Guard 0a (descanso activo)
CREATE INDEX idx_queue_active_break_per_barber
  ON queue_entries (barber_id, branch_id)
  WHERE is_break = true AND status = 'in_progress';
```

### 3.3 Tablas relacionadas

| Tabla | Para qué |
|---|---|
| `branches` | sucursal: `timezone`, `organization_id`, `operation_mode` |
| `staff` | barberos: `is_active`, `hidden_from_checkin`, `role`, `is_also_barber` |
| `staff_schedules` | bloques horarios por día de la semana |
| `attendance_logs` | clock_in / clock_out por barbero |
| `appointment_staff` | `walkin_mode` (si está en `appointments_only`, no toma walk-ins) |
| `appointment_settings` | `buffer_minutes` para ventana de protección por turno |
| `appointments` | turnos confirmados que protegen la ventana del barbero |
| `app_settings` | `shift_end_margin_minutes`, `next_client_alert_minutes`, `dynamic_cooldown_seconds` |
| `visits` | registro post-corte, creado por trigger al pasar status → completed |
| `break_requests` | ciclo de aprobación de descansos (genera el ghost en `queue_entries`) |

---

## 4. Estados de un entry

```
                         ┌─────────────┐
                         │  (insert)   │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
       ┌─────────────────│  waiting    │──────────────┐
       │  cancelQueueEntry           claim_next_for_  │
       │                              barber          │
       ▼                                              ▼
┌─────────────┐                                ┌─────────────┐
│  cancelled  │                                │ in_progress │
└─────────────┘                                └──────┬──────┘
                                                      │
                                       completeService│
                                                      │
                                                      ▼
                                                ┌─────────────┐
                                                │  completed  │
                                                └─────────────┘
```

Transiciones permitidas (lo que no se permite produce 23505 o errores de aplicación):

- `waiting → in_progress` solo vía `claim_next_for_barber` o `startService` (admin).
- `in_progress → completed` solo vía `completeService` (que dispara trigger → crea visit).
- `* → cancelled` vía `cancelQueueEntry` o `deactivateBarber` (cancela ghosts del barbero).
- **No se permite** revertir `completed → in_progress` (las visitas históricas no deben ocupar slots vivos).

---

## 5. Flujos end-to-end

### 5.1 Check-in (kiosk `/(tablet)/checkin`)

**Server action**: `checkinClient` ([`src/lib/actions/queue.ts:10`](../src/lib/actions/queue.ts))

```
Cliente toca "Check-in" en kiosk
  ├─ Rate limit: 20 check-ins / branch / 60s
  ├─ Lookup branches.organization_id (validación de sucursal activa)
  ├─ find-or-create cliente por (phone, organization_id)
  ├─ Si ya está en queue activa → return alreadyInQueue
  ├─ next_queue_position(branch) → siguiente position
  └─ INSERT queue_entries:
      ├─ barber_id = NULL si "cualquiera" (dinámico)
      ├─ priority_order = NOW()
      ├─ is_dynamic = !barber_id
      └─ status = 'waiting'
```

Variantes:
- `checkinClientByFace` — mismo flujo pero el cliente se identifica por reconocimiento facial.
- Reintroducción: si la unique constraint `(client_id, branch_id, status_active)` choca, devuelve la entry existente sin error.

### 5.2 Visualización en panel barbero

**Componente**: `QueuePanel` ([`src/components/barber/queue-panel.tsx`](../src/components/barber/queue-panel.tsx))

```
fetchQueue (Realtime + visibility refresh)
  └─ SELECT queue_entries
       WHERE branch_id = mi_sucursal AND status IN ('waiting', 'in_progress')
       (sin loyalty count para evitar N+1)

assignDynamicBarbers (cliente local, barber-utils.ts:295)
  ├─ Para cada entry dinámica (waiting + barber_id IS NULL):
  │    ├─ Filtra barberos elegibles localmente
  │    └─ Asigna localmente al "más justo" (criterio ETA)
  └─ Marca con _is_dynamically_assigned = true

myWaitingEntries
  └─ Filter: e.barber_id === self
       (Pre-mig 131 había un filtro extra `_is_dynamically_assigned && fairBarberId !== self`
        que causaba el limbo. Removido.)

Render:
  - Active client card (si hay in_progress no-break)
  - Active break card (si hay in_progress break)
  - Mi fila (waiting asignados o pre-asignados localmente)
  - Fila general (todos los waiting de la sucursal, vista de awareness)
```

**Realtime**: el panel suscribe a `queue_entries`, `staff` y `break_requests` filtrados por `branch_id`. Cada evento dispara `fetchQueue + refreshStats + fetchAssignmentData` — refresh full, no incremental.

### 5.3 Atender un cliente (manual)

**Disparador**: el barbero tap el botón ▶ sobre un entry waiting de "Mi fila".

**Server action**: `attendNextClient` ([`src/lib/actions/queue.ts:159`](../src/lib/actions/queue.ts))

```
Panel.handleStartService(entryId)
  └─ attendNextClient(barber, branch, preferredEntryId = entryId)
       └─ RPC claim_next_for_barber(barber, branch, preferredEntryId)
              ├─ Guard 0a: ¿barbero en descanso activo? → return vacío
              ├─ Guard 0b: ¿ghost listo? → start break, return (entry, is_break=true)
              ├─ ¿walkin_mode = appointments_only? → return vacío
              ├─ ¿turno inminente dentro de 55min? → return vacío
              ├─ Path preferred:
              │    SELECT preferredEntryId FOR UPDATE SKIP LOCKED
              │    Si encuentra: UPDATE → in_progress, started_at = NOW
              │                  return (entry, is_break=false, was_dynamic=...)
              └─ Fallback FIFO:
                  SELECT oldest waiting (mío o dinámico) FOR UPDATE SKIP LOCKED
                  UPDATE → in_progress
                  return (entry, ...)
       └─ revalidatePath /barbero/fila + /dashboard/fila
       └─ return { success, entryId, breakStarted?, wasDynamic? }

Panel ve el response:
  ├─ Si entryId: el cliente activo aparece automáticamente vía Realtime
  ├─ Si breakStarted: la break card aparece automáticamente
  └─ Si null: toast "No hay clientes en espera"
```

### 5.4 Push-on-complete (mig 131, modelo nuevo)

**Disparador**: el barbero finaliza un corte y cobra.

```
Panel: tap "Finalizar" → CompleteServiceDialog abre
Dialog: cobra → completeService(entryId, payment, ...)

completeService (queue.ts:259)
  ├─ Step 1:  UPDATE entry → completed, completed_at = NOW
  │             (trigger crea visits row con amount=0 placeholder)
  ├─ Step 1b: si appointment_id → marca appointment como completed
  ├─ Step 2-4: calcula amount, comisiones, products, prepayments → UPDATE visit
  ├─ Step 5:  reward redemption (si aplica)
  ├─ Step 6:  PUSH-ON-COMPLETE — RPC claim_next_for_barber
  │           ├─ El RPC decide: ghost listo, asignado, o dinámico FIFO
  │           ├─ Marca status='in_progress' atómicamente
  │           └─ Retorna (entry_id, is_break, was_dynamic) o vacío
  ├─ Step 6.5: si claim retornó un entry no-break → SELECT campos mínimos
  ├─ Step 7:  post-service automation (workflows WhatsApp, scheduled_messages)
  ├─ Step 8:  salary_reports (comisiones del día)
  └─ return { success, visitId, breakAutoStarted, next: { id, client_id, service_id, barber_id } | null }

Dialog: pasa result.next a onCompleted callback

QueuePanel.onCompleted(next)
  ├─ Si next && next.barber_id === self:
  │    ├─ setEntries optimistic: filtra el completado, agrega placeholder con next
  │    └─ (elimina flicker entre "cobré" y "siguiente activo")
  ├─ fetchQueue → reconcilia con datos reales
  └─ refreshStats → actualiza contador y revenue del día
```

**Resultado**: el barbero ve **el siguiente cliente activo** sin tap manual. Reduce 30-90s de idle por corte.

### 5.5 Cancelación

`cancelQueueEntry(id)` — UPDATE → status='cancelled'. No dispara claim del siguiente.

### 5.6 Reasignación

- `reassignBarber(entryId, newBarberId)` — admin desde dashboard, drag&drop.
- `reassignMyBarber(entryId, newBarberId)` — kiosk, cliente cambia de barbero.
- `updateQueueOrder(updates[])` — admin reordena vía drag&drop, RPC `batch_update_queue_entries`.

### 5.7 Descansos (ghost rows)

Cuando un descanso se aprueba (`break_requests` con status='approved'), se inserta un ghost row en `queue_entries`:

```
ghost = {
  is_break: true,
  barber_id: <barbero>,
  client_id: NULL,
  status: 'waiting',
  priority_order: NOW + cuts_before_break * avg_cut_minutes
                  // (la posición efectiva en su fila personal)
}
```

El ghost compite con clientes asignados al mismo barbero por `priority_order`. Cuando el barbero termina su corte:
- Si hay clientes asignados con priority menor → toman precedencia.
- Si no → el ghost arranca (status='in_progress' → barbero en descanso).

Un ghost en `in_progress` bloquea al barbero (Guard 0a en `claim_next_for_barber`).

---

## 6. RPCs y server actions

### 6.1 `claim_next_for_barber` — PRIMARIO (mig 131)

**Firma**:
```sql
claim_next_for_barber(
  p_barber_id UUID,
  p_branch_id UUID,
  p_preferred_entry_id UUID DEFAULT NULL
) RETURNS TABLE(entry_id UUID, is_break BOOLEAN, was_dynamic BOOLEAN)
```

**Comportamiento**: claim atómico + arranque del próximo entry. Decide entre ghost de descanso listo, cliente asignado o dinámico FIFO. **Sin fairness gate** — la atomicidad la garantiza `FOR UPDATE SKIP LOCKED`.

**Guards aplicados (en orden)**:
1. Si barbero en descanso activo → vacío.
2. Si ghost waiting "listo" (sin clientes asignados con priority menor) → arranca el ghost.
3. Si `walkin_mode = 'appointments_only'` → vacío.
4. Si turno inminente dentro de `45 + buffer_minutes` → vacío.
5. Path preferred (si `p_preferred_entry_id` viene): claim ese entry si existe waiting.
6. Fallback FIFO: claim oldest waiting (mío o dinámico) excluyendo ones con priority ≥ ghost priority.

**Returns**: 0 ó 1 fila. Vacío significa "nada elegible para este barbero ahora".

**Llamado desde**: `completeService` (push-on-complete) y `attendNextClient` (manual).

### 6.2 `assign_next_client` — LEGACY (sin fairness gate, mig 131)

**Firma**:
```sql
assign_next_client(p_barber_id UUID, p_branch_id UUID, p_preferred_entry_id UUID) RETURNS UUID
```

**Comportamiento**: equivalente a `claim_next_for_barber` pero **solo hace el claim** (no setea status='in_progress'). Mantenida por compatibilidad. **No quedan callers en código TS** después del refactor de mig 131; sobrevive solo como defensa por si quedó algún path olvidado.

**Plan**: dropearla en una mig de limpieza posterior si confirmamos que no hay callers.

### 6.3 `compute_fair_barber` y `get_fair_barber` — UTILIDADES (mig 129/130, sin enforcing)

**Firma**:
```sql
compute_fair_barber(p_branch_id UUID, p_branch_tz TEXT) RETURNS UUID
get_fair_barber(p_branch_id UUID) RETURNS UUID  -- wrapper que resuelve TZ
```

**Estado actual**: vivas pero **sin uso enforcing** en el path crítico. `claim_next_for_barber` no las llama. `assign_next_client` tampoco después de mig 131. Pueden seguir siendo útiles para Phase 2 (hints de UI, ETA proyectado en el pool).

### 6.4 Server actions principales (`src/lib/actions/queue.ts`)

| Function | Llamada por | Hace |
|---|---|---|
| `checkinClient(formData)` | kiosk | inserta entry waiting |
| `checkinClientByFace(...)` | kiosk con face match | idem |
| `startService(entryId, barberId)` | dashboard fila | UPDATE → in_progress (admin override) |
| `attendNextClient(barberId, branchId, preferredEntryId?)` | barber panel | RPC claim_next_for_barber |
| `completeService(entryId, payment, ...)` | barber panel | finaliza + push-on-complete |
| `cancelQueueEntry(id)` | barber/dashboard | cancela |
| `reassignBarber(id, newBarberId)` | dashboard | reasigna |
| `reassignMyBarber(id, newBarberId)` | kiosk | reasigna desde cliente |
| `updateQueueOrder(updates)` | dashboard | drag&drop reorder |
| `pauseActiveService(id)` | barber panel | pausa el corte |
| `resumeActiveService(id)` | barber panel | reanuda |
| `createBreakEntry(branchId, barberId, name)` | barber panel | crea ghost de descanso |

---

## 7. UI y componentes

### 7.1 Panel barbero (`/barbero/fila`)

**Stack**: server component → cookie auth → `QueuePanel` (client).

**Componentes**:
- `QueuePanel` — orchestrator, suscribe Realtime
- `ActiveClientCard` / `ActiveBreakCard` — current in_progress
- `BarberTimeline` — ETA y proyección
- `NextClientAlert` — alerta sonora si idle > N min con clientes esperando
- `CompleteServiceDialog` — modal de cobro (2 pasos: detalles + payment)
- `BarberStatsBar` — cortes hoy + revenue

### 7.2 Dashboard (`/dashboard/fila`)

**Componente**: `FilaClient` — kanban horizontal (columnas: breaks, dynamic pool, una por barbero).

**Capacidades admin**:
- drag&drop entre columnas (reasigna barbero)
- arrastrar template de descanso a un barbero (crea ghost)
- iniciar corte manualmente (botón ▶)
- finalizar corte (mismo `CompleteServiceDialog`)
- cancelar entry

### 7.3 TV display (`/tv`)

Vista pública read-only. Muestra colas activas, ETAs, ranking de barberos. Refresca por Realtime.

### 7.4 Check-in kiosk (`/(tablet)/checkin`)

Multi-paso: branch → service → cliente identificación → barbero (o "cualquiera") → confirm.

---

## 8. Reglas de negocio (guards)

Todos aplicados server-side en `claim_next_for_barber`. La UI puede replicarlos para preview pero la decisión final es server.

| # | Guard | Causa |
|---|---|---|
| 0a | Descanso activo (`is_break=true && in_progress`) | el barbero está en pausa, no recibe nada |
| 0b | Ghost listo + sin clientes asignados antes | el descanso DEBE arrancar primero |
| 1 | `walkin_mode = 'appointments_only'` | el barbero solo atiende turnos reservados |
| 2 | Turno inminente dentro de `45 + buffer` min | proteger el turno reservado |
| 3 | Entry con priority ≥ ghost priority | ghost waiting siempre gana al claim |

**Sutiles, no son guards estrictos pero afectan**:
- `is_appointment = true` queda fuera del pool walk-in (vienen del flujo de turnos).
- `(checked_in_at AT TIME ZONE branch_tz)::DATE = today_local` — solo entries del día actual local. Entries de ayer no se asignan.

---

## 9. Concurrencia y atomicidad

### 9.1 Garantías

- **Solo un barbero gana**: `FOR UPDATE SKIP LOCKED` en el SELECT que precede al UPDATE → si dos transacciones intentan el mismo entry, una lo lockea, la otra salta al siguiente.
- **Un solo `in_progress` por barbero**: partial UNIQUE `idx_queue_one_in_progress_per_barber` (mig 127). Si por error dos UPDATEs intentan dejar dos in_progress al mismo barbero → 23505 unique_violation. La aplicación maneja el error. Defensa estructural.
- **Trigger crea visit** al pasar a `completed`: idempotente, una vez por entry.

### 9.2 Race conditions cubiertas

| Escenario | Resolución |
|---|---|
| 2 barberos finalizan al mismo tiempo y ambos quieren el mismo dinámico | SKIP LOCKED elige uno; el otro recibe vacío y retorna toast informativo. |
| Barbero A toca "Atender" mientras B termina y dispara push-on-complete | Las dos transacciones compiten por el lock; gana una, la otra recibe vacío. |
| Cliente se da de baja mientras un barbero hace claim sobre él | El UPDATE incluye `AND status = 'waiting'` — si ya cambió, 0 rows affected y el RPC retorna vacío. |
| Doble click en "Finalizar" | El UPDATE de `completeService` filtra por `status = 'in_progress'`. Segunda llamada falla silenciosa. |

### 9.3 Race conditions NO cubiertas (deuda técnica conocida)

- **Realtime delay**: si el panel A no recibió el evento de "B tomó el cliente" antes de mostrar la UI, A puede tener stale state. El claim atómico server-side filtra correctamente, pero la UX puede mostrar un toast tardío. Aceptable.

---

## 10. Configuración

### 10.1 `app_settings` (org-scope)

| Campo | Default | Uso |
|---|---|---|
| `shift_end_margin_minutes` | 35 | margen para bloquear barbero al fin de turno (cliente lo aplica en pre-asignación; servidor NO lo aplica en `claim_next_for_barber`) |
| `next_client_alert_minutes` | 5 | tras cuántos min idle el panel barbero suena alerta |
| `dynamic_cooldown_seconds` | 120 | unused actualmente (`_cooldownMs` con prefijo `_`) |

### 10.2 `appointment_settings` (org/branch-scope)

| Campo | Default | Uso |
|---|---|---|
| `buffer_minutes` | 10 | sumado a `45` (avg corte) para la ventana de protección por turno inminente |

### 10.3 `staff` flags

- `is_active` — soft-delete del barbero
- `hidden_from_checkin` — el kiosk no lo lista (pero sigue elegible si aparece en otros paths)
- `role IN ('barber', ...)` o `is_also_barber = true` — solo estos pueden tomar walk-ins
- `walkin_mode` (en `appointment_staff`) — si es `'appointments_only'` no toma walk-ins

---

## 11. Realtime sync

**Suscripciones del panel barbero** (filtradas por `branch_id`):

| Tabla | Reacción |
|---|---|
| `queue_entries` | `fetchQueue + refreshStats + fetchAssignmentData` |
| `staff` | `fetchBarbersAndSchedules + fetchHiddenStatus` |
| `break_requests` | `fetchBreakRequestStatus + fetchPendingBreakRequests` |

**Tablas excluidas de la publication** `supabase_realtime` (mig 124, post-incidente DB saturada):
- `attendance_logs` — alta tasa de UPDATE, fanout cross-branch
- `break_requests` — antes incluida sin filtro, ahora filtrada por branch en el subscribe

**Visibility refresh**: cuando el panel vuelve al foreground, hace `fetchQueue + refreshStats` cada 30s como fallback si Realtime falla.

---

## 12. Cronología de migraciones

| Mig | Fecha | Cambio | Estado |
|---|---|---|---|
| 119 | 2026-04-15 | sistema de turnos: `branches.operation_mode`, EXCLUSION GiST, RPCs core | activo |
| 120 | — | `staff_schedules.branch_id` nullable, exception_type | activo |
| 121 | — | cron mark_no_show_overdue | activo |
| 123 | 2026-04-30 | índices de emergencia post-incidente DB | activo |
| 124 | 2026-04-30 | realtime publication cleanup | activo |
| 125 | 2026-05-01 | loyalty skip anonymous visits | activo |
| 127 | 2026-05-04 | block_break_barbers_from_queue: Guard 0a + partial UNIQUE | activo |
| 128 | 2026-05-04 | assign_next_client respeta pending break (Guard 0b) | activo |
| 129 | 2026-05-07 | fairness gate (Guard 0c) — **causó el bug del 9-may** | revertido por 131 |
| 130 | 2026-05-07 | get_fair_barber wrapper público | viva pero sin enforcing |
| **131** | **2026-05-09** | **push-on-complete + revert fairness gate** | **activo** |
| 131b | 2026-05-09 | fix `#variable_conflict use_column` en claim_next_for_barber | activo |

---

## 13. Estado conocido y deuda técnica

### Resuelto en mig 131
- ✅ Bug "dinámico invisible cuando rankings divergen" — eliminado por reverter fairness gate.
- ✅ Idle time entre cortes de 30-90s — eliminado por push-on-complete.
- ✅ Doble cómputo de fair_barber (cliente + server) — eliminado el cliente, server queda como utility.

### Aún pendiente (Phase 2)
- ⚠ **Pre-asignación local visual sigue siendo naïve**: usa ETA con `avg = 25min` global, no por barbero/servicio.
- ⚠ **FIFO estricto**: si llega cliente "corte simple 15min" y otro "color+corte 90min" en orden inverso, FIFO procesa el largo primero, degradando P50 del cliente corto.
- ⚠ **`shift_end_margin_minutes` ciego al servicio**: bloquea al barbero por tiempo absoluto, no por duración estimada del cliente.
- ⚠ **Sin contrato compartido entre cliente y server** (si re-introducimos algún ranking, hay que blindarlo con tests).
- ⚠ **`compute_fair_barber` y `get_fair_barber` sobreviven sin uso real** — deuda de limpieza.

### Otras deudas más pequeñas
- `dynamic_cooldown_seconds` está en config y se lee, pero el `_cooldownMs` en `assignDynamicBarbers` tiene prefijo `_` (unused). Decidir o aplicar.
- `assignmentTimeRef` se rebumba a `Date.now()` localmente; dos paneles pueden tener `now` ligeramente distintos. No genera bugs visibles (los ETAs solo difieren en sub-segundo) pero es una asimetría.
- `priority_order` se puede manipular con drag&drop desde `/dashboard/fila`. Se ha visto en prod entries con priority de horas atrás aunque su `checked_in_at` es reciente — efecto secundario de reorderings. No es bug, pero confunde el debug.

---

## 14. Plan Phase 2 — Cambios planeados

> **Objetivo medible**: reducir P50 de wait_time de ~6 min a ~3-4 min, y P95 de ~25 min a ~12-15 min, sin sacrificar fairness inter-barbero.

### 14.1 Predicción de duración por (barbero, servicio, cliente)

**Problema**: hoy `avg = 25min` global. Esto distorsiona ETA y bloquea barberos sin contexto.

**Solución**: vista materializada `barber_service_duration_stats` con cascada:

```sql
CREATE MATERIALIZED VIEW barber_service_duration_stats AS
SELECT
  branch_id,
  barber_id,
  service_id,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_min) AS median_duration_min,
  COUNT(*) AS sample_size,
  MAX(completed_at) AS last_sample_at
FROM (
  SELECT branch_id, barber_id, service_id,
         EXTRACT(EPOCH FROM (completed_at - started_at)) / 60 AS duration_min,
         completed_at
  FROM visits
  WHERE started_at IS NOT NULL
    AND completed_at IS NOT NULL
    AND completed_at >= NOW() - INTERVAL '90 days'
    AND EXTRACT(EPOCH FROM (completed_at - started_at)) / 60 BETWEEN 5 AND 180
) v
GROUP BY 1, 2, 3
HAVING COUNT(*) >= 3;
```

Refresh: cada hora vía pg_cron.

**Función de lookup**:
```sql
predicted_duration_minutes(branch_id, barber_id, service_id, client_id) RETURNS INTEGER
-- Cascada:
--   1. Mediana de últimas 5 visitas de (cliente, barbero, servicio)
--   2. Mediana de últimas 10 visitas de (barbero, servicio)
--   3. Mediana de últimas 20 visitas de (servicio)
--   4. services.duration_minutes
--   5. Fallback 25 min
```

**Donde se usa**: ETA del cliente en kiosk/TV, ETA del panel barbero, scoring de claim (§14.3), decisión de shift_end (§14.4).

### 14.2 Pool dedicado para dinámicos en panel barbero

**Problema**: hoy "Mi fila" mezcla pre-asignaciones locales de dinámicos con asignados reales. Si dos paneles disagree localmente, el dinámico aparece dos veces.

**Solución**: separar visualmente.

```
Panel barbero — layout propuesto:

┌──────────────────────────────────────────┐
│ Active client / break                    │
└──────────────────────────────────────────┘

┌─ MI FILA (asignados específicos) ────────┐
│  • Juan        ETA 25min                 │
│  • Pedro       ETA 50min                 │
└──────────────────────────────────────────┘

┌─ POOL DINÁMICO (compartido)──────────────┐
│  • Mariano     esperando 32min  [Tomar] │ ← cualquier barbero puede tap
│  • Franco      esperando 8min   [Tomar] │
└──────────────────────────────────────────┘
```

**Comportamiento**:
- "Mi fila" muestra **solo entries con `barber_id === self`**. Sin pre-asignación visual de dinámicos.
- "Pool" muestra **todos los dinámicos** del branch, con tiempo de espera y un botón "Tomar".
- "Tomar" llama a `claim_next_for_barber(self, branch, entryId)` — atómico.
- Al finalizar un corte (push-on-complete), el server claim de Mi fila primero (si hay), si no del Pool por FIFO.

**Beneficio adicional**: el cliente ve cuánto lleva esperando cada uno → motivación social para tomar dinámicos.

### 14.3 WSJF (Weighted Shortest Job First) en el pool

**Problema**: FIFO puro castiga clientes con servicios cortos cuando llega un servicio largo antes.

**Solución**: scoring híbrido en `claim_next_for_barber` cuando elige del pool dinámico.

```sql
score(entry, barber) =
    aging_factor(entry)        -- urgencia por tiempo de espera
  - duration_penalty(entry, barber)  -- favorece servicios cortos
  + fifo_bias(entry)           -- empate FIFO

aging_factor(entry):
  CASE
    WHEN waited_min > 30 THEN 1000  -- nadie debe esperar >30min
    WHEN waited_min > 15 THEN 100   -- urgencia moderada
    ELSE waited_min
  END

duration_penalty(entry, barber):
  predicted_duration_minutes(branch, barber, entry.service_id, entry.client_id)

fifo_bias(entry):
  EXTRACT(EPOCH FROM (NOW() - entry.priority_order)) / 1000  -- desempate, peso bajo
```

**Selección**: `ORDER BY score DESC LIMIT 1`.

**Garantía**: ningún cliente espera más de 30min mientras hay barbero disponible (aging dispara al tope).

### 14.4 `shift_end` consciente del servicio

**Problema**: `is_barber_blocked_by_shift_end` bloquea barberos por tiempo absoluto. Un barbero a 19min del fin de turno con un cliente de 15min disponible → se descarta.

**Solución**: en `claim_next_for_barber`, evaluar elegibilidad por barbero+servicio:

```sql
shift_end_eligible(barber, branch, predicted_duration):
  shift_remaining_min := minutes_until_last_block_end(barber, branch)
  margin_min := app_settings.shift_end_margin_minutes
  RETURN shift_remaining_min >= predicted_duration + margin_min
```

Aplicado a cada entry candidato:
- Si `shift_remaining < predicted_duration(servicio) + margin` → ese barbero no toma este entry específico (pero puede tomar otros más cortos).
- Si `shift_remaining < margin_min mínimo absoluto (e.g. 5min)` → no toma nada.

### 14.5 Test compartido cliente↔server

**Problema**: si Phase 2 reintroduce algún ranking client-side (e.g., para previewizar el WSJF), divergencias silenciosas pueden volver a romper la UX.

**Solución**: fixture compartido + tests ejecutables.

```
src/lib/queue-ranking/
├── ranking.test.ts        ← tests con fixtures
├── ranking.ts             ← TS impl que wrappea el RPC
└── fixtures/
    └── snapshot-N.json    ← estados completos (entries, barbers, schedules, ...)
```

Cada fixture genera un snapshot determinístico:
- Inserta data en una branch de Supabase efímera
- Llama al RPC server
- Llama a la función TS local
- Compara: deben dar el mismo `entry_id` ganador

Snapshots cubren:
- Empate exacto (load=load, busy=busy, last=last)
- Solo un elegible
- Pool vacío
- Ghost ready
- Turno inminente
- Multi-sucursal noise

### 14.6 Limpieza

- **Drop `compute_fair_barber` y `get_fair_barber`** después de Phase 2 si `pg_stat_user_functions` muestra 0 calls/semana.
- **Drop `assign_next_client`** si el grep en codebase no encuentra callers.
- **Eliminar `_cooldownMs` y `dynamic_cooldown_seconds`** si decidimos que no aporta.

### 14.7 Migraciones planeadas

| Mig | Cambio |
|---|---|
| 132 | `barber_service_duration_stats` MV + función `predicted_duration_minutes` + cron refresh |
| 133 | `claim_next_for_barber` v2 con WSJF + service-aware shift_end |
| 134 | UI: pool dedicado + remover pre-asignación local de dinámicos |
| 135 | Test fixtures + CI integration |
| 136 | Drop de utilities legacy (compute_fair_barber, get_fair_barber, assign_next_client) |

### 14.8 Métricas de éxito

Antes de Phase 2, capturar baseline (1 semana):

```sql
-- P50 / P95 wait_time = started_at - checked_in_at por entry
-- idle_time_per_barber = sum(gaps entre completed_at y siguiente started_at)
-- claim_failure_rate = % de attendNextClient que retornan vacío en presencia de dinámicos
```

Goal post-Phase 2:
- P50 wait_time: -50%
- P95 wait_time: -40%
- Idle time per barber per shift: -70%
- Claim failure rate: ~0%

Capturar las métricas en una vista nueva `queue_metrics_daily` y comparar pre/post.

---

## Apéndice A — Decisiones clave y por qué

| Decisión | Por qué |
|---|---|
| FIFO por `priority_order` y no `position` | `position` es UI-only, se reordena con drag&drop. `priority_order` es estable y semántico (timestamp del check-in). |
| Push-on-complete como modelo dominante | Elimina dead time post-corte y el bug de "dinámico invisible". El claim atómico server-side es suficiente para fairness. |
| Sin fairness gate en `claim_next_for_barber` | El gate trade-off de mig 129 fue "evitar duplicación visual a costa de hacer invisible cuando rankings divergen". El precio era inaceptable. La duplicación visual transitoria se resuelve naturalmente con SKIP LOCKED + toast. |
| `is_break` ghost en lugar de un campo en staff | Mantiene FIFO global respetando los `cuts_before_break` aprobados. Permite que el descanso "compita" con clientes asignados. |
| `claim_next_for_barber` usa `#variable_conflict use_column` | Resuelve la ambigüedad entre OUT param `is_break` y columna `queue_entries.is_break` sin renombrar todo. |
| Auto-refresh por Realtime full vs incremental | Simplicidad. Bajo volumen actual (~50 entries/día/branch) es soportable. Si crece, considerar diff updates. |

## Apéndice B — Referencias rápidas

- Migración 131 (active fix): [`supabase/migrations/131_push_on_complete_root_fix.sql`](../supabase/migrations/131_push_on_complete_root_fix.sql)
- Server actions: [`src/lib/actions/queue.ts`](../src/lib/actions/queue.ts)
- Panel barbero: [`src/components/barber/queue-panel.tsx`](../src/components/barber/queue-panel.tsx)
- Dashboard fila: [`src/app/dashboard/fila/fila-client.tsx`](../src/app/dashboard/fila/fila-client.tsx)
- Utilidades de ranking client-side: [`src/lib/barber-utils.ts`](../src/lib/barber-utils.ts)
- Diálogo de cobro: [`src/components/barber/complete-service-dialog.tsx`](../src/components/barber/complete-service-dialog.tsx)
- Incidente del 30-abr-2026 (saturación DB, contexto del por qué de mig 124): [`docs/incidentes/2026-04-30_db-saturada-polling-realtime.md`](incidentes/2026-04-30_db-saturada-polling-realtime.md)
