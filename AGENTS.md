# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Monaco Smart Barber is a multi-branch barbershop management SaaS built with Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui, and Supabase (PostgreSQL + Auth + Realtime + RLS). See `README.md` for routes, project structure, and full setup instructions.

### Running the app

- **Dev server:** `npm run dev` (port 3000)
- **Build:** `npm run build`
- **Lint:** `npm run lint` (pre-existing warnings/errors in the codebase; ESLint exits non-zero but this is expected)

### Environment variables

The app requires a `.env.local` file with three Supabase credentials:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Without real Supabase credentials, the UI renders fully but backend operations (auth, data queries) will fail. Placeholder values are sufficient for frontend-only development and build verification.

### Key caveats

- There are no automated tests in this codebase (no test runner, no test files).
- The ESLint config uses `eslint-config-next` v16 flat config. `npm run lint` reports pre-existing errors/warnings but the tool itself works correctly.
- Supabase is used as a cloud BaaS only; there is no local Supabase CLI config (`supabase/config.toml` is absent). Database migrations live in `supabase/migrations/` and must be applied via the Supabase SQL editor.
- The barber login page (`/barbero/login`) uses a light theme while other pages use dark theme.
