# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Monaco Smart Barber dashboard — internal web app for barber shop management. Built with Next.js 16 (App Router) + Supabase + TypeScript + Tailwind CSS v4. Shares a Supabase backend with the Flutter mobile app at `../Monaco-mobile`.

## Commands

```bash
npm run dev      # Start dev server (port 3000)
npm run build    # Production build
npm run lint     # ESLint
npm start        # Run production build
```

No test framework is configured. Database migrations are applied with `supabase db push`. Edge functions are deployed with `supabase functions deploy <name>`.

## Architecture

### Three distinct user interfaces, one app

| Interface | Route prefix | Auth method | Layout |
|---|---|---|---|
| Admin dashboard | `/dashboard/*` | Supabase Auth (email+password) | Sidebar shell |
| Barber panel | `/barbero/*` | PIN → cookie (`barber_session`) | Dark theme, wake-lock |
| Check-in kiosk | `/(tablet)/checkin` | Public (branch selection) | Fullscreen tablet |
| TV display | `/tv` | Public | Queue monitor |
| Review page | `/review/[token]` | Public token | Standalone |

### Data flow pattern

Pages are **server components** that fetch data via Supabase server client → pass props to **client components** (`'use client'`) for interactivity. Mutations go through **server actions** in `src/lib/actions/`.

### Supabase clients

- `src/lib/supabase/client.ts` — browser client (SSR-safe via `@supabase/ssr`)
- `src/lib/supabase/server.ts` — server client + `createAdminClient()` (service role, bypasses RLS)

The dashboard uses `createAdminClient()` for most server-side data fetching, so RLS policies primarily affect the mobile app and public routes.

### Key directories

```
src/
├── app/                    # Next.js App Router pages
├── components/
│   ├── ui/                 # shadcn/ui primitives
│   ├── dashboard/          # Admin dashboard components
│   ├── barber/             # Barber panel components
│   └── checkin/            # Check-in kiosk components
├── lib/
│   ├── actions/            # Server actions (~35 files, one per domain)
│   ├── supabase/           # Supabase client factories
│   ├── types/database.ts   # All TypeScript interfaces for DB tables
│   ├── permissions.ts      # Role-based permission checks
│   ├── format.ts           # Currency (ARS), date, datetime formatters
│   ├── time-utils.ts       # Timezone/local time helpers
│   └── utils.ts            # cn() helper (clsx + tailwind-merge)
└── stores/
    └── branch-store.ts     # Zustand store for branch filtering
```

### Multi-tenant organizations

Migrations 047+ added a multi-org layer. Each barber shop is an `organizations` row. Staff belong to an org via `organization_id` on the `staff` table; owners/admins can also belong via `organization_members`. `getCurrentOrgId()` in `src/lib/actions/org.ts` resolves the active org from the session cookie. The dashboard layout (`src/app/dashboard/layout.tsx`) uses this to scope all queries.

Role-based access also supports per-branch scoping via the `role_branch_scope` table — non-owner roles can be restricted to specific branch IDs.

### Messaging integrations

`supabase/functions/wa-incoming/` handles inbound WhatsApp/Instagram webhooks (Meta Business API). `supabase/functions/process-scheduled-messages/` sends queued outbound messages on a cron. Server actions for messaging live in `src/lib/actions/messaging.ts`, `whatsapp-meta.ts`, `instagram-meta.ts`, `conversations.ts`, and `tags.ts`.

### Channels org-scope (migración 103)

`social_channels` es **org-scope**: un canal puede tener `branch_id=NULL` (default org-wide) o un `branch_id` específico (legacy/exclusivo de sucursal). Para resolver canales WhatsApp de una org, usar siempre `.eq('organization_id', orgId)` — **nunca** `.in('branch_id', branchIds)`, porque eso excluye los canales org-wide. Saltarse esta regla rompió todo el flujo de reseñas entre 21/abr y 22/abr 2026 (templates llegaban a Meta pero no se registraban en `messages` ni se creaba `workflow_execution`).

### Post-service automation flow

Cuando una visita se completa (`queue.ts → completeVisit`), el sistema busca `automation_workflows` con `trigger_type='post_service'` activos para esa org+sucursal y programa un `scheduled_messages` por workflow matching. El cron `process-scheduled-messages` (corre cada minuto vía pg_cron) hace 3 cosas: envía el template a Meta Cloud API, inserta el mensaje en `messages` (para el inbox), y crea la `workflow_execution` apuntando al siguiente nodo del workflow (status `waiting_reply`). Cuando el cliente responde al template, `/api/webhooks/whatsapp` resuelve la execution activa y avanza al nodo según `condition_value`.

`overlap_policy='skip_if_active'` en `automation_workflows`: `queue.ts` chequea antes de encolar si ya hay un `scheduled_message` pending o una `workflow_execution` activa para ese cliente+workflow, y si hay, no re-encola.

Patrón obligatorio en edge functions: siempre chequear `error` de cada `.insert()/.update()`. Sin eso, fallos silenciosos como el bug de migración 103 son imposibles de detectar desde logs.

### Realtime

Supabase Realtime WebSocket subscriptions on `queue_entries` and `staff` power the live queue in the barber panel and TV display.

### Edge Functions

`supabase/functions/` contains three Deno functions:
- `wa-incoming` — inbound webhook for WhatsApp & Instagram messages
- `process-scheduled-messages` — cron-triggered outbound message sender
- `client-auth` — mobile app client authentication

### Cron jobs

**No usar CRON_SECRET ni `vercel.json` crons en este proyecto.** El plan Vercel Hobby limita crons a 2 entradas con schedule diario y romper esos límites bloquea los deploys. Mantener `vercel.json` como `{}`.

Los crons se disparan desde **pg_cron en Supabase** (ver migración 087) haciendo un HTTP request al route handler correspondiente en `/api/cron/*`. Las rutas deben ser **idempotentes** (safe de ejecutar más de una vez y safe de ser hit manualmente, porque no hay auth). Los crons existentes en `/api/cron/auto-clockout` y `/api/cron/process-appointments` todavía referencian `CRON_SECRET` por legacy, pero las rutas nuevas no deben agregar esa validación.

## Conventions

- **Language**: UI text and code comments in Spanish
- **Path alias**: `@/*` maps to `./src/*`
- **UI components**: shadcn/ui — add new ones with `npx shadcn@latest add <component>`
- **State**: Zustand for global state (branch selection only); React `useState` for local UI; server actions for mutations
- **No middleware.ts**: Auth is checked per-route in layout components
- **React Compiler** is enabled in `next.config.ts`
- **Formatting**: Currency uses ARS locale, dates use `date-fns` with Spanish locale

## SQL Migrations

Located in `supabase/migrations/`, numbered sequentially (currently `001` through `056`). Always use `IF NOT EXISTS`/`IF EXISTS` for idempotency. Comments in Spanish. Migrations 030–036 added mobile app support; 047–051 added multi-tenant org support. Changes to those tables affect the Flutter mobile app (`../Monaco-mobile`).

## Environment Variables

Required in `.env`:
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public anon key
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only, bypasses RLS
