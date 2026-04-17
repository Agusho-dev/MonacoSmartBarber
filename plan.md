# Plan de ejecución — BarberOS Pre-Comercialización

**Basado en:** `audit.md` (54 ítems identificados)
**Objetivo:** dejar el sistema listo para que cualquier barbería pueda registrarse, completar onboarding y operar sin fricción crítica, con isolation garantizada, sin branding Monaco, y con observabilidad de la plataforma.

---

## Convenciones de este plan

- **Severidades:** 🔴 P0 (bloquea venta) · 🟠 P1 (bloquea escala) · 🟡 P2 (calidad/perf)
- **Esfuerzo:** XS (≤30 min) · S (≤2 h) · M (≤0.5 día) · L (1-2 días) · XL (3-5 días)
- **Blockers:** una fase no empieza hasta que la anterior cierra.
- **Cada migración SQL** debe ser nueva (numeración timestamp `YYYYMMDDHHMMSS_*.sql`) e idempotente (`IF EXISTS/IF NOT EXISTS`).
- **Rollback plan:** cada migración crítica debe tener su migración inversa documentada en el commit.
- **Owner recomendado:** 1 senior dev backend + 1 frontend + DBA (puede ser mismo dev si sabe SQL).

---

## FASE 0 — Preparación y backup (1/2 día)

**Objetivo:** crear red de seguridad antes de tocar nada crítico de producción.

### 0.1 Snapshot + branch de desarrollo
- [ ] Crear Supabase **branch** ("pre-commercial-cleanup") desde main y trabajar ahí.
- [ ] Tomar snapshot manual `pg_dump` con estado pre-fix.
- [ ] Habilitar logical backups continuos si no están.

### 0.2 Documentar hardcoded Monaco UUID
- [ ] Inventariar todos los lugares donde aparece el UUID `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11` (ver `audit.md` §1.1, §3.x).

### 0.3 Freeze de migraciones duplicadas
- [ ] Abandonar numeración incremental manual → adoptar `supabase migration new <name>` (timestamp).
- [ ] Dejar el histórico de duplicadas 038/039/050/053/057/060/062/063/064 (no renumerar; documentar en `supabase/migrations/README.md`).

### 0.4 Observabilidad pre-fix
- [ ] Activar `pg_stat_statements` en dashboard.
- [ ] Crear alertas en Supabase para RLS Advisor errors.
- [ ] Deploy preview en Vercel apuntando al branch Supabase.

---

## FASE 1 — Security fixes URGENTES (1-2 días) 🔴 P0

**Objetivo:** cerrar agujeros que pueden causar breach de datos, dinero o credenciales. Estos fixes no deben esperar al resto del trabajo.

### 1.1 Migration: cerrar RLS allow_all + API keys IA expuestas
**Migración:** `20260418_p0_security_rls_tightening.sql`

- [ ] `DROP POLICY service_role_full_access ON organization_ai_config;`
      `CREATE POLICY ai_config_service_role_only ON organization_ai_config FOR ALL TO service_role USING (true);`
- [ ] Revocar `SELECT` de `organization_ai_config` a `anon` y `authenticated`. Exponer solo flag `has_openai_key/has_anthropic_key` via RPC.
- [ ] Drop allow_all de: `movimientos_caja`, `gastos`, `sesiones_caja`, `cuentas_transferencia`, `categorias_gasto`, `alertas`, `alumnos`, `asistencias`, `curso_*`, `cursos`, `mensaje_plantillas`, `mensajes_enviados`, `pagos`, `talleres_practica`, `alerta_plantillas_defecto`, `webhook_debug_log`.
- [ ] Reemplazar con policies service-role-only temporalmente (o con `organization_id = get_user_org_id()` si se agrega la columna en 1.3).

**Esfuerzo:** S. **Blocker:** 0.1.

