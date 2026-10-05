/**
 * Lo que la pantalla de fila (`/tv`) lee de cada entrada, en UN solo lugar.
 *
 * La TV es pública —una pantalla colgada en el salón, sin sesión— y la llenan
 * dos caminos: la carga inicial de `src/app/tv/page.tsx` (server component, lo
 * que devuelve viaja como props al browser) y `refreshTvQueue` (server action,
 * en cada evento de Realtime y cada 30 s). Los dos corren con service role, así
 * que lo que pidan es lo que reciben.
 *
 * Pedían `clients(*)` y `staff(*)`: viajaban a la pantalla el teléfono, el
 * email, las notas, el `pin_hash` y el `face_embedding` de cada cliente de la
 * fila, y el PIN en texto plano de cada barbero (la mig 212 se hizo para que
 * eso no llegara nunca a un browser). La TV dibuja el nombre del cliente y el
 * nombre y la foto del barbero; es todo lo que se pide.
 *
 * `queue_entries` va con `*` a propósito: no guarda credenciales, la anon key
 * ya la lee entera, y la TV necesita casi todas sus columnas (estado, orden,
 * turno, dinámico, descansos). Listarlas sólo haría que una columna nueva de la
 * fila no llegue a la pantalla.
 *
 * Embeds por nombre de constraint (Known Risk #15): una segunda FK de
 * `queue_entries` a `staff` o a `clients` haría que PostgREST rechace la query
 * ENTERA con PGRST201 y la TV se quedaría sin fila.
 */
export const TV_QUEUE_SELECT =
  '*, client:clients!queue_entries_client_id_fkey(id, name), barber:staff!queue_entries_barber_id_fkey(id, full_name, avatar_url)'
