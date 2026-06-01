# Changelog técnico — Fixes auditoría "fila dinámica"

**Fecha:** 2026-06-01 · **Migración DB aplicada a prod (`gzsfoqpxvnwmvngfoqqk`):** 2026-06-01 **11:39:22** ART vía MCP `apply_migration` (`dynamic_queue_correctness_fixes`).
**Origen:** auditoría multi-agente de la fila dinámica (17 bugs únicos verificados). Diseño + doble-revisión por workflow antes de implementar.

> Método: cada fix fue (1) auditado, (2) diseñado con snippet exacto, (3) re-verificado por un crítico contra el código/DB real, (4) aplicado, (5) validado con `npm run build`. Las decisiones de los `[RIESGO]` se tomaron con criterio senior y se documentan abajo.

---

## 1) Base de datos — migración `139_dynamic_queue_correctness_fixes.sql`

Aplicada a producción el **2026-06-01 11:39:22 ART**. Archivo en `supabase/migrations/139_*.sql`.

| Parte | Fix | Qué cambió | Verificación post-aplicación |
|---|---|---|---|
| **0** | #1 (reconciliación) | DELETE de los `transfer_logs` duplicados (16 filas / 14 visitas) dejando el primero por `visit_id`. One-shot, idempotente. | `dups_restantes = 0`; `transfer_logs` 4977→4961 |
| **1** | #1 | `CREATE UNIQUE INDEX uq_transfer_logs_visit_id (visit_id) WHERE visit_id IS NOT NULL`; `DROP` del índice plano redundante `idx_transfer_logs_visit_id` | `uq_creado = 1`, `idx_plano = 0` |
| **2** | #13 | `claim_next_for_barber`: guard temprano — si el barbero ya tiene un servicio (no-break) `in_progress` → `RETURN`. Evita el `23505` crudo de `idx_queue_one_in_progress_per_barber`. | `guard13_ok = true` |
| **3** | #4 + #5 | `get_client_queue_position`: TZ por sucursal (antes hardcode BA); divisor excluye descanso (ghost break) y `appointments_only`, e incluye `is_also_barber`; suma `v_self_busy` (corte propio en curso = +1). | `tz_dinamica`, `is_also_barber`, `self_busy` = true |
| **4** | #2 | `expire_stale_queue_entries()` (cancela `waiting` no-break de días anteriores, TZ-aware) + cron pg_cron `expire-stale-queue-entries` cada 10 min. | `cron_schedule = */10`, primera corrida canceló 0 (limbo=0 hoy) |

---

## 2) Server actions y librería (TypeScript)

| Archivo | Fix | Cambio |
|---|---|---|
| `src/lib/actions/queue.ts` | **#1 (CRÍTICO)** | `completeService`: el UPDATE a `completed` ahora lleva `.select('id')`; si afecta 0 filas (ya estaba completado) → `return { success, alreadyCompleted }` **antes** de tocar visit/transfer/salary/productos/post-service. Corta el doble-disparo que infló caja. |
| `src/lib/actions/queue.ts` | #3 | `cancelQueueEntry`: agrega `.eq('status','waiting').select('id')`; si 0 filas → error "El cliente ya está siendo atendido o fue completado". (Opción 3-A: **sin** `.eq('is_break')`, para no romper la cancelación de descansos encolados desde el dashboard.) |
| `src/lib/actions/queue.ts` | #7 | `reassignMyBarber`: firma + `clientId` requerido; valida ownership (`entry.client_id === clientId`), `status='waiting'`, y rate-limit `kioskReassign`. Cierra el IDOR no autenticado del kiosk. |
| `src/lib/actions/queue.ts` | #15 | Redención de puntos: quita los `.eq('branch_id', visit.branch_id)` residuales (la fila de `client_points` es única por `client_id+organization_id`). |
| `src/lib/actions/paymentAccounts.ts` | #1 (def. profundidad) | `recordTransfer`: trata `23505` como idempotente (`alreadyLogged`), `return` antes de re-incrementar el acumulado de la cuenta. (Manejo de error, **no** `.upsert onConflict`, por ser índice parcial.) |
| `src/lib/rate-limit.ts` | #7 | Nuevo `RateLimits.kioskReassign` (10/min por IP+branch). |
| `src/lib/barber-utils.ts` | #5 | Nuevo helper canónico `countActiveDynamicCapableBarbers` (único divisor de espera del front; espeja la DB). |
| `src/lib/barber-utils.ts` | #4 | `calculateEffectiveAhead`: suma `myBarberBusy` (corte in_progress del barbero específico). Espeja `v_self_busy`. |
| `src/lib/barber-utils.ts` | #11 | `assignDynamicBarbers`: ordena por `priority_order` (FIFO real), `position` sólo como desempate (se recicla al vaciarse la cola). |
| `src/lib/barber-utils.ts` | sm-4 | `buildBarberAvgMinutes`: descuenta `paused_duration_seconds` (param opcional, retrocompatible). |