### 1.2 Fix UUID Monaco hardcoded en trigger
**Migración:** `20260418_p0_remove_monaco_uuid_from_trigger.sql`
- [ ] Reemplazar en `update_client_loyalty_state()`:
  ```sql
  v_org_id := COALESCE(
    (SELECT organization_id FROM clients WHERE id = NEW.client_id),
    (SELECT organization_id FROM branches WHERE id = NEW.branch_id)
  );
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'cliente % sin organization_id resolvible', NEW.client_id;
  END IF;
  ```
- [ ] Backfill `client_loyalty_state.organization_id` en filas existentes con valor NULL (si las hay).

**Esfuerzo:** XS.

### 1.3 Agregar `organization_id` a tablas huérfanas financieras
**Migración:** `20260418_p0_add_org_id_to_caja_tables.sql`
- [ ] ALTER TABLE `sesiones_caja`, `movimientos_caja`, `gastos`, `categorias_gasto`, `cuentas_transferencia`: `ADD COLUMN organization_id UUID REFERENCES organizations(id)`.
- [ ] Backfill con Monaco UUID (son las únicas filas actuales).
- [ ] `NOT NULL` + índices.
- [ ] Nuevas policies: `USING (organization_id = get_user_org_id())`.
- [ ] Trigger `set_org_from_session()` BEFORE INSERT.

**Esfuerzo:** M.

### 1.4 Decisión producto: Academia (🚨 requiere owner decision)
- [ ] Definir: ¿Academia es feature de plataforma para todos, o custom Monaco?
- [ ] Si global: agregar `organization_id` a las 11 tablas + RLS org-aware (migración similar a 1.3).
- [ ] Si Monaco-only: mover tablas a schema `monaco_academia` y restringir RLS a un rol dedicado.

**Esfuerzo:** M-L (depende de decisión).

### 1.5 Fix biometría cliente: privatizar `client_face_descriptors`
**Migración:** `20260418_p0_secure_face_descriptors.sql`
- [ ] ALTER TABLE: `ADD COLUMN organization_id UUID NOT NULL REFERENCES organizations(id)`.
- [ ] Backfill desde `clients.organization_id`.
- [ ] Drop policies anon. Solo service role.
- [ ] Cambiar `match_face_descriptor(query, threshold, max, p_org_id)` para que sea llamable vía RPC por anon y **requiera `p_org_id`** — validar que el org está activo.
- [ ] INSERT/DELETE solo desde server action (admin client).

**Esfuerzo:** S.

### 1.6 Fix SSRF en workflow http_request node
**Archivo:** `src/lib/workflow-engine.ts:1110-1143`
- [ ] Validar URL:
  ```ts
  const urlObj = new URL(url)
  if (!['http:', 'https:'].includes(urlObj.protocol)) throw new Error('Protocol no permitido')
  const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc00::|fe80::)/i
  if (BLOCKED_HOSTS.test(urlObj.hostname)) throw new Error('Host privado no permitido')
  ```
- [ ] Agregar tests unitarios para los casos blocked.

**Esfuerzo:** XS.

### 1.7 Fix bug canje de puntos cross-branch
**Archivo:** `src/lib/actions/queue.ts:340-377`
- [ ] Usar `rpc('deduct_client_points', { p_client_id, p_amount: cost })` (ya existe).
- [ ] Cambiar query de `client_points` a `.eq('client_id', id).eq('organization_id', orgId).maybeSingle()`.
- [ ] Tests: canje desde branch A con balance creado en branch B (misma org).

**Esfuerzo:** S.

### 1.8 Fix race condition en `payment_accounts.accumulated_today`
**Migración:** `20260418_p0_atomic_account_accumulator.sql` + `paymentAccounts.ts:178`
- [ ] RPC `increment_account_accumulated(p_account_id UUID, p_amount NUMERIC, p_org_id UUID)` que haga UPDATE atómico.
- [ ] Reemplazar read-modify-write en `recordTransfer`.

**Esfuerzo:** XS.

