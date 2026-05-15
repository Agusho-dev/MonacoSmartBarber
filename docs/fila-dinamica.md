# Fila Dinámica — Documentación del Sistema

> **Versión**: pool no bloqueante (mig 134/135/136 — 2026-05-15)
> **Última actualización**: 2026-05-15
> **Owners**: equipo de plataforma
> **Alcance**: queue de walk-ins (no incluye turnos/appointments — doc aparte)
>
> ✅ **Modelo actual**: los clientes dinámicos viven en un **pool compartido no
> bloqueante**. La asignación ocurre **cuando un barbero se libera** (no en el
> check-in). Esto resolvió la violación estructural del invariante "si hay
> dinámicos, ningún barbero desocupado" — ver §13 y la evidencia Monte Carlo
> en [`docs/sim/`](sim/).
>
> ⚠️ **Historia**: mig 132/133 (13–14 may) introdujeron pre-asignación
> server-side + binding *sticky-while-present*. Una auditoría + simulación
> Monte Carlo (43.200 turnos) probó que dejaba barberos ociosos con clientes
> dinámicos esperando 20–71 min/turno en 71–98 % de los turnos. **Revertido
> por mig 134**. No re-introducir binding en tiempo de check-in (§14).

Este documento describe el funcionamiento end-to-end de la fila dinámica:
modelo de datos, flujos, RPCs, componentes de UI, reglas de negocio,
concurrencia y configuración. §13 contiene el estado conocido y la evidencia
del rediseño; §14 el plan de optimización Phase 2.

---

## 1. Resumen ejecutivo

La fila dinámica asigna **clientes walk-in** a **barberos** en una sucursal, en
tiempo real. Cada cliente llega:

- **Específico**: en el check-in elige un barbero concreto. Entry con
  `barber_id = ese barbero`, `is_dynamic = false`. Solo ese barbero lo atiende.
- **Dinámico** ("Menor espera"): elige "cualquiera". Entry con
  `barber_id = NULL`, `is_dynamic = true`. Vive en un **pool compartido**.

Momentos de decisión:

1. **Al check-in** — solo se fija específico vs dinámico. El dinámico **no se
   asigna a nadie**: entra al pool con `barber_id = NULL`.
2. **Visualización en panel/kiosk/TV** — cada cliente rankea localmente un
   barbero "probable" para el dinámico (ETA). Es un **hint visual, no vincula
   nada**: dos tablets pueden mostrar hints distintos sin consecuencias.
3. **Al iniciar el corte (claim atómico server-side)** — único momento que
   mueve `barber_id` real. Solo vía **tap manual** del barbero ("Atender") →
   `claim_next_for_barber`. Un barbero libre reclama el más viejo entre *sus
   específicos* y *el pool dinámico* (FIFO por `priority_order`). **Cualquier**
   barbero libre puede tomar **cualquier** dinámico: pool no bloqueante.

La **atomicidad** la garantiza `FOR UPDATE SKIP LOCKED` + el partial UNIQUE
index `idx_queue_one_in_progress_per_barber` (mig 127, un solo `in_progress`
por barbero). **No hay fairness gate** y **no hay push-on-complete** (ver §5.4 y
§13 — decisiones intencionales con su porqué).

---

## 2. Glosario

| Término | Definición |
|---|---|
| **entry** | fila de `queue_entries`: alguien en la fila o un descanso. |
| **dinámico** | entry con `is_dynamic = true` y `barber_id = NULL`. Pool compartido; lo reclama el primer barbero libre. |
| **específico** | entry con `is_dynamic = false` y `barber_id = X`. Solo X lo atiende (o admin lo reasigna). |
| **pool** | conjunto de dinámicos `waiting` de la sucursal, no asignados, ordenados por `priority_order`. |
| **ghost de descanso** | entry con `is_break = true`. El descanso del barbero, respeta el orden FIFO de su fila personal. |
| **claim atómico** | la transacción (`claim_next_for_barber`) que mueve un entry `waiting → in_progress`, setea `barber_id`, `started_at`, `is_dynamic = false`. |
| **hint visual** | la pre-asignación local de `assignDynamicBarbers` (cliente). Informativa; el server no la respeta ni la necesita. |
| **Mi fila** | sección del panel barbero: específicos asignados a ese barbero (+ los dinámicos que su hint local le sugiere mostrar). |
| **Fila general** | vista admin `/dashboard/fila`, todos los entries del scope. |