## 3) UI

| Archivo | Fix | Cambio |
|---|---|---|
| `src/app/(tablet)/checkin/checkin-walk-in.tsx` | #7 | `handleReassign` pasa `ownerClientId` (de `myQueueEntry.client_id ?? faceClientId`). |
| `src/app/(tablet)/checkin/checkin-walk-in.tsx` | #5 / #6 | `activeBarberCount` usa el helper canónico; `effectiveAhead` usa `queueEntries` crudas (no `dynamicEntries`) para no caer en la rama "específico". |
| `src/app/(tablet)/checkin/checkin-walk-in.tsx` | #8 | Empty-state cuando no hay barberos disponibles (todos en descanso/sin llegar) con fallback "Ponerme en la fila igual" (dinámico); cards "no llegaron"/"descanso" ya NO son seleccionables (`renderBarberCard` gana `selectable`; `renderBarberList` gana `allowDynamicFallback`, en `false` para los flujos de reasignación). |
| `src/app/tv/tv-client.tsx` | #5 / #14 | `activeBarberCount` canónico; listener muerto `attendance_logs` → `branch_signals`; hint de dinámico sin nombre de barbero ("Menor espera · primer barbero libre"). |
| `src/components/barber/queue-panel.tsx` | #13 / ux-2 | Toast diferenciado cuando el claim devuelve NULL (barbero ocupado vs cliente no disponible); labels "Reclamar"/"Atender" siempre visibles (no más `hidden sm:inline`). |
| `src/app/dashboard/fila/page.tsx` + `fila-client.tsx` | #9 | `orgId` pasado por prop; `fetchQueue`/`fetchBarbers` y los listeners realtime de `queue_entries`/`staff` scopeados por `organization_id` (corta el fan-out + leak cross-org del dashboard). |

---

## Decisiones tomadas en los `[RIESGO]` (criterio senior)

