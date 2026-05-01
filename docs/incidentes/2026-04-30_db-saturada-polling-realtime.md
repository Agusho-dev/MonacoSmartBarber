# Incidente — 30/abr/2026 — DB Postgres saturada (polling masivo + realtime mal scopeado)

> **Estado**: Resuelto.
> **Severidad**: P0 — sistema inutilizable durante el pico (login loops, no se podían iniciar/finalizar cortes, no se podía agendar).
> **Duración del impacto**: ~varias horas hasta el restart de la base.
> **Mitigación aplicada en**: 30/abr/2026, 19:00–19:25 ART.

---

## TL;DR (no técnico)

La base de datos estaba ahogada porque cada panel de barbero le hablaba 5 veces por segundo pidiendo todo el grafo de la fila, y además todos los paneles escuchaban notificaciones de todas las sucursales sobre cualquier clock-in/clock-out o pedido de descanso. Cada notificación disparaba 5 queries más → cascada. Cuando la base no daba abasto, los layouts del dashboard interpretaban "DB lenta" como "sesión inválida" y mandaban al usuario al login.

Lo solucionamos en 3 capas: en la base (índices + sacar tablas ruidosas del realtime), en el frontend (queries más livianas, listeners scope-correctos) y en el auth (los layouts ahora muestran "reintentando" en lugar de patear al login).

---

## Síntomas reportados por el usuario

- Estoy navegando y de pronto me lleva al login (sin haber hecho logout).
- Páginas que tardan eternidades en cargar.
- No se puede agendar gente.
- No se puede iniciar/finalizar cortes desde el panel del barbero.

## Causa raíz (3 factores combinados)

### 1) Realtime publication sobre tablas de alta frecuencia, escuchada sin filtro

`src/components/barber/queue-panel.tsx` (versión previa) tenía 4 listeners Realtime:

| Tabla | Filtro |
|---|---|
| `queue_entries` | `branch_id=eq.{branchId}` ✅ |
| `staff` | `branch_id=eq.{branchId}` ✅ |
| `break_requests` | **sin filtro** ❌ — escuchaba toda la org |
| `attendance_logs` | **sin filtro** ❌ — escuchaba todas las sucursales |

`attendance_logs` recibe un INSERT cada vez que cualquier barbero ficha entrada/salida. Multiplicado por N tablets activas, cada clock-in disparaba N callbacks que llamaban a `fetchBarbersAndSchedules()`, que ejecutaba 5 queries en paralelo (una de ellas el query masivo a `queue_entries`).

**Evidencia en `pg_stat_statements`**:
- Query del WAL replication: **22.18%** del tiempo total de DB (2.9M calls).

### 2) Query masivo en cada refetch del barber-panel

```ts
// queue-panel.tsx (previo)
.from('queue_entries')
.select('*, client:clients(*, loyalty:client_loyalty_state(total_visits), visits(count)), barber:staff(*), service:services(*)')
```

El `visits(count)` es un **correlated subquery por cliente** — para cada fila de la fila se ejecuta un `SELECT count(*) FROM visits WHERE client_id = ...`. Si hay 10 clientes en fila, son 10 subqueries adicionales.

**Evidencia en `pg_stat_statements`**:
- 3 variantes del mismo query a `queue_entries` consumían **17.7% + 9.4% + 5.9% = 33%** del tiempo total de DB (177k+76k+67k calls/día).

### 3) Índices faltantes

| Query | Calls/día | % tiempo DB |
|---|---|---|
| `visits` filtrada por barber+branch+completed_at | 288k | 9.3% |
| `staff_schedules` filtrada por day_of_week+is_active | 331k | 4.6% |
| `attendance_logs` filtrada por branch+recorded_at | 347k | <1% (pero alta frecuencia) |

Todas hacían full scan o usaban índices subóptimos.

### 4) Layouts pateando al login en error de red

`src/app/dashboard/layout.tsx` (versión previa) tenía 3 puntos de `redirect('/login')` que se disparaban si cualquier query del bloque paralelo fallaba — sin distinguir entre auth-inválido y DB-saturada.

---

## Síntomas técnicos observados

- Logs API: **522/502 generalizado** (Cloudflare timeout porque la DB no respondía).
- Logs Postgres:
  - `canceling statement due to statement timeout` repetido.
  - `cron job 1/3/5/6/14 startup timeout` (la DB tan saturada que ni los crons arrancaban).
  - `could not accept SSL connection: Connection reset by peer`.
  - `connection to client lost` constantes.
  - Realtime queries de 10-31 segundos.
- `pg_stat_activity`: múltiples queries activas > 30s cancelándose.

---

## Diagnóstico (cómo lo detecté)