> **Histórico (ya no aplican)**: *fairness gate* (mig 129, revertido mig 131),
> *pre-asignación server-side* (mig 132, revertida mig 134),
> *sticky-while-present* (mig 133, revertido mig 134). Se documentan en §13
> solo como lección.

---

## 3. Modelo de datos

### 3.1 Tabla `queue_entries` (campos relevantes)

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | PK |
| `branch_id` | UUID | sucursal del entry |
| `client_id` | UUID nullable | NULL para ghost de descanso |
| `barber_id` | UUID nullable | **NULL = dinámico de pool**; seteado = específico (o ya reclamado) |
| `service_id` | UUID nullable | servicio elegido al check-in |
| `appointment_id` | UUID nullable | si proviene de un turno |
| `position` | INTEGER | orden visual del drag&drop; **NO** ordena el claim |
| `priority_order` | TIMESTAMPTZ | **el verdadero orden FIFO**. Default `now()` al insert |
| `status` | TEXT | `waiting` \| `in_progress` \| `completed` \| `cancelled` |
| `is_dynamic` | BOOLEAN | `true` = el cliente eligió "Menor espera" (intención). Al reclamarse pasa a `false` |
| `is_break` | BOOLEAN | `true` para ghost de descanso |
| `is_appointment` | BOOLEAN | `true` si viene de un turno (no compite con walk-ins) |
| `checked_in_at` | TIMESTAMPTZ | cuándo entró a la fila |
| `started_at` | TIMESTAMPTZ | cuándo empezó el corte |
| `completed_at` | TIMESTAMPTZ | cuándo finalizó |
| `paused_at` / `paused_duration_seconds` | TIMESTAMPTZ / INT | pausa del corte |
| `reward_claimed` | BOOLEAN | el cliente quiere canjear puntos |

> **Invariante de datos (mig 134)**: un dinámico `waiting` tiene
> `barber_id = NULL`. La mig 134 normalizó las filas en vuelo que el check-in
> de mig 132/133 había pre-asignado. El check-in ya no pre-asigna (§5.1).

### 3.2 Índices y restricciones críticos

```
-- Mig 127: un solo in_progress por barbero (defensa estructural)
CREATE UNIQUE INDEX idx_queue_one_in_progress_per_barber
  ON queue_entries (barber_id)
  WHERE status = 'in_progress' AND barber_id IS NOT NULL;

-- Mig 127: lookup O(1) para Guard 0a (descanso activo)
CREATE INDEX idx_queue_active_break_per_barber
  ON queue_entries (barber_id, branch_id)
  WHERE is_break = true AND status = 'in_progress';

-- Scan del pool/FIFO en claim_next_for_barber
CREATE INDEX idx_queue_waiting_for_assignment
  ON queue_entries (branch_id, status, is_break, priority_order)
  WHERE status = 'waiting' AND is_break = false;
```

### 3.3 Tablas relacionadas

| Tabla | Para qué |
|---|---|
| `branches` | `timezone`, `organization_id`, `operation_mode` |
| `staff` | `is_active`, `hidden_from_checkin`, `role`, `is_also_barber` |
| `staff_schedules` | bloques horarios por día de la semana |
| `attendance_logs` | clock_in / clock_out |
| `appointment_staff` | `walkin_mode` (`appointments_only` → no toma walk-ins) |
| `appointment_settings` | `buffer_minutes` para ventana de protección por turno |
| `appointments` | turnos confirmados que protegen la ventana del barbero |
| `app_settings` | `shift_end_margin_minutes`, `next_client_alert_minutes` |
| `visits` | registro post-corte (trigger al pasar a `completed`) |
| `break_requests` | ciclo de aprobación de descansos (genera el ghost) |