1. **Cancel (#3): opción 3-A** (sólo `.eq('status','waiting')`, sin `is_break`) — la 3-B rompía la cancelación de descansos encolados desde el dashboard (botón X sin gate). Sin regresión.
2. **recordTransfer (#1): manejo de `23505`**, no `.upsert({onConflict})` — el índice es PARCIAL y supabase-js no expone el `WHERE` del `ON CONFLICT` (riesgo 42P10).
3. **Divisor (#5): se incluye `is_also_barber`** (un admin que también corta cuenta como capacidad) — en TS y en la DB. Evita subestimar capacidad.
4. **Paridad mobile↔TV/kiosk (#5):** el front además excluye fin-de-turno y exige clock-in explícito; replicar eso en plpgsql es frágil y propenso a drift → **no se replica**; mobile (RPC) puede mostrar un número levemente distinto. Aceptado como estado intermedio (documentado).
5. **TV (#14): copy corto** "· primer barbero libre" (evita wrap en TV verticales).
6. **sm-4:** sólo se aplicó la versión retrocompatible de la función (4a); el plumbing de `paused_duration_seconds` desde el kiosk (4b/4c) se difiere — impacto medido nulo (0.23% de cortes con pausa, delta 0 min en el avg redondeado).
7. **#11:** se cambió el ORDEN a `priority_order`; el **número** que ve el cliente (`position`) se mantiene (cambiarlo es decisión de producto).

---

## Diferido (con motivo)

- **#9 — RLS `queue_entries_public_read` (en progreso, secuenciado):**
  - **Hecho (dashboard):** scope por org en `fetchQueue`/`fetchBarbers`/listeners — corta el fan-out y el leak desde el dashboard (el dashboard usa service_role igual, esto es defense-in-depth client-side).
  - **Hecho (mobile):** se reescribió `branchQueueRealtimeProvider` (`Monaco-mobile/.../occupancy_provider.dart`) para streamear `branch_signals` (agregado PII-free, ya publicado, refrescado por trigger en cada cambio de cola) en vez de `queue_entries` crudo. El consumidor sólo lo usa como "ping" para reinvalidar el RPC `get_branch_public_detail`, así que el comportamiento es idéntico — sin exponer la cola cruda cross-org. **Nota:** la "ocupación agregada" que se planteaba como RPC nuevo **ya existía** (`branch_signals` + `get_branch_public_detail` SECURITY DEFINER); no se agregó RPC redundante.
  - **Pendiente (DB):** `supabase/migrations/140_lockdown_queue_entries_public_read.sql` (DROP de la policy abierta) está **escrita pero NO aplicada** — aplicarla antes rompería los apps mobile viejos (siguen usando el stream crudo hasta actualizar). Runbook en el header de la 140: aplicar tras adopción del release mobile con el rewire.
- **#16 — `process-appointments` `priority_order`:** el cron legacy setea `priority_order = now()` en vez del horario reservado. Exposición ~nula hoy (turnos apenas usado). Pendiente: que use `check_in_appointment`. No tocado.
- **ux-5 / ux-7 — realtime en `success`/`manage_turn` del kiosk durante los ~5s:** (ver estado abajo). Valor marginal (0.34% de clientes arrancan <5s) y requiere una suscripción nueva en una pantalla transitoria.
- **walkin_mode en el divisor del front:** hoy no-op (no se carga `appointment_staff` en el front). El RPC sí lo excluye. `getAppointmentStaff` ya existe para activarlo cuando se quiera.

---

## Verificación

- `npm run build`: **✓ Compiled successfully** (typecheck + lint OK, 26 páginas generadas) tras aplicar los 16 fixes.
- DB: verificada post-migración (tabla de la sección 1): `dups_restantes=0`, `uq_transfer_logs_visit_id` creado, cron `*/10`, guard #13 + TZ/`is_also_barber`/`v_self_busy` presentes.
- `get_advisors(security)`: las 4 funciones nuevas NO generan advisories (todas con `SET search_path`); los 2 ERROR-level son de vistas pre-existentes (`billing_cron_health`, `v_subscription_renewals_due`), ajenas a esta migración.
- Reconciliación de caja: ver `RECONCILIACION-CAJA-2026-06-01.md` (documento para el dueño).

## Resumen de cobertura

**Aplicado y verificado (16/17):** #1 (crítico), #2, #3, #4, #5, #6, #7, #8, #9 (lado dashboard), #11, #13, #14, #15, ux-2, sm-4 (4a), + guard de servicio in_progress.
**Diferido con motivo:** #9 RLS (→ mig 140 + RPC ocupación, rompería mobile cross-org), #16 (`process-appointments`), ux-5/ux-7 (realtime kiosk durante ~5s — valor marginal 0.34%, requiere suscripción nueva en pantalla transitoria), walkin_mode en el divisor del front (no-op hoy).