### 1.9 Fix RLS cross-org (crm_cases, review_requests, scheduled_messages, salary_*)
**Migración:** `20260418_p0_fix_org_scoping_in_rls.sql`
- [ ] Agregar `AND staff.organization_id = get_user_org_id()` a:
  - `crm_cases.staff_manage_crm_cases`
  - `review_requests.staff_manage_review_requests`
  - `scheduled_messages_update_staff` + delete + insert
  - `salary_configs_manage_owner`, `salary_reports_*`, `salary_payment_batches_*`
  - `visit_photos_manage_owner`, `visit_photos_read_by_org`
  - Appointment policies: agregar `WITH CHECK (organization_id = get_user_org_id())` a INSERT/UPDATE
- [ ] Validar con Supabase Advisor post-deploy.

**Esfuerzo:** S.

### 1.10 Fix default de `app_settings.review_message_template`
**Migración:** `20260418_p0_generic_review_template_default.sql`
- [ ] `ALTER TABLE app_settings ALTER COLUMN review_message_template SET DEFAULT '¡Hola {nombre}! Gracias por visitarnos en {barberia} 💈. Nos encantaría saber qué te pareció tu experiencia. Dejanos tu opinión acá: {link_resena} ⭐';`
- [ ] Backfill orgs no-Monaco que tengan el template Monaco: reemplazar por el nuevo con `{barberia}`.
- [ ] Actualizar `src/app/api/cron/...` o donde se renderiza el template para expandir `{barberia}` desde `organizations.name`.

**Esfuerzo:** XS.

---

## FASE 2 — Multi-tenant isolation fundacional (3-4 días) 🔴 P0

### 2.1 Helper universal de ownership en server actions
**Archivo nuevo:** `src/lib/actions/guard.ts`
```ts
export async function requireOrgAccessToEntity(
  table: 'visits' | 'branches' | 'staff' | 'clients' | 'conversations' | ...,
  entityId: string,
  orgId?: string,
): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> { ... }
```
- [ ] Implementar para las 10 tablas críticas (visits, branches, staff, clients, conversations, channels, services, products, reward_catalog, appointments).
- [ ] Cache por request con `React.cache`.
- [ ] Agregar a TODAS las 20+ actions listadas en `audit.md` §5.1.

**Esfuerzo:** L.

### 2.2 Migrar server actions críticas a usar Zod + guard
**Archivos:** `messaging.ts`, `settings.ts`, `paymentAccounts.ts`, `visit-history.ts`, `clients.ts`, `stats.ts`, `caja.ts`, `barber.ts`, `queue.ts`, `services.ts`, `products.ts`, `incentives.ts`, `disciplinary.ts`, `breaks.ts`, `sales.ts`, `roles.ts`, `conversations.ts`, `broadcasts.ts`, `whatsapp-meta.ts`, `tv.ts`, `workflows.ts`.
- [ ] Instalar/usar Zod (ya usado en `partner-portal.ts`).
- [ ] Definir schemas en `src/lib/schemas/*.ts` por dominio.
- [ ] Cada action mutativa: validar input con Zod + llamar `requireOrgAccessToEntity` antes de ejecutar.
- [ ] Audit cada `.or()` con template string: reemplazar o validar UUIDs.

**Esfuerzo:** XL (3-5 días spread).

### 2.3 Migrar canje, stock, accumulated_today a RPCs atómicos
- [ ] `client_redeem_points(client_id, amount, org_id)` — ya existe, asegurar uso.
- [ ] `decrement_product_stock(product_id, qty, org_id)` — nueva.
- [ ] `increment_account_accumulated(...)` — ya propuesta en 1.8.

**Esfuerzo:** S.

### 2.4 Agregar triggers `set_org_from_*` faltantes
**Migración:** `20260419_p1_add_missing_org_triggers.sql`
- [ ] Trigger BEFORE INSERT en las 26 tablas con `organization_id` que no tienen trigger (ver audit §1.13).
- [ ] Función genérica `set_org_from_session()` que use `get_user_org_id()` cuando no haya branch_id/client_id de dónde derivar.