---

## 4. Estados de un entry

```
(insert) → waiting ──claim_next_for_barber / startService──▶ in_progress ──completeService──▶ completed
                └────────── cancelQueueEntry / deactivateBarber ──────────▶ cancelled
```

- `waiting → in_progress`: solo `claim_next_for_barber` (tap "Atender") o
  `startService` (admin override).
- `in_progress → completed`: solo `completeService` (dispara trigger → visit).
- `* → cancelled`: `cancelQueueEntry` o `deactivateBarber` (cancela ghosts).
- **No** se revierte `completed → in_progress`.

---

## 5. Flujos end-to-end

### 5.1 Check-in (kiosk `/(tablet)/checkin`)

**Server action**: `checkinClient` ([`src/lib/actions/queue.ts`](../src/lib/actions/queue.ts))

```
Cliente toca "Check-in"
  ├─ Rate limit: 20 check-ins / branch / 60s
  ├─ Lookup branches.organization_id (sucursal activa)
  ├─ find-or-create cliente por (phone, organization_id)
  ├─ Si ya está en queue activa → alreadyInQueue
  ├─ next_queue_position(branch) → siguiente position
  └─ INSERT queue_entries:
      ├─ barber_id = barberId  (NULL si eligió "Menor espera")
      ├─ is_dynamic = !barberId
      ├─ priority_order = NOW()
      └─ status = 'waiting'
```

**No hay pre-asignación server-side.** El dinámico entra al pool con
`barber_id = NULL`. (`checkinClientByFace` = mismo flujo con match facial.)
Reintroducción: si choca la unique `(client_id, branch_id, status_active)`
devuelve la entry existente sin error.

### 5.2 Visualización (panel barbero / kiosk / TV)

`assignDynamicBarbers` ([`src/lib/barber-utils.ts`](../src/lib/barber-utils.ts))
rankea localmente, por ETA, un barbero "probable" para cada dinámico
(`barber_id = NULL`). Sirve para que "Mi fila" muestre algo y para el ETA del
kiosk/TV.

> **Es un hint, no vincula.** El claim real (server) es pool FIFO no
> bloqueante. Si dos tablets rankean distinto y muestran el mismo dinámico en
> "Mi fila" de dos barberos, no pasa nada: el primero que toca "Atender" lo
> reclama; el otro recibe vacío y un toast. `SKIP LOCKED` resuelve el empate.

**Realtime**: el panel suscribe `queue_entries`, `staff`, `break_requests`
filtrados por `branch_id`; cada evento dispara refresh
(`fetchQueue + refreshStats + fetchAssignmentData`).

### 5.3 Atender un cliente (manual)

**Disparador**: el barbero tap ▶ sobre un entry de "Mi fila" (o el botón
"Atender siguiente").

**Server action**: `attendNextClient` → RPC `claim_next_for_barber`

```
attendNextClient(barber, branch, preferredEntryId?)
  └─ claim_next_for_barber(barber, branch, preferredEntryId)
       ├─ Guard 0a: ¿descanso activo del barbero? → vacío
       ├─ Guard 0b: ¿ghost listo (sin específicos antes)? → arranca ghost
       ├─ ¿walkin_mode = appointments_only? → vacío
       ├─ ¿turno inminente (≤ 45+buffer min)? → vacío
       ├─ Path preferred: el entry tocado, si es waiting y
       │    (barber_id = yo  OR  barber_id IS NULL  OR  is_dynamic = true)
       │    y no está detrás de un ghost pendiente → claim
       └─ Fallback FIFO: el más viejo waiting con la misma elegibilidad
            (mis específicos + pool dinámico) → claim
  └─ revalidatePath /barbero/fila + /dashboard/fila
```

