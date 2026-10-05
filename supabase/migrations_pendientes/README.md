# Migraciones pendientes (NO aplicadas)

Estas migraciones están escritas y validadas en un Postgres local, pero **no se
aplicaron en producción** porque dependen de algo que no es SQL: que el deploy
esté hecho y que no quede ninguna tablet con el bundle viejo. Viven fuera de
`supabase/migrations/` a propósito, para que nadie las corra antes de tiempo
(Known Risk #23: una migración en el repo no es una migración aplicada, y una
aplicada antes de hora es el incidente del 10/9, Known Risk #34).

Cuando se aplica una, se mueve a `supabase/migrations/` con el encabezado
«APLICADA en prod el …» en el mismo commit.

## Orden

Ya aplicadas (4/10/2026, después del deploy `d31840e`): `219h` y `224b` — están en `supabase/migrations/`.

| Archivo | Cuándo | Qué cierra |
|---|---|---|
| `216b_productos_sin_lectura_anonima.sql` | **Gate**: todas las tablets y PCs recargadas + 24 h de local abierto con 0 GET anónimos a `/rest/v1/products` | Catálogo con costo y comisión legible por anon |
| `219b_fotos_sin_acceso_anonimo.sql` | **Gate**: 24 h con el local abierto y todo recargado (ver el query del encabezado) | La subida anónima al bucket `visit-photos`, lo único que el bundle viejo sigue usando |
| `223_rostros_staff_sin_anon.sql` | **Gate**: el commit deployado ya no usa `enrollStaffFaceDescriptor` ni `verifyBarberPin`, tablets recargadas y prueba positiva de alta de cara en Test | Biometría del staff: tabla y RPC sólo para `service_role` |
| `224_staff_columnas_sensibles_sin_anon.sql` | **Gate**: inventario sin consultas del browser que nombren `staff.phone`/`commission_pct`, tablets recargadas y 0 GET anónimos que las pidan | Teléfono y comisión del staff legibles por anon (14 orgs) |
| `recuperar_fotos_27ago.sql` | Sólo con el OK del dueño | No es una migración: recupera 2 fotos del 27/8 |

Cada archivo trae en su encabezado el gate exacto (consultas a `query_logs` /
`edge_logs`), la verificación posterior con `curl` y el rollback. Las que tocan
permisos de `anon` se aplican **fuera del horario del local (9 a 21)** y con el
`GRANT` de vuelta listo para pegar.