**Esfuerzo:** S.

### 2.5 Fix `get_user_org_id()` para multi-org user
- [ ] Agregar fallback a `auth.jwt() -> 'app_metadata' -> 'active_organization_id'` antes del LIMIT 1.
- [ ] `switchOrganization` server action ya actualiza `app_metadata` — asegurar que funciona.

**Esfuerzo:** XS.

### 2.6 Cookie `barber_session` firmada
- [ ] Implementar HMAC-SHA256 con env var `BARBER_SESSION_SECRET`.
- [ ] Migrar sessions activas sin romper UX.
- [ ] Re-validar `branch_id` + `staff_id` en cada request crítico (tras decodificar).

**Esfuerzo:** S.

### 2.7 Fix `selectOrganizationBySlug` no sobreescriba admin logueado
**Archivo:** `src/lib/actions/org.ts:136`
- [ ] Si `auth.getUser()` retorna user logueado con acceso a otra org, **no** tocar cookie principal. Usar cookie separada `public_organization` para kiosk/TV.

**Esfuerzo:** S.

### 2.8 Fix `getPublicAppCheckinBgColor` filtrar por org activa
**Archivo:** `src/lib/actions/org.ts:102`
- [ ] Leer cookie `active_organization` o `public_organization`, filtrar `app_settings.organization_id = activeOrgId`.

**Esfuerzo:** XS.

---

## FASE 3 — Rebrand BarberOS: eliminar Monaco hardcoded (2-3 días) 🔴 P0

### 3.1 Decisión: nombre del producto
- [ ] Confirmar "BarberOS" como nombre de plataforma (ya visible en login/register). "Monaco Smart Barber" pasa a ser una org más.

### 3.2 Reemplazar 28 ocurrencias de "Monaco Smart Barber"
Lista de archivos (de `audit.md` §2):
- [ ] `src/app/layout.tsx:17` — `title: "BarberOS"` o dinámico por org.
- [ ] `src/app/(tablet)/checkin/page.tsx:1419,1515,1527` — usar `organizations.logo_url` + `organizations.name`.
- [ ] `src/app/tv/tv-client.tsx:453-458` — idem.
- [ ] `public/logo-monaco.png` → renombrar a `/logo-barberos.png` (generic) y dejar como fallback; logo por org leído de storage.
- [ ] `src/components/dashboard/dashboard-shell.tsx:225,249,652` — fallback `"BarberOS"` + usar `currentOrg.name`.
- [ ] `src/app/dashboard/clientes/clientes-client.tsx:727` — mensaje WA dinámico con `orgName`.
- [ ] `src/lib/workflow-engine.ts` — `X-Title: 'BarberOS'`.
- [ ] `src/lib/export.ts:98,207` — `orgName` como param.
- [ ] `src/app/dashboard/equipo/perfiles-client.tsx:775,947` — PDFs de sueldos con `orgName`.
- [ ] `src/app/dashboard/estadisticas/estadisticas-client.tsx:141` — CSV con `orgName`.
- [ ] `src/app/dashboard/finanzas/finanzas-client.tsx:259` — nombre archivo con `orgSlug`.
- [ ] `src/app/(partners)/partners/layout.tsx` — metadata dinámica.
- [ ] `src/app/dashboard/mensajeria/components/workflows/workflow-node-editor.tsx:936` — placeholder IA `{nombre}`.
- [ ] `src/app/docs/page.tsx` — revisar y actualizar.
- [ ] `src/app/review/[token]/review-client.tsx` — copy dinámica con `branch.organization.name`.
- [ ] `src/app/upload/[token]/page.tsx` — idem.
- [ ] `src/app/dashboard/caja/page.tsx` y `cuentas/page.tsx` — títulos genéricos.

**Esfuerzo:** M.

### 3.3 Logo y branding por org en componentes públicos
- [ ] `src/app/(tablet)/checkin/page.tsx`: leer `org.logo_url`, fallback a `/logo-barberos.png`.
- [ ] `src/app/tv/tv-client.tsx`: idem.
- [ ] `src/app/review/[token]/review-client.tsx`: idem.
- [ ] Dashboard shell: `org.logo_url` en sidebar.