`claim` = `UPDATE → in_progress, started_at = NOW(), barber_id = yo,
is_dynamic = false`. Devuelve 0 ó 1 fila. Vacío = "nada elegible ahora".

### 5.4 Completar un corte (sin push-on-complete de clientes)

```
Panel: "Finalizar" → CompleteServiceDialog (cobro) → completeService(entryId, ...)
  ├─ Step 1: UPDATE entry → completed (trigger crea visit placeholder)
  ├─ Step 1b: si appointment_id → marca appointment completed
  ├─ Step 2-6: amount, comisiones, productos, prepagos, reward
  ├─ Step 6: AUTO-START SOLO del ghost de descanso si está listo
  │          (el descanso ya fue aprobado, no requiere presencia física)
  ├─ Step 7-8: automatización post-servicio, salary_reports
  └─ return { success, visitId, breakAutoStarted }

QueuePanel.onCompleted() → fetchQueue + refreshStats
El siguiente cliente queda WAITING en "Mi fila"/pool. Arranca con tap "Atender"
cuando el cliente está físicamente sentado.
```

**Por qué NO push-on-complete de clientes**: en barbería real hay un gap humano
(30 s–2 min) entre cobrar y arrancar el próximo (limpiar silla, llamar al
cliente). Arrancar el cronómetro automáticamente generaba "cortes fantasma"
(incidente Fabrizio/Santino vela, §13). El descanso **sí** auto-arranca porque
no necesita presencia del cliente.

> El Monte Carlo (§13) probó que el push-on-complete **no** era lo que rompía el
> invariante (políticas A≈B); el problema era el binding sticky. Por eso el fix
> fue el pool (mig 134), no reintroducir push-on-complete.

### 5.5 Cancelación / 5.6 Reasignación / 5.7 Descansos

- `cancelQueueEntry(id)` → `status='cancelled'`. No dispara claim.
- `reassignBarber` (admin), `reassignMyBarber` (kiosk),
  `updateQueueOrder` (drag&drop, RPC `batch_update_queue_entries`).
- Descanso aprobado → ghost row (`is_break=true`, `status='waiting'`,
  `priority_order = NOW + cuts_before_break * avg`). Compite con los
  específicos de ese barbero por `priority_order`. Ghost `in_progress` bloquea
  al barbero (Guard 0a).

---

## 6. RPCs y server actions

### 6.1 `claim_next_for_barber` — ÚNICO PRIMARIO (pool, mig 134)

```sql
claim_next_for_barber(
  p_barber_id UUID, p_branch_id UUID, p_preferred_entry_id UUID DEFAULT NULL
) RETURNS TABLE(entry_id UUID, is_break BOOLEAN, was_dynamic BOOLEAN)
```

`SECURITY DEFINER`, `SET search_path = public, pg_temp`,
`#variable_conflict use_column`.

**Predicado de elegibilidad** (preferred y fallback):
`barber_id = p_barber_id OR barber_id IS NULL OR is_dynamic = true`
— mi específico, dinámico de pool, o dinámico legacy con `barber_id` viejo.
**Pool no bloqueante**: sin `is_barber_present_now`, sin fairness gate.

**Guards (en orden)**: 0a descanso activo · 0b ghost listo (sin específicos
antes) → arranca ghost · `walkin_mode='appointments_only'` · turno inminente
(`45 + buffer_minutes`) · `(checked_in_at AT TIME ZONE branch_tz)::DATE = hoy`
· nunca detrás de un ghost pendiente (`priority_order < ghost`).

Atomicidad: `FOR UPDATE SKIP LOCKED`. Llamado **solo** desde
`attendNextClient` (tap manual). Sin callers en `completeService`.

### 6.2 `next_queue_position` (mig 135 — branch-tz)

