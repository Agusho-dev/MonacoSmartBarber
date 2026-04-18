# Auditoría UX/UI — Dashboard Monaco Smart Barber

> **Fecha:** 2026-04-18
> **Alcance:** 14 tabs del sidebar principal + subtabs internas + shell global (mobile + desktop).
> **Metodología:** Exploración paralela de la estructura de rutas (`src/app/dashboard/**`), componentes de UI y patrones de interacción, seguida de síntesis transversal.
> **Objetivo del documento:** servir como backlog compartido de mejoras UX/UI para que el equipo pueda planificar y ejecutar en fases. Todo cambio propuesto acá debe ser validado por product/ownership antes de implementarse.

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Mapa visual de la navegación](#2-mapa-visual-de-la-navegación)
3. [Issues críticos por prioridad](#3-issues-críticos-por-prioridad)
4. [Análisis detallado por sección](#4-análisis-detallado-por-sección)
5. [Patrones transversales](#5-patrones-transversales)
6. [Roadmap de rediseño por fases](#6-roadmap-de-rediseño-por-fases)
7. [Preguntas abiertas para el equipo](#7-preguntas-abiertas-para-el-equipo)

---

## 1. Resumen ejecutivo

La app es **funcionalmente completa pero la arquitectura de información está fragmentada**. Los usuarios nuevos se pierden por falta de jerarquía; los expertos hacen clicks innecesarios por redundancias estructurales.

**Hallazgos principales:**

- **5 redundancias estructurales** en la navegación (rutas duplicadas accesibles desde 2 lugares distintos).
- **Densidad excesiva** en 8 de 14 tabs (demasiados campos, controles o KPIs sin jerarquía visual).
- **Responsive móvil roto** en las 2 pantallas más usadas por los barberos en el día a día (`/fila`, `/turnos/agenda`).
- **Ausencia de patrones transversales**: sin búsqueda consistente, sin comparativas período anterior, sin dirty-flag visibles, sin empty states con CTA.
- **Límites borrosos entre secciones de negocio**: Estadísticas vs Caja vs Finanzas — "¿dónde veo los ingresos de hoy?" tiene 3 respuestas posibles.

**Veredicto:** la UX actual no es intuitiva. Antes de seguir agregando features, recomendamos una fase de **consolidación arquitectónica** (ver [Roadmap](#6-roadmap-de-rediseño-por-fases)).

---

## 2. Mapa visual de la navegación

```
Dashboard (sidebar de 14 items, reorderable)
│
├── / (Overview)
│   └── 3 KPIs + 4 mini-cards + actividad + checklist onboarding lateral
│
├── OPERACIONES
│   ├── /fila ─────────── Kanban en vivo (dinámicos + 1 fila x barbero)
│   │                     └── Tabs: Fila | Turnos del día
│   ├── /turnos ────────── SUBTABS: Agenda · Configuración · Personalización · Link público
│   └── /calendario ────── Horarios semanales + excepciones por barbero (pestaña aislada)
│
├── ORGANIZACIÓN
│   ├── /sucursales ────── Grid de cards + CRUD
│   ├── /equipo ────────── SEGMENTED: Administración | Perfiles
│   │                     └── Admin sub-tabs: Barberos · Calendario · Descansos · Incentivos · Disciplina · Roles
│   ├── /barberos ⚠️ ───── DUPLICADO de /equipo?tab=barberos
│   ├── /servicios ─────── 2 tabs: Servicios | Productos
│   ├── /descansos ⚠️ ─── DUPLICADO de /equipo?tab=descansos
│   ├── /disciplina ⚠️ ─── DUPLICADO de /equipo?tab=disciplina (Reglas · Eventos · Asistencia)
│   ├── /incentivos ⚠️ ── DUPLICADO de /equipo?tab=incentivos (Reglas · Logros)
│   └── /sueldos ──────── Aislado del resto de staff
│
├── CRM / LEALTAD
│   ├── /clientes ──────── Tabla + Sheet lateral con perfil denso
│   ├── /mensajeria ────── 6 secciones: Inbox · Difusiones · Workflows · Alertas · Rápidos · Config
│   ├── /app-movil ─────── 3 tabs: Puntos · Catálogo · Cartelera
│   ├── /fidelizacion ⚠️ ─ DUPLICA Puntos de /app-movil
│   └── /convenios ─────── Tabs por estado + link a /convenios/partners
│
├── ANALÍTICA
│   ├── /estadisticas ──── 4 KPIs + 4 tabs (Tendencias · Ocupación · Barberos · Clientes)
│   ├── /caja ──────────── Tabla diaria de tickets por método de pago
│   └── /finanzas ─────── 5 subtabs: Resumen · Cuentas · Sueldos · Egresos · Gastos fijos
│
└── ADMIN
    ├── /configuracion ── 7 cards planas (Marca, Horarios, Umbrales, Margen, Alerta, Kiosk, Cooldown)
    └── /cuentas ───────── Tabla simple de cuentas de cobro
```

**Leyenda:** ⚠️ = ruta duplicada o redundante respecto de otra existente.

---

## 3. Issues críticos por prioridad

### 🔴 P0 — Arquitectura rota

> **Regla:** estos issues se resuelven antes de seguir agregando features nuevas. Impactan la findability global y generan inconsistencias que se amplifican con cada release.

| # | Problema | Impacto | Fix propuesto |
|---|---|---|---|
| 1 | **4 rutas duplicadas** en organización: `/barberos`, `/descansos`, `/disciplina`, `/incentivos` existen como ruta principal **Y** como subtab de `/equipo` | El usuario no sabe cuál es "la oficial"; mantenimiento doble; inconsistencia semántica | Eliminar las rutas sueltas del nav; dejar solo `/equipo/*` con deep-linking (`/equipo?tab=descansos`) |
| 2 | **`/fidelizacion` duplica** config de puntos con `/app-movil?tab=puntos` | Dos fuentes de verdad; riesgo real de desync | Fusionar ambas en `/app-movil` y borrar `/fidelizacion` |
| 3 | **`/sueldos` aislado** sin pertenecer a `/equipo` ni a `/finanzas` | Context switch innecesario; usuarios lo buscan en ambos lados | Moverlo como subtab de `/equipo/compensacion` o consolidarlo con `/finanzas/sueldos` (que ya existe) |
| 4 | **Estadísticas vs Caja vs Finanzas con límites borrosos** | "¿Dónde veo los ingresos de hoy?" tiene 3 respuestas posibles | Definir contratos: **Estadísticas** = KPIs comportamentales / **Caja** = movimientos del día / **Finanzas** = P&L mensual. Agregar breadcrumbs cruzados |
| 5 | **`/configuracion` plana con 7 cards** sin agrupación + legacy route a turnos ya redirigida | Pobre findability; scroll largo; no queda claro qué afecta kiosk vs web vs admin | Agrupar en tabs internas: **Marca** · **Operaciones** · **Visualización** · **Avanzado** |

### 🟡 P1 — Densidad y responsive

| # | Sección | Problema | Fix propuesto |
|---|---|---|---|
| 6 | `/fila` | Kanban con 8+ columnas horizontales — **inutilizable en mobile** | Vista mobile dedicada: lista agrupada por barbero con swipe entre barberos |
| 7 | `/turnos/agenda` | Grid horizontal de barberos × horas requiere scroll bidimensional en mobile | En viewport <768px, mostrar lista agrupada por hora (fallback al list-view previo) |
| 8 | `/turnos/configuracion` | 14 campos sin grouping; mezcla business rules (horarios) con técnicos (buffer/lead time) | Separar en secciones con `<Separator>` o subtabs internas: **Horarios** · **Slots y buffer** · **Mensajería** · **Pagos** |
| 9 | `/clientes` Sheet lateral | Perfil con notas + Instagram + fotos + stats todo en un scroll vertical denso | Subtabs dentro del Sheet: **General** · **Historial** · **Notas** |
| 10 | `/mensajeria` | 4 botones de toolbar + carousel de quick replies + sidebar 3-col = cluttered | Agrupar acciones secundarias en un `DropdownMenu`; esconder quick replies tras trigger explícito |
| 11 | `/app-movil` modal catálogo | 12 campos sin agrupar | Secciones visuales: **Básicos** / **Precio y canje** / **Disponibilidad** / **Imagen** |
| 12 | `/sucursales` dialog edición | Form muy largo (horarios + mapa + lazy-load geocoding) | Wizard de 2 pasos o collapsible sections |

### 🟡 P1 — Feedback y estados

| # | Problema | Sección(es) afectadas | Fix propuesto |
|---|---|---|---|
| 13 | **Dirty flag invisible** — el usuario puede navegar y perder cambios sin warning | `/turnos/configuracion`, `/turnos/personalizacion`, `/calendario`, `/configuracion` | Barra sticky al fondo con "Tenés cambios sin guardar · Guardar · Descartar" |
| 14 | **Validación solo on-submit** — errores aparecen tarde | `/calendario` (overlap horarios), color pickers que silenciosamente resetean hex inválido | Validación inline con mensaje de error debajo del campo |
| 15 | **Empty states genéricos** sin CTA | Overview, Clientes, Mensajería, Fila | Empty state con icono + copy explicativo + botón primario ("Registrá tu primer cliente") |
| 16 | **Estados de turno ambiguos** | `/turnos/agenda` (confirmed vs checked_in vs in_progress) | Diferenciar con color + icono + tooltip explicando qué acción corresponde en cada estado |
| 17 | **Ventana 24h WhatsApp** se comunica mal | `/mensajeria` | Badge persistente en header de la conversación + explicación en tooltip ("No podés iniciar conversación fuera de la ventana, solo responder con template") |

### 🟢 P2 — Patrones transversales faltantes

| # | Patrón ausente | Dónde duele | Fix propuesto |
|---|---|---|---|
| 18 | **Búsqueda global consistente** | Clientes, Conversaciones, Servicios, Convenios | Input `<SearchBar>` reutilizable + atajo de teclado `⌘K` |
| 19 | **Comparativa período anterior** en KPIs | Estadísticas, Caja, Finanzas, Overview | Mostrar delta ("+5% vs mes pasado") junto a cada valor absoluto |
| 20 | **Exportaciones inconsistentes** | Estadísticas (CSV+PDF), Caja (CSV parcial), Finanzas (ninguna) | Hook `useExport(data, formats)` unificado + botón `<ExportButton>` estándar |
| 21 | **Branch-selector invisible en mobile** | Toda la app | Mover al header mobile o bottom-sheet accesible sin abrir sidebar |
| 22 | **14 items de sidebar sin agrupación** | Shell global | Dividir en 4-5 grupos colapsables: Operaciones / Equipo / CRM / Negocio / Admin |
| 23 | **Integración Turnos↔Mensajería sin closure** | Mensajería | Tras agendar desde chat, insertar automáticamente mensaje de confirmación en el composer (editable antes de enviar) |
| 24 | **Duplicación de título "Inicio"** | `/dashboard` | Eliminar uno de los dos (layout o overview-client) |

---

## 4. Análisis detallado por sección

### 4.1 Operaciones

#### `/dashboard` — Overview

- **Estructura:** Banner onboarding → 3 KPIs horizontales → grid 2/3 contenido + 1/3 checklist lateral → tabla actividad.
- **Acciones primarias:** Continuar onboarding, click cards checklist, cambiar sucursal.
- **Problemas:**
  - Título "Inicio" duplicado entre layout y overview-client.
  - Empty state débil ("No hay actividad reciente" sin CTA).
  - Right-side checklist no responsive (se comprime sin scroll en pantallas chicas).
  - Stats sin contexto ("recurrentes últimos 30 días" pero no compara contra total).

#### `/dashboard/fila`

- **Estructura:** Top bar (título + dropdown "Registrar cliente" + selector sucursal) → descansos scrolleable horizontal → 3 mini-KPIs → Kanban principal (dinámicos + 1 fila x barbero).
- **Acciones primarias:** Registrar cliente (3 opciones), drag & drop, play/check/cancel.
- **Problemas:**
  - **Inutilizable en mobile** (Kanban horizontal sin alternativa).
  - Estados "Fin de turno" y "Sin entrada" con baja diferenciación visual.
  - Feedback de drag-drop genérico ("Descanso asignado" sin nombre del barbero).
  - Labels del dropdown "Registrar cliente" poco diferenciados entre sí.

#### `/dashboard/turnos/*`

4 subtabs: Agenda · Configuración · Personalización · Link público.

- **Agenda:** Grid barberos × horas + side panel de detalle + KPIs horizontales. **Problemas:** 6 KPIs saturan el header, grid ilegible en mobile, empty state ausente si no hay turnos.
- **Configuración:** 14 campos en scroll largo sin agrupación; labels técnicos (buffer, lead-time) sin help text; templates sin link al editor.
- **Personalización:** 2 columnas (controles + preview en device frame). Color pickers con validación silenciosa; falta dirty flag visible.
- **Link público:** Card hero con QR + 3 share chips + lista de sucursales. Si turnos deshabilitados, página queda vacía en lugar de redirect.

#### `/dashboard/calendario`

- **Estructura:** Selector sucursal + barbero → accordion por día + excepciones.
- **Problemas:**
  - Mezcla dos lógicas diferentes (horarios semanales + excepciones) en la misma página.
  - Dialog "Editar Horarios" con inputs HH:MM sin timepicker visual, validación overlap solo on-submit.
  - Sin vista mensual; las excepciones no tienen color-coding.
  - Ruta aislada del resto de `/equipo` siendo que lógicamente le pertenece.

---

### 4.2 Organización

#### `/dashboard/sucursales`

- **Estructura:** Grid de cards + CRUD modal.
- **Problemas:** Dialog de edición largo (geocoding + mapa + horarios), empty state básico, sin filtro por nombre.

#### `/dashboard/equipo`

- **Estructura:** Segmented control (Administración | Perfiles) + 6 subtabs internas en Administración.
- **Problemas críticos:**
  - **Redundancia de 4 rutas** (ver P0 #1).
  - Dialog de "Roles" sobrecargado con categorías expandibles y scope de sucursales.
  - URL params inconsistentes (`?tab=` vs rutas separadas).

#### `/dashboard/barberos` ⚠️ DUPLICADO

Replica `/equipo?tab=barberos`. Fix: eliminar como ruta independiente.

#### `/dashboard/servicios`

- **Estructura:** 2 tabs (Servicios | Productos), CRUD con modales densos (tabla de overrides de comisión dentro del dialog de servicio).
- **Problemas:** Flujo "Vender producto" oculto (solo visible si abrís el modal del item), labels inconsistentes entre ambas tabs.

#### `/dashboard/descansos` ⚠️ | `/disciplina` ⚠️ | `/incentivos` ⚠️

Los 3 son duplicados accesibles también desde `/equipo`. Ver P0 #1.

- **Disciplina:** 3 tabs (Reglas · Eventos · Asistencia). Las reglas no muestran cuándo aplican ("en la 2ª tardanza, $50").
- **Incentivos:** 2 tabs (Reglas · Logros). "Threshold" sin clarificar si es mensual/semanal; period selector solo YYYY-MM.

#### `/dashboard/sueldos`

- **Estructura:** 2 tabs (Configuración | Reportes) con accordion por período.
- **Problemas:** Aislado del resto de staff, dialog de config muy largo, flujo "Descargar PDF" dentro del accordion (requiere expandir).

---

### 4.3 CRM / Lealtad

#### `/dashboard/clientes`

- **Estructura:** Header → selector + búsqueda + 6 filtros por segmento → tabla desktop / cards mobile.
- **Acciones primarias:** Click fila → Sheet lateral con perfil completo.
- **Problemas:**
  - Segmentación automática oculta lógica (VIP=4+ visitas/30d, en riesgo=25+ días sin visita) — sin tooltips.
  - Sheet excesivamente densa (notas + IG + fotos + stats).
  - Sin acción "Llamar/WhatsApp" desde la fila del cliente.

#### `/dashboard/mensajeria`

- **Estructura:** 6 secciones internas (Inbox | Difusiones | Workflows | Alertas | Rápidos | Config) + layout 3-col (lista / chat / profile).
- **Problemas:**
  - **Dialogs apilados posibles** (NewChatDialog + ScheduleDialog + TemplatePicker + SettingsSheet).
  - Turno agendado por `platform_user_id` no se vincula automáticamente con `client.id` en DB (verificar).
  - Densidad del composer: 4 botones + quick replies carousel.
  - Sin facetas de búsqueda (canal activo/inactivo, respondido, ventana 24h expirada).
  - Botones "Ver agenda" + "Agendar turno" funcionan pero falta **closure**: tras agendar no se inserta mensaje de confirmación en el chat.

#### `/dashboard/app-movil`

- **Estructura:** 3 tabs (Puntos | Catálogo | Cartelera).
- **Problemas:**
  - **Puntos duplica** lo que está en `/fidelizacion`.
  - Catálogo sin búsqueda; modal con 12 campos sin agrupación.
  - Cartelera sin preview responsive.

#### `/dashboard/convenios`

- **Estructura:** Stats badges + filtros por estado + tabla de benefits + subruta `/convenios/partners`.
- **Problemas:**
  - Modelo de datos confuso: ¿benefits los crea el partner o el negocio?
  - Sin búsqueda por nombre; reject sin plantillas sugeridas; stats sin drill-down a partner específico.
  - Sin relación visible con cliente ("este cliente canjeó X beneficio").

#### `/dashboard/fidelizacion` ⚠️ DUPLICADO

Mismo config form que `/app-movil?tab=puntos`. Tabla "Top clientes" sin acciones (no se puede enviar mensaje ni agendar turno desde acá). Fix: fusionar con `/app-movil`.

---

### 4.4 Analítica

#### `/dashboard/estadisticas`

- **Estructura:** 4 KPIs + DateRangePicker + 4 tabs (Tendencias · Ocupación · Barberos · Clientes).
- **Problemas:** Sin comparativa mes-a-mes/YoY, heatmap con scroll horizontal en mobile, thresholds de "riesgo/perdido" sin explicación inline.

#### `/dashboard/caja`

- **Estructura:** Fecha + resumen diario + tabla expandible de tickets.
- **Problemas:** Sin comparativa vs ayer, filtros de pago anidados confusos, totales por método solo visibles tras expandir.

#### `/dashboard/finanzas`

- **Estructura:** 5 subtabs (Resumen · Cuentas · Sueldos · Egresos · Gastos fijos).
- **Problemas:**
  - Tab navigation chica en mobile (solo ícono).
  - **Sueldos vs Egresos confuso**: comparten lógica de compensación, no queda claro dónde imputar.
  - Gastos fijos sin comparativa presupuestado vs real.
  - Estructura contable débito/crédito oculta en la UX.

---

### 4.5 Admin

#### `/dashboard/configuracion`

- **Estructura:** Grid 2-col con 7 cards planas (Marca · Horarios · Umbrales · Margen · Alerta · Kiosk · Cooldown).
- **Problemas:**
  - Sin jerarquía (¿cuál editar primero?).
  - Guardar por card independientes = posibles race conditions.
  - Color picker del kiosk con 3 controles redundantes (preset + hex input + picker).
  - Sin feedback de cuál config afecta tablet vs web vs admin.

#### `/dashboard/cuentas`

- **Estructura:** Tabla simple de cuentas de cobro + CRUD modal.
- **Problemas:**
  - Descripción breve sin explicar propósito.
  - Sin totales agregados ("¿cuánto hay en cuentas?").
  - Balance modal carga async sin skeleton.
  - Sin concepto de tipo de cuenta (corriente / billetera / MP).

---

## 5. Patrones transversales

### 5.1 Problemas sistémicos

1. **Densidad excesiva** en 8/14 tabs. Los modales de CRUD típicamente superan 10 campos sin agrupación.
2. **Responsive móvil deficiente** en las pantallas de uso diario del barbero (Fila, Agenda).
3. **Sin dirty flag visible** en 4 pantallas de configuración — riesgo real de perder cambios.
4. **Validación tardía** (on-submit) en calendario, color pickers, formularios de horarios.
5. **Empty states genéricos** sin CTA que invite a la primera acción.
6. **Labels técnicos sin help text**: "buffer", "lead time", "threshold", "cooldown" aparecen sin tooltip.
7. **URL params inconsistentes**: mix de rutas separadas y `?tab=` sin criterio unificado.
8. **Dialogs anidables**: en Mensajería y Servicios, múltiples dialogs pueden apilarse sin control de z-index semántico.

### 5.2 Patrones ausentes (estándares UX que faltan)

| Patrón | Dónde falta | Impacto |
|---|---|---|
| Búsqueda global (`⌘K`) | Todo el dashboard | Alto |
| Comparativa período anterior en KPIs | Overview, Estadísticas, Caja, Finanzas | Alto |
| Export button estándar | Caja, Finanzas | Medio |
| Dirty-flag bar sticky | Todas las configs | Alto |
| Empty state con CTA | Todo el dashboard | Medio |
| Skeleton loaders consistentes | Cuentas (balance modal), fotos en Clientes | Medio |
| Branch selector accesible en mobile | Header global | Alto |

---

## 6. Roadmap de rediseño por fases

### Fase 1 — Consolidación arquitectónica (1 sprint)

**Objetivo:** eliminar redundancias de navegación antes de agregar features nuevas.

- [ ] Eliminar rutas `/dashboard/barberos`, `/descansos`, `/disciplina`, `/incentivos` del nav principal; consolidar bajo `/equipo/*` con deep-linking.
- [ ] Fusionar `/fidelizacion` dentro de `/app-movil?tab=puntos`; agregar sección "Top clientes" allí.
- [ ] Mover `/sueldos` como subtab de `/equipo` o consolidar con `/finanzas/sueldos` (elegir uno).
- [ ] Reagrupar `/configuracion` en 4 tabs internas: Marca · Operaciones · Visualización · Avanzado.
- [ ] Definir contratos explícitos: Estadísticas = comportamental, Caja = diario, Finanzas = mensual. Documentar en `CLAUDE.md`.

**Riesgo:** bajo (solo navegación, sin tocar data).
**Impacto:** alto (baja cognitive load global).

### Fase 2 — Sidebar agrupado (0.5 sprint)

**Objetivo:** reducir los 14 items planos a 4-5 grupos colapsables.

```
Operaciones
  ├── Fila
  ├── Turnos
  └── Calendario
Equipo
  ├── Barberos / Roles / Descansos / ...
  └── Compensación (sueldos + incentivos)
CRM
  ├── Clientes
  ├── Mensajería
  ├── App Móvil
  └── Convenios
Negocio
  ├── Estadísticas
  ├── Caja
  └── Finanzas
Admin
  ├── Sucursales
  ├── Configuración
  └── Cuentas
```

**Riesgo:** medio (toca muscle memory de usuarios existentes — comunicar cambio).
**Impacto:** alto.

### Fase 3 — Responsive crítico (1 sprint)

**Objetivo:** que el barbero pueda usar Fila y Agenda desde el celular.

- [ ] `/fila` mobile: lista agrupada por barbero con swipe entre barberos.
- [ ] `/turnos/agenda` mobile: vista lista (agrupada por hora) en <768px, grilla solo en >=768px.
- [ ] Branch-selector mobile: bottom sheet o trigger en el header mobile.

**Riesgo:** medio.
**Impacto:** alto (day-to-day de los barberos).

### Fase 4 — Patrones transversales (1 sprint)

**Objetivo:** establecer estándares reutilizables que resuelvan 5 issues P1-P2 a la vez.

- [ ] Componente `<DirtyFlagBar>` sticky para todas las configs.
- [ ] Componente `<SearchBar>` + atajo `⌘K` global.
- [ ] Hook `useExport()` + componente `<ExportButton>`.
- [ ] Pattern `<EmptyState>` con icono + copy + CTA primario.
- [ ] Utilidad `<DeltaIndicator>` para KPIs (+5% vs mes pasado).

**Riesgo:** bajo (componentes aislados).
**Impacto:** alto-compuesto (se aplican en >10 pantallas).

### Fase 5 — Polish por sección (iterativo)

**Objetivo:** reducir densidad y mejorar feedback en cada pantalla afectada.

- [ ] Fila: diferenciación visual de estados (Fin de turno, Sin entrada).
- [ ] Agenda: reducir header a 3 KPIs principales + progresivamente revelar el resto.
- [ ] Turnos/Configuración: separar en subtabs internas (Horarios · Slots · Mensajería · Pagos).
- [ ] Clientes Sheet: subtabs internas (General · Historial · Notas).
- [ ] Mensajería composer: colapsar acciones secundarias en dropdown.
- [ ] App-Móvil catálogo: modal agrupado en 4 secciones visuales.
- [ ] Sucursales: dialog como wizard de 2 pasos.
- [ ] Calendario: timepicker visual + validación live + vista mensual.
- [ ] Mensajería: insertar mensaje de confirmación tras agendar turno.
- [ ] Help text en labels técnicos (buffer, lead-time, threshold, cooldown).

**Riesgo:** bajo.
**Impacto:** gradual acumulativo.

---

## 7. Preguntas abiertas para el equipo

Estas decisiones requieren alineación de producto antes de ejecutar las fases:

1. **Redundancia staff**: ¿preferimos mantener `/equipo` como único hub y eliminar las 4 rutas sueltas, o al revés (usar rutas planas y borrar `/equipo`)? Impacta SEO interno, permisos y atajos del usuario.
2. **Sueldos**: ¿va bajo `/equipo` (perspectiva RRHH) o bajo `/finanzas` (perspectiva contable)? Hoy está en ambos lados a medias.
3. **Fidelización**: ¿la borramos definitivamente o sobrevive como dashboard read-only de métricas de engagement? Si la borramos, migrar "Top clientes" a `/app-movil` o a `/clientes` con filtro.
4. **Estadísticas vs Caja vs Finanzas**: ¿quién es el consumidor primario de cada una? Define qué KPIs priorizar en cada pantalla.
5. **Grouping del sidebar**: ¿aceptamos romper muscle memory de usuarios activos a cambio de mejor findability?
6. **Convenios**: modelo de datos — ¿los benefits los crea el partner (flow pending→approved) o el negocio local? Define flujos de aprobación y stats.
7. **Mobile-first en Fila y Agenda**: ¿es prioridad explícita del negocio o aceptamos que el barbero use PC/tablet en el local?

---

## Apéndice: metodología y trazabilidad

- **Fuentes primarias:** `src/app/dashboard/**`, `src/components/dashboard/dashboard-shell.tsx`, `src/components/dashboard/mobile-bottom-nav.tsx`.
- **Exploración paralela:** 4 agentes de exploración cubrieron Operaciones, Organización, CRM/Lealtad y Analítica/Admin respectivamente.
- **Criterios UX aplicados:**
  - Jerarquía visual (Gestalt, F-pattern)
  - Fitts's Law para acciones primarias
  - Hick's Law para navegación
  - Nielsen heurísticas (visibilidad del estado, consistencia, prevención de errores, flexibilidad)
  - Responsive-first para pantallas críticas del barbero

---

**Autor:** auditoría automatizada vía exploración de código.
**Próxima revisión sugerida:** tras completar Fase 1, reevaluar para ajustar prioridades de Fases 2-5.