**Esfuerzo:** S.

---

## FASE 4 — Internacionalización (timezone, moneda, locale) (2-3 días) 🔴 P0

### 4.1 Schema: agregar campos a `organizations`
**Migración:** `20260420_p1_organizations_i18n_fields.sql`
```sql
ALTER TABLE organizations
  ADD COLUMN country_code  TEXT DEFAULT 'AR',
  ADD COLUMN currency      TEXT DEFAULT 'ARS',
  ADD COLUMN locale        TEXT DEFAULT 'es-AR',
  ADD COLUMN timezone      TEXT DEFAULT 'America/Argentina/Buenos_Aires',
  ADD COLUMN primary_color TEXT DEFAULT '#3f3f46';
```
- [ ] Backfill las 8 orgs existentes con Argentina.
- [ ] NOT NULL tras backfill.

**Esfuerzo:** XS.

### 4.2 Refactor `format.ts` y `time-utils.ts` para aceptar org context
- [ ] `formatCurrency(amount, { currency, locale })` — ya no asume ARS.
- [ ] `formatDate(date, { locale, timezone })`.
- [ ] `getLocalNow(timezone)` — ya existe parametrizado; eliminar defaults hardcoded en callers.
- [ ] Crear hook `useOrgFormatters()` y helper server `getOrgFormatters(orgId)`.

**Esfuerzo:** S.

### 4.3 Reemplazar todos los hardcoded `America/Argentina/Buenos_Aires`
Archivos (grep):
- [ ] `src/lib/actions/finances.ts:147,216`
- [ ] `src/lib/actions/queue.ts:627`
- [ ] `src/lib/actions/disciplinary.ts:175,182,190`
- [ ] `src/lib/actions/sales.ts:179`
- [ ] `src/lib/actions/stats.ts:7`
- [ ] `src/lib/actions/salary.ts:618`
- [ ] `src/lib/actions/onboarding.ts:152`
- [ ] `src/lib/actions/caja.ts:65-70` (critico — afecta reportes financieros)
- [ ] `src/lib/time-utils.ts` (defaults)
- [ ] Todos deben leer `branch.timezone` o `org.timezone`.

**Esfuerzo:** M.

### 4.4 Config UI para timezone/moneda
- [ ] Agregar sección en `/dashboard/configuracion` → "Datos del negocio" con selects de timezone/moneda/idioma.
- [ ] Solo `owner` puede editar.

**Esfuerzo:** S.

---

## FASE 5 — Onboarding: wizard completo + seed defaults (3-4 días) 🟠 P1

### 5.1 Extender wizard (`/onboarding/page.tsx`) a 7 pasos

- [ ] **Paso 1:** Cuenta + Org (existente). Mejorar: preview slug availability en tiempo real, agregar country/timezone/currency.
- [ ] **Paso 2:** Branding — logo + primary_color + nombre visible.
- [ ] **Paso 3:** Primera sucursal — incluir Google Review URL y kiosk bg color.
- [ ] **Paso 4:** Servicios — seed automático de 3 defaults si usuario skipea.
- [ ] **Paso 5:** Equipo — **asignar owner a branch 1 automáticamente como staff activo** + PIN.
- [ ] **Paso 6:** Defaults auto (sin UI): rewards_config, message_templates, auto_reply_rules, appointment_settings, break_configs, staff_schedules del owner.
- [ ] **Paso 7:** Completado + redirige a `/dashboard/fila`.

**Esfuerzo:** L.