```sql
next_queue_position(p_branch_id UUID) RETURNS INTEGER
```
`MAX(position)+1` de las entries `waiting/in_progress` del día **local de la
sucursal** (`(checked_in_at AT TIME ZONE branches.timezone)::DATE`). Antes
comparaba contra `CURRENT_DATE` (UTC) y reseteaba la posición a 1 cada noche en
Argentina. `position` es solo UI; el claim ordena por `priority_order`.

### 6.3 Funciones eliminadas (mig 136)

`assign_next_client`, `assign_dynamic_barber`, `compute_fair_barber`,
`get_fair_barber`, `is_barber_present_now` — **dropeadas**. Eran soporte del
modelo pre-asignación/sticky/fairness, sin callers tras mig 134. No
re-crearlas: ver §14 para la dirección correcta (scoring en el claim, no
pre-asignación).

### 6.4 Server actions principales (`src/lib/actions/queue.ts`)

| Function | Llamada por | Hace |
|---|---|---|
| `checkinClient` / `checkinClientByFace` | kiosk | inserta waiting (dinámico = `barber_id NULL`) |
| `startService(entryId, barberId)` | dashboard fila | UPDATE → in_progress (admin override) |
| `attendNextClient(barberId, branchId, preferredEntryId?)` | barber panel | RPC `claim_next_for_barber` |
| `completeService(entryId, payment, ...)` | barber panel | finaliza + auto-start de ghost |
| `cancelQueueEntry` / `reassignBarber` / `reassignMyBarber` / `updateQueueOrder` | — | gestión |
| `pauseActiveService` / `resumeActiveService` | barber panel | pausa/reanuda |
| `createBreakEntry` | barber panel | crea ghost de descanso |

---

## 7. UI y componentes

- **Panel barbero `/barbero/fila`**: `QueuePanel` (orchestrator, Realtime),
  `ActiveClientCard`/`ActiveBreakCard`, `BarberTimeline`, `NextClientAlert`
  (alerta sonora si idle > `next_client_alert_minutes`),
  `CompleteServiceDialog`, `BarberStatsBar`.
- **Dashboard `/dashboard/fila`**: `FilaClient` kanban (breaks, pool dinámico,
  una columna por barbero); drag&drop reasigna; ▶ inicia; finaliza; cancela.
- **TV `/tv`**: read-only, colas/ETAs/ranking, Realtime.
- **Kiosk `/(tablet)/checkin`**: branch → service → identificación → barbero o
  "Menor espera" → confirm.

---

## 8. Reglas de negocio (guards)

Todos server-side en `claim_next_for_barber`. La UI puede previewizarlos pero
la decisión final es del server.

| # | Guard | Causa |
|---|---|---|
| 0a | Descanso activo (`is_break=true && in_progress`) | barbero en pausa |
| 0b | Ghost listo sin específicos antes | el descanso arranca primero |
| 1 | `walkin_mode='appointments_only'` | barbero solo turnos |
| 2 | Turno inminente (`45 + buffer`) | proteger la reserva |
| 3 | `priority_order ≥ ghost pendiente` | el ghost gana |

Sutiles: `is_appointment=true` fuera del pool walk-in; solo entries del **día
local** de la sucursal.

---

## 9. Concurrencia y atomicidad

- **Solo un barbero gana**: `FOR UPDATE SKIP LOCKED` en el SELECT previo al
  UPDATE.
- **Un solo `in_progress` por barbero**: partial UNIQUE
  `idx_queue_one_in_progress_per_barber` (23505 si se viola; defensa
  estructural).
- **Trigger crea visit** al pasar a `completed` (idempotente).

| Escenario | Resolución |
|---|---|
| 2 barberos quieren el mismo dinámico | SKIP LOCKED elige uno; el otro recibe vacío + toast. |
| Cliente se da de baja durante el claim | `AND status='waiting'` → 0 rows, RPC vacío. |
| Doble "Finalizar" | `completeService` filtra `status='in_progress'`. |
| Dos tablets con hint divergente | Inocuo: el claim es pool, no respeta el hint. |

