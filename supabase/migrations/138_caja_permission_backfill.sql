-- =============================================================
-- 138 — Backfill del permiso de Caja
--
-- Contexto: hasta ahora el módulo "Caja" (/dashboard/caja) se
-- gateaba con el permiso de Finanzas `finances.view_summary`.
-- Se agregó una categoría propia de permisos "Caja" con
-- `caja.view` y `caja.export`. El nav y el guard de la página
-- ahora exigen `caja.view`.
--
-- Para NO regresionar a los roles existentes (cualquier rol que
-- hoy podía ver la Caja por tener `finances.view_summary=true`),
-- les copiamos el acceso a los nuevos permisos de Caja.
-- Antes no existía gate separado de exportación, así que quien
-- veía la Caja también podía exportar => seteamos ambos en true.
--
-- Idempotente: el WHERE evita re-aplicar sobre roles que ya
-- tienen `caja.view=true`. Seguro de correr más de una vez.
-- =============================================================

UPDATE roles
SET permissions = permissions
    || jsonb_build_object('caja.view', true, 'caja.export', true)
WHERE COALESCE((permissions ->> 'finances.view_summary')::boolean, false) = true
  AND COALESCE((permissions ->> 'caja.view')::boolean, false) = false;