### 5.2 Seeds auto (SQL + server actions)
**Nueva migración:** `20260421_p1_org_seed_function.sql`
- [ ] Función `seed_new_organization(p_org_id UUID)` que crea:
  - `rewards_config` default por sucursal (10 pts/visita, umbral 10)
  - `reward_catalog` base (ej. "Corte gratis", "Descuento 20%")
  - `message_templates` base (bienvenida, recordatorio, reseña) con placeholder `{org_name}`
  - `auto_reply_rules` fuera-de-horario, bienvenida
  - `appointment_settings` default (15min slot, 7 días ventana)
  - `break_configs` default (60min almuerzo, 15min café)
  - `alerta_plantillas_defecto` — convertir en semilla por org
  - Roles sugeridos (además de owner): `admin`, `cajero`, `barbero`
- [ ] Llamar desde `registerOrganization()` post-creación.

**Esfuerzo:** M.

### 5.3 Guard `onboarding_completed` en dashboard layout
**Archivo:** `src/app/dashboard/layout.tsx`
- [ ] Si `org.settings.onboarding_completed !== true`, redirigir a `/onboarding`.
- [ ] Permitir salir solo si es dueño y tiene al menos 1 branch.

**Esfuerzo:** XS.

### 5.4 Refactor `registerOrganization` → usar función SQL `setup_organization`
- [ ] La migración 053 ya define `setup_organization(p_name, p_slug, p_owner_email, ...)`. Hacer transaccional.
- [ ] Eliminar rollback manual TS (line 200-211).

**Esfuerzo:** S.

---

## FASE 6 — UX Dashboard foundational (2 días) 🟠 P1

### 6.1 Loading y error boundaries globales
- [ ] `src/app/dashboard/loading.tsx` — skeleton global.
- [ ] `src/app/dashboard/error.tsx` — Error boundary con retry.
- [ ] `src/app/dashboard/finanzas/loading.tsx`, `dashboard/equipo/loading.tsx`, `dashboard/mensajeria/loading.tsx` (las 3 páginas más pesadas).

**Esfuerzo:** S.

### 6.2 Dashboard home con overview real (no redirect)
- [ ] `src/app/dashboard/page.tsx` — NO redirigir a `/fila` por default.
- [ ] Crear overview con: métricas del día, últimas visitas, próximos turnos, checklist de onboarding pendientes si los hay.

**Esfuerzo:** M.

### 6.3 Configuración unificada (no 6 cards con Guardar)
- [ ] Refactor `/dashboard/configuracion` a form único por sección con state local correcto.
- [ ] Dividir en tabs (Negocio, Horarios, Puntos, Mensajería) si queda muy largo.

**Esfuerzo:** M.

### 6.4 Empty states con CTA
- [ ] Clientes: botón "Registrar cliente" + enlace al kiosk.
- [ ] Finanzas: tip "Aún no hay visitas. Empezá registrando la primera en Fila."
- [ ] Fidelización: CTA "Configurar programa de puntos" link a settings.
- [ ] Workflows: botón "Crear primer workflow" + templates sugeridos.

**Esfuerzo:** S.

---

## FASE 7 — Super-admin / plataforma (3-5 días) 🟠 P1

### 7.1 Ruta `/platform/*` para equipo BarberOS

Nueva app o subruta protegida por `platform_admin` role (no es owner de una org — es plataforma).

- [ ] `/platform/orgs` — listado de todas las orgs con uso (visits, staff, clients).
- [ ] `/platform/orgs/[id]` — detalle, toggle active/inactive, cambiar plan.
- [ ] `/platform/orgs/[id]/impersonate` — loguear como owner de esa org para soporte (audit log).
- [ ] `/platform/metrics` — MAU, orgs activas, churn.

### 7.2 Autenticación platform_admin
- [ ] Nueva tabla `platform_admins (user_id UUID PK, created_at)`.
- [ ] Policy en todas las queries de `/platform/*`: `EXISTS SELECT 1 FROM platform_admins WHERE user_id = auth.uid()`.
- [ ] Audit log `platform_admin_actions`.

### 7.3 Billing / plans (MVP)
- [ ] Tabla `subscription_plans (id, name, features jsonb, price_monthly)`.
- [ ] Columna `organizations.subscription_plan_id`.
- [ ] Feature flags lidos en runtime por `app_settings`.
- [ ] (Integración Stripe/MercadoPago: fase 9 si aplica).