```sql
-- Top queries por tiempo total
SELECT calls, ROUND(total_exec_time::numeric, 0) AS total_ms,
       ROUND(mean_exec_time::numeric, 1) AS mean_ms,
       ROUND((100 * total_exec_time / SUM(total_exec_time) OVER ())::numeric, 2) AS pct_total,
       LEFT(query, 250) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 25;
```

Esa única query reveló los 3 puntos calientes en orden de prioridad.

```sql
-- Queries activas/colgadas en este momento
SELECT count(*) FILTER (WHERE state='active') AS active,
       count(*) FILTER (WHERE state='active' AND now()-query_start > '5s') AS slow_5s
FROM pg_stat_activity WHERE datname='postgres';
```

Confirmó la saturación en tiempo real.

---

## Solución aplicada (en 3 oleadas)

### Oleada 1 — DB (mig 123 + 124, ya en producción)

**`supabase/migrations/123_perf_emergency_indexes.sql`** — 4 índices `CONCURRENTLY` (no bloquean writes):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_branch_barber_completed
  ON public.visits (branch_id, barber_id, completed_at DESC)
  INCLUDE (amount)
  WHERE barber_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_branch_completed
  ON public.visits (branch_id, completed_at DESC)
  WHERE barber_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_schedules_dow_active
  ON public.staff_schedules (day_of_week)
  WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_logs_branch_recorded
  ON public.attendance_logs (branch_id, recorded_at DESC);
```

**`supabase/migrations/124_realtime_publication_cleanup.sql`** — sacar tablas ruidosas del WAL stream:

```sql
ALTER PUBLICATION supabase_realtime DROP TABLE public.attendance_logs;
ALTER PUBLICATION supabase_realtime DROP TABLE public.break_requests;
```

> Nota: el `IF EXISTS` no aplica a `ALTER PUBLICATION DROP TABLE` en Postgres. La migración real usa un `DO $$ BEGIN IF EXISTS (...) THEN ... END $$;` para idempotencia.

### Oleada 2 — Frontend

**`src/components/barber/queue-panel.tsx`**:
- Query reducido: `client:clients(id, name, phone, loyalty:client_loyalty_state(total_visits)), barber:staff(id, full_name, avatar_url), service:services(id, name, duration_minutes, price)`. Eliminado el `visits(count)`.
- Listener de `attendance_logs` eliminado (la tabla salió de la publication).
- Listener de `break_requests` filtrado por `branch_id`.
- El listener de `queue_entries` ya NO dispara `fetchBarbersAndSchedules` (separación de responsabilidades).
- `useVisibilityRefresh` reducido a `fetchQueue + refreshStats` (de 6 funciones).

**`src/app/dashboard/fila/fila-client.tsx`**:
- Mismo query liviano (sin `clients(*)` ni `staff(*)` completos).
- Listener huérfano de `attendance_logs` eliminado.

**`src/app/(tablet)/checkin/checkin-walk-in.tsx`**:
- Listener huérfano de `attendance_logs` eliminado (cleanup post-Oleada 1).

### Oleada 3 — Auth/Resiliencia

**`src/lib/supabase/server.ts`** — `fetchWithTimeout(8000)` en `global.fetch` de ambos clients:

```ts
function fetchWithTimeout(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    return fetch(input, { ...init, signal: controller.signal })
      .finally(() => clearTimeout(timeoutId))
  }
}
```

**`src/components/dashboard/db-down-error.tsx`** (NUEVO) — pantalla de error con auto-retry exponencial (15s → 30s → 60s capped). UseReducer atómico, barra de progreso correcta por intervalo actual.

**`src/app/dashboard/layout.tsx`** — helpers `esErrorDeRed()` / `esErrorDeRedSupabase()`. Tres puntos de `redirect('/login')` originales ahora distinguen:
- Error de red/timeout → `<DbDownError />` (sesión preservada).
- Auth genuinamente inválida → `redirect('/login')`.

Patrón: `try/catch` para errores que THROW (auth.getUser internamente, AbortError de fetch); check de `result.error` para errores que vienen en el campo `error` de Supabase JS (que NO los lanza, es trampa común).

**`src/app/barbero/layout.tsx`** — `getBarberSession()` envuelto en try/catch. Si timea, renderiza `<DbDownError />` dentro del wrapper `barber-theme`.

---

## Verificación post-mitigación

```sql
SELECT
  count(*) AS conn_total,
  count(*) FILTER (WHERE state='active') AS conn_active,
  count(*) FILTER (WHERE state='active' AND now()-query_start > '5s') AS slow,
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN
    ('idx_visits_branch_barber_completed','idx_visits_branch_completed',
     'idx_staff_schedules_dow_active','idx_attendance_logs_branch_recorded')
  ) AS new_indexes_present,
  (SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime'
    AND tablename IN ('attendance_logs','break_requests')
  ) AS noisy_publication_tables_remaining