**Deuda conocida**: Realtime delay puede mostrar un toast tardío "ya lo tomó
otro". El claim server filtra bien; la UX es aceptable.

---

## 10. Configuración

### `app_settings` (org-scope)

| Campo | Default | Uso |
|---|---|---|
| `shift_end_margin_minutes` | 35 | margen de fin de turno (lo aplica el hint cliente; el server no lo aplica en el claim) |
| `next_client_alert_minutes` | 5 | min idle antes de la alerta sonora del panel |

> `dynamic_cooldown_seconds` fue **eliminado** (era inerte: configurable pero
> sin efecto). Código removido en el commit de mig 134; el `DROP COLUMN` está
> en `137_drop_dynamic_cooldown_column.sql.APPLY_AFTER_DEPLOY` (gateado, ver
> §12).

### `appointment_settings`

| Campo | Default | Uso |
|---|---|---|
| `buffer_minutes` | 10 | sumado a 45 (avg) para la ventana de protección por turno |

### `staff` flags

`is_active` (soft-delete) · `hidden_from_checkin` (no listado en kiosk) ·
`role IN ('barber',…) OR is_also_barber=true` (puede tomar walk-ins) ·
`appointment_staff.walkin_mode='appointments_only'` (no toma walk-ins).

---

## 11. Realtime sync

Suscripciones del panel (filtradas por `branch_id`): `queue_entries`,
`staff`, `break_requests` → refresh. `attendance_logs` y `break_requests` (sin
filtro) **excluidas** del publication (mig 124, incidente DB saturada). El
panel hace visibility-refresh cada 30 s como fallback.

---

## 12. Cronología de migraciones (fila)

| Mig | Fecha | Cambio | Estado |
|---|---|---|---|
| 127 | 2026-05-04 | Guard 0a + partial UNIQUE 1-in_progress | activo |
| 128 | 2026-05-04 | claim respeta pending break (Guard 0b) | activo |
| 129 | 2026-05-07 | fairness gate | revertido por 131 |
| 130 | 2026-05-07 | get_fair_barber wrapper | dropeado mig 136 |
| 131 | 2026-05-09 | revert fairness gate + RPC `claim_next_for_barber` | activo (base) |
| 131b | 2026-05-09 | fix `#variable_conflict` | activo |
| 132 | 2026-05-13 | `assign_dynamic_barber` + pre-asignación server en check-in | **revertido por 134** |
| 133 | 2026-05-14 | sticky-while-present | **revertido por 134** |
| **134** | **2026-05-15** | **pool no bloqueante** en `claim_next_for_barber` + normalización de filas en vuelo | **activo** |
| **135** | **2026-05-15** | `next_queue_position` branch-tz + `search_path` | **activo** |
| **136** | **2026-05-15** | drop de funciones muertas (assign_next_client, assign_dynamic_barber, compute_fair_barber, get_fair_barber, is_barber_present_now) | **activo** |
| 137 | (gated) | `DROP COLUMN app_settings.dynamic_cooldown_seconds` | **pendiente — aplicar tras el redeploy** (`.APPLY_AFTER_DEPLOY`) |

---

## 13. Estado conocido, evidencia y deuda

### Resuelto en mig 134 (con evidencia Monte Carlo)

Simulador de eventos discretos en [`docs/sim/fila_montecarlo.py`](sim/fila_montecarlo.py)
(resultados crudos en [`docs/sim/results.json`](sim/results.json)), calibrado
con `visits` reales (n=4999: media 35,1 min, sd 13,6, p50 33,5). Grilla:
barberos {3,5,7,10} × carga {0,8/1,0/1,15} × % dinámico {25/50/80} ×
popularidad {uniforme, zipf} × 5 políticas × 120 reps = **43.200 turnos**.