**Esfuerzo total fase 7:** XL.

---

## FASE 8 — Performance y calidad DB (1-2 días) 🟡 P2

### 8.1 Fix 81 `auth_rls_initplan` warnings
**Migración:** `20260422_p2_wrap_auth_in_select.sql`
- [ ] Auto-generar script que recrea las 81 policies con `(SELECT auth.fn())`.
- [ ] Validar post-deploy con Advisor.

**Esfuerzo:** S.

### 8.2 Consolidar 247 `multiple_permissive_policies`
- [ ] Por cada tabla con policies superpuestas, fusionar en una sola por rol+cmd.
- [ ] Usar `RESTRICTIVE` cuando se quiera AND.

**Esfuerzo:** M.

### 8.3 Drop 11 índices duplicados
**Migración:** `20260422_p2_drop_duplicate_indexes.sql`
- [ ] Drop de `idx_*_org_id` en favor de `idx_*_org` (o viceversa, consistencia).

**Esfuerzo:** XS.

### 8.4 Agregar 83 índices a FKs
**Migración:** `20260422_p2_index_foreign_keys.sql`
- [ ] Script que genere `CREATE INDEX CONCURRENTLY` para cada FK sin índice.

**Esfuerzo:** S.

### 8.5 Revisar/drop 92 unused indexes
- [ ] Decidir por cada uno: drop o keep (algunos pueden ser hot path no aún hit en prod nueva).

**Esfuerzo:** S.

### 8.6 Denormalizar `organization_id` en `conversations` y `messages`
**Migración:** `20260422_p2_denormalize_org_in_messaging.sql`
- [ ] Agregar `organization_id` a ambas, backfill via join, NOT NULL, simplificar RLS.

**Esfuerzo:** S.

---

## FASE 9 — Rate limiting, auth hardening, code quality (2 días) 🟠 P1 / 🟡 P2

### 9.1 Rate limit endpoints públicos
- [ ] PIN login (`/barbero/login`) — 5 intentos/min por IP.
- [ ] Kiosk checkin (`checkinClient`) — 20/min por branch.
- [ ] Review submit — 1/token (ya es único).
- [ ] `lookupClientByPhone` — 10/min por user.
- [ ] Usar Upstash/Redis o Vercel KV.

**Esfuerzo:** M.

### 9.2 PIN compare constant-time
- [ ] `auth.ts:44` → `crypto.timingSafeEqual`.

**Esfuerzo:** XS.

### 9.3 Password policy
- [ ] Min 8 chars + complexity en `register.ts`.

**Esfuerzo:** XS.

### 9.4 Code quality
- [ ] Eliminar 49 `any` en dashboard (typear con `src/lib/types/database.ts`).
- [ ] Eliminar `toggleBarberStatus` dead code.
- [ ] Consolidar `salary_payments` vs `salary_reports`.
- [ ] Drop tablas caja huérfanas si se decide mantener stack viejo.

**Esfuerzo:** M.

---

## FASE 10 — Fidelización reconectada (1-2 días) 🟠 P1

### 10.1 UI leer `client_loyalty_state` real
- [ ] `/dashboard/fidelizacion` → mostrar `client_loyalty_state` (2282 filas reales) en vez de `client_points` vacío.
- [ ] Canje funcional con RPC atómico.

**Esfuerzo:** M.

### 10.2 Seed `rewards_config` por defecto en onboarding
- [ ] Cubierto en 5.2.

### 10.3 Workflow delay status separado de waiting_reply
**Archivo:** `src/lib/workflow-engine.ts:949`
- [ ] `status = 'delayed'` cuando delay >10s.
- [ ] `evaluateIncomingMessage` excluye `status='delayed'` del match.
- [ ] `processExpiredDelays` busca `status='delayed'`.

**Esfuerzo:** S.