FROM pg_stat_activity WHERE datname='postgres';
```

**Resultado tras mitigación**:
- `conn_total: 27, conn_active: 2, slow: 1` (el "slow" es el WAL replicator esperando, normal)
- `new_indexes_present: 4`
- `noisy_publication_tables_remaining: 0`

Pre-mitigación: múltiples queries activas > 10s, timeouts cancelándose en cadena.

---

## Lecciones aprendidas (para futuras conversaciones)

### 1) Listeners huérfanos tras `DROP TABLE FROM PUBLICATION`

Si una tabla sale de `supabase_realtime`, los listeners en el código que apuntaban a ella **siguen registrados pero nunca reciben eventos**. Son ruido (consumen un slot del channel) y son confusos para el próximo dev. **Siempre eliminar el listener cuando se saca la tabla del publication**, en la misma PR.

### 2) Supabase JS no THROW errores de red — `try/catch` no los captura

`await supabase.from('x').select()` devuelve `{ data, error }`, **no lanza**. Si la red falla, el error está en `result.error`, NO como excepción. Los layouts deben:
- Hacer `try/catch` para operaciones que SÍ lanzan (`auth.getUser()` internamente, fetch con `AbortController`).
- Hacer `if (esErrorDeRedSupabase(result.error))` para operaciones que devuelven `{error}`.

Cubrir solo uno de los dos casos deja un agujero por el cual la app puede patear al login con DB caída.

### 3) Realtime es para datos que cambian poco y se ven en vivo

NO usar Realtime para tablas con alta tasa de INSERT/UPDATE (ej: `attendance_logs`, `break_requests`, `messages`). Para esos casos, usar polling controlado con `useVisibilityRefresh` o refetch on-demand. Siempre filtrar el listener por `branch_id`/`organization_id`.

### 4) Joins con correlated subqueries son fatales en queries de polling

`.select('client:clients(*, visits(count))')` ejecuta un subquery por cliente en cada call. Si la query corre 100 veces/min, son ~1000 subqueries/min escalando con el número de clientes en fila. Pre-agregar siempre en una vista o columna denormalizada (`client_loyalty_state.total_visits`).

---

## Restart de Postgres como herramienta de mitigación

Cuando la DB está tan saturada que ni el management API responde, **un restart desde Supabase Dashboard** es legítimo:

- **Cuándo**: cuando ya no hay opciones via SQL/MCP (timeouts en cascada).
- **Riesgo**: 30-60s de downtime declarado vs el degradado actual no anunciado.
- **Por qué funciona**: mata el WAL replication slot abusivo, transacciones idle in transaction, conexiones huérfanas.
- **Importante**: el restart es **una ventana de oportunidad** para aplicar el fix antes de la avalancha de reconexión. Sin el fix, las tablets reconectan en estampida y la DB se cae igual o peor en 5-10 min.

Secuencia ideal:
1. Tener listas las migraciones SQL.
2. Gatillar restart desde dashboard.
3. Apenas el management API acepte la primera query, aplicar `DROP PUBLICATION` (instantáneo) + `CREATE INDEX CONCURRENTLY` (en paralelo).
4. Deploy del frontend ASAP — sin ese deploy, el restart es un parche.

---

## Archivos modificados en este incidente

| Archivo | Tipo |
|---|---|
| `supabase/migrations/123_perf_emergency_indexes.sql` | NUEVO |
| `supabase/migrations/124_realtime_publication_cleanup.sql` | NUEVO |
| `MonacoSmartBarber/src/components/dashboard/db-down-error.tsx` | NUEVO |
| `MonacoSmartBarber/src/lib/supabase/server.ts` | MOD |
| `MonacoSmartBarber/src/app/dashboard/layout.tsx` | MOD |
| `MonacoSmartBarber/src/app/barbero/layout.tsx` | MOD |
| `MonacoSmartBarber/src/components/barber/queue-panel.tsx` | MOD |
| `MonacoSmartBarber/src/app/dashboard/fila/fila-client.tsx` | MOD |
| `MonacoSmartBarber/src/app/(tablet)/checkin/checkin-walk-in.tsx` | MOD |

---

## Cómo prevenir un próximo incidente similar

1. **Cada 2-3 meses correr análisis de top queries** (`pg_stat_statements`). Detecta regresiones temprano.
2. **Code review**: cada PR que toque `queue_entries`, `clients`, `visits` debe verificar que no agregue joins anidados ni listeners realtime sin filtro.
3. **Antes de agregar una tabla al `supabase_realtime` publication**: estimar tasa de cambios esperada y exigir filter por branch en el listener.
4. **Cuando la app crezca a 5+ sucursales o 50+ barberos activos**: considerar upgrade del plan Supabase o evaluar materialized view para el panel de fila.
5. **Síntomas de alerta temprana**: lentitud generalizada → si se detecta, NO esperar a que escale a "se cae al login". Diagnosticar de inmediato con la query de `pg_stat_statements` arriba.