Políticas: **A** binding sticky actual · **B** binding con push+tap instantáneo
· **C** pool no bloqueante (mig 134) · **D** pool + WSJF · **E** pool con
fairness-gate bloqueante.

Hallazgos:

- ✅ **Invariante "si hay dinámicos, ningún barbero desocupado"**: A violaba
  20–71 min/turno (71–98 % de los turnos; peor celda 121 min/turno). **B ≈ A**
  → el problema NO era el push-on-complete revertido, era el **binding
  sticky**. **C = D = 0,00**. El pool lo elimina de raíz.
- ✅ **Utilización**: pool +~2 pp (≈ 0,2 barbero recuperado con 10 sillas).
- ✅ **Espera P50**: pool ~10 min menor que el binding; WSJF (D) −40 %.
- ⚠️ **Equidad de cortes**: el binding tenía CV menor *porque pre-asignaba para
  igualar*, pero a costa del invariante; bajo carga real esa equidad se
  degradaba igual (CV 0,34 en zipf saturado). Con pool la equidad es excelente
  (Jain ~0,92–0,98); la diferencia residual es **elección legítima del cliente
  por el barbero popular**, no un defecto del scheduler.
- ⚠️ **Política E (fairness gate bloqueante) reprodujo numéricamente el
  incidente de mig 129**: retener trabajo a un barbero "adelantado" reintroduce
  el starvation (peor que A). **Lección dura: la equidad nunca se impone
  reteniendo trabajo de un barbero libre.**

### Incidente 2026-05-09 — Fabrizio/Santino vela (cortes fantasma)

El push-on-complete (mig 131) arrancaba el cronómetro del siguiente cliente
automáticamente, asumiéndolo en la silla — falso en barbería real (gap humano).
Revertido. Lección: cambiar el momento de captura de `started_at` debe
coordinarse con el flujo físico, no solo con la integridad de datos. El Monte
Carlo confirmó además que el push-on-complete era irrelevante para el
invariante: el fix correcto era el pool, no el push.

### Pendiente (Phase 2 — §14)

- Predicción de duración por (barbero, servicio, cliente) — hoy avg global.
- WSJF acotado por aging en el pool (P50 −40 % en sim) — **como score en el
  claim, nunca como gate bloqueante**.
- `shift_end` consciente del servicio.
- Hint cliente↔server con tests de snapshot.

### Deudas menores

- `position` se puede manipular con drag&drop; el claim usa `priority_order`,
  así que es solo cosmético pero confunde el debug.
- `assignmentTimeRef` se rebumba a `Date.now()` local; dos paneles pueden tener
  `now` sub-segundo distintos. Inocuo (el claim es server).

---

## 14. Plan Phase 2 — Optimización (sobre el pool, no contra él)

> **Objetivo medible**: P50 wait ~6→3-4 min, P95 ~25→12-15 min, sin perder el
> invariante (ya garantizado por el pool) ni la equidad.
>
> **Principio rector (lección mig 129/134)**: la asignación ocurre **cuando el
> barbero se libera**, sobre el **pool**. Cualquier fairness/optimización es un
> **término de score en `claim_next_for_barber`**, nunca un gate que bloquee a
> un barbero libre ni una pre-asignación en el check-in.

### 14.1 `predicted_duration_minutes` (MV `barber_service_duration_stats`)

Mediana por (cliente,barbero,servicio) → (barbero,servicio) → (servicio) →
`services.duration_minutes` → 25. Refresh horario vía pg_cron. Usado por: ETA
de kiosk/TV/panel, scoring del claim (§14.2), shift_end consciente (§14.3).

### 14.2 WSJF acotado por aging en el claim del pool

Cuando `claim_next_for_barber` elige del pool dinámico, en vez de FIFO puro:

```
score = aging(entry) - duration_penalty(entry, barber)
aging: waited>30 → 1000 ; waited>15 → 100 ; else waited
duration_penalty = predicted_duration_minutes(...)
ORDER BY score DESC LIMIT 1   -- aging garantiza nadie espera >30 min
```

Es un cambio **localizado y aditivo** dentro del SELECT del fallback FIFO. No
toca el check-in ni introduce binding. Sim (política D): P50 −40 %, P95
acotado.

### 14.3 `shift_end` consciente del servicio

En el claim, descartar un entry para un barbero solo si
`shift_remaining < predicted_duration(servicio) + margin` (no por tiempo
absoluto ciego al servicio).

### 14.4 Test de snapshot del claim

`src/lib/queue-ranking/` con fixtures que insertan estado en una branch
efímera, llaman al RPC y comparan el `entry_id` ganador contra una impl TS de
referencia. Cubrir: empate exacto, un solo elegible, pool vacío, ghost ready,
turno inminente, ruido multi-sucursal.

### 14.5 Migraciones planeadas

| Mig | Cambio |
|---|---|
| 138 | `barber_service_duration_stats` MV + `predicted_duration_minutes` + cron |
| 139 | `claim_next_for_barber` v2: WSJF aditivo + shift_end consciente |
| 140 | Test fixtures + CI |

---

## Apéndice A — Decisiones clave y por qué

| Decisión | Por qué |
|---|---|
| Pool no bloqueante (asignar al liberarse, no al check-in) | Único modelo que cumple el invariante; probado con Monte Carlo (43.200 turnos). El binding en arrival + sticky es el antipatrón clásico (idle server + waiting customer). |
| FIFO por `priority_order` (no `position`) | `position` es UI, se reordena con drag&drop; `priority_order` es estable y semántico. |
| Sin fairness gate | Un gate que retiene trabajo a un barbero libre reintroduce starvation (mig 129; reproducido por la política E del sim). La equidad va como score aditivo (§14.2), nunca como bloqueo. |
| Sin push-on-complete de clientes | Gap humano real → cortes fantasma (incidente Fabrizio). El sim probó que el push no afectaba el invariante; el fix era el pool. El descanso sí auto-arranca (no requiere presencia). |
| Hint visual cliente, claim server | El hint puede divergir entre tablets sin daño; `SKIP LOCKED` + toast resuelven el empate. Simplicidad > consistencia de hint. |
| `is_break` ghost en vez de flag en staff | Mantiene FIFO global respetando `cuts_before_break`. |

## Apéndice B — Referencias rápidas

- Migración 134 (fix pool): [`supabase/migrations/134_decouple_dynamic_pool.sql`](../supabase/migrations/134_decouple_dynamic_pool.sql)
- Migración 135 (tz): [`supabase/migrations/135_next_queue_position_branch_tz.sql`](../supabase/migrations/135_next_queue_position_branch_tz.sql)
- Migración 136 (limpieza): [`supabase/migrations/136_drop_dead_queue_functions.sql`](../supabase/migrations/136_drop_dead_queue_functions.sql)
- Migración 137 (gateada): `supabase/migrations/137_drop_dynamic_cooldown_column.sql.APPLY_AFTER_DEPLOY`
- Server actions: [`src/lib/actions/queue.ts`](../src/lib/actions/queue.ts)
- Panel barbero: [`src/components/barber/queue-panel.tsx`](../src/components/barber/queue-panel.tsx)
- Hint client-side: [`src/lib/barber-utils.ts`](../src/lib/barber-utils.ts)
- Evidencia Monte Carlo: [`docs/sim/fila_montecarlo.py`](sim/fila_montecarlo.py) · [`docs/sim/results.json`](sim/results.json)
- Incidente 30-abr-2026 (DB saturada, contexto mig 124): [`docs/incidentes/2026-04-30_db-saturada-polling-realtime.md`](incidentes/2026-04-30_db-saturada-polling-realtime.md)