### 10.4 Workflow sibling conv lookup filter por org
**Archivo:** `src/lib/workflow-engine.ts:227`
- [ ] Filtrar `siblingConvs` por `channel.branch_id IN (branches de la org)`.

**Esfuerzo:** XS.

---

## FASE 11 — Monitoreo y QA antes de venta (continuo)

### 11.1 Smoke test: crear org nueva e intentar operar
- [ ] Script `scripts/smoke-new-org.ts` que:
  1. Crea org nueva
  2. Completa wizard
  3. Crea 2 sucursales, 3 barberos, 5 servicios
  4. Simula 10 check-ins + servicios
  5. Canje de puntos
  6. Envío de review
  7. Liquidación de sueldos
  8. Cierre de caja

### 11.2 Test RLS cross-org (pgTap)
- [ ] Con `pgtap` ya instalada, escribir suite que verifique isolation en todas las 32 tablas con `organization_id`.

### 11.3 Sentry + logs
- [ ] Instrumentar Sentry.
- [ ] Centralizar logs Vercel → Logtail/Datadog.

---

## Orden de ejecución sugerido (cronograma)

| Semana | Fases | Entregable |
|---|---|---|
| **Semana 1** | Fase 0 + Fase 1 (P0 security) | Agujeros críticos cerrados |
| **Semana 2** | Fase 2 (isolation) + Fase 3 (rebrand) | Sistema multi-tenant-safe y sin "Monaco" hardcoded |
| **Semana 3** | Fase 4 (i18n) + Fase 5 (onboarding) | Nueva org puede completar setup sola |
| **Semana 4** | Fase 6 (UX dashboard) + Fase 10 (fidelización) | UX pulido para demos |
| **Semana 5** | Fase 7 (super-admin) | Equipo BarberOS puede operar soporte |
| **Semana 6** | Fase 8 (perf DB) + Fase 9 (hardening) + Fase 11 (QA) | Sistema listo para comercializar |

**Total:** 4-6 semanas full-time con 1-2 devs.

---

## Métricas de éxito

- [ ] 0 ítems 🔴 P0 abiertos en `audit.md`.
- [ ] Supabase Security Advisor: 0 ERROR, <5 WARN.
- [ ] Script smoke-test passa end-to-end con una org nueva sin asistencia.
- [ ] 0 ocurrencias de `Monaco Smart Barber` en código + DB defaults.
- [ ] 0 tablas con RLS `USING (true)` en tablas con datos de usuarios/dinero.
- [ ] Todas las server actions mutativas usan Zod + guard.
- [ ] Al menos 2 orgs nuevas reales onboardeadas exitosamente (alpha).

---

## Decisiones abiertas (requieren owner)

1. **Academia**: ¿feature de plataforma o Monaco-only?
2. **Stack caja**: ¿mantener tablas viejas (`expense_tickets`, `transfer_logs`) y dropear nuevas, o migrar?
3. **Pricing**: ¿modelo SaaS (freemium? tiers?) para definir feature flags.
4. **Multi-device**: los clientes mobile hoy son single-device (ver CLAUDE.md §Risks). ¿entra en v1 de comercialización?
5. **Moneda/país default**: ¿Argentina sigue siendo el default o LatAm genérico?
6. **Timezone por sucursal** (existe) **vs por org**: definir qué gana si difieren.
7. **`platform_admin`**: ¿usuarios dedicados o reutilizar cuenta Anthropic/Google workspace?

---

## Apéndice — Comandos operativos

```bash
# Snapshot antes de aplicar fase 1
pg_dump <DB_URL> > pre-commercial-$(date +%Y%m%d).sql

# Aplicar migraciones P0 (fase 1)
supabase db push --linked

# Validar RLS post-deploy
supabase db lint
# o via MCP: get_advisors(security) + get_advisors(performance)

# Smoke test
npx tsx scripts/smoke-new-org.ts --slug test-$(date +%s)

# Rollback en caso de problema
supabase db reset --linked   # (si branch, sino restore del dump)
```
