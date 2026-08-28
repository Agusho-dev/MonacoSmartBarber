// Constantes compartidas del inbox de mensajería.
//
// Viven acá y no en `src/lib/actions/conversations.ts` porque ese archivo es
// `'use server'` y sólo puede exportar funciones async: una constante exportada
// desde ahí compila con `tsc` pero **rompe `next build`**. Misma razón que
// `src/lib/push/constants.ts`.

/**
 * Cuántas conversaciones trae cada página de la lista.
 *
 * Hay un tope duro por encima de esto: PostgREST corta en 1000 filas
 * (`max-rows`). El inbox pedía las conversaciones sin `.limit()` y se comía ese
 * tope en silencio — con 6.367 conversaciones mostraba sólo los últimos 10 días
 * y el resto era inalcanzable. Cualquier valor acá tiene que ser < 1000 y el
 * resto llega por `loadMoreConversations`.
 */
export const INBOX_PAGE_SIZE = 200
