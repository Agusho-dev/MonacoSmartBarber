/**
 * Versión del deployment que generó ESTE bundle.
 *
 * Sale de `next.config.ts` (`env.NEXT_PUBLIC_VERSION_APP` =
 * `VERCEL_GIT_COMMIT_SHA || VERCEL_DEPLOYMENT_ID || ''`) y Next la reemplaza por
 * el literal al compilar, en el bundle del navegador Y en el del servidor. Por
 * eso `/api/version` devuelve ESTA misma constante y no relee las variables de
 * Vercel en runtime: el bundle del cliente y la ruta del mismo deployment dicen
 * lo mismo por construcción. Si se leyera en runtime y una variable no estuviera
 * (o difiriera de la del build), cada tablet vería "versión nueva" para siempre.
 *
 * Vacía en desarrollo y en cualquier build fuera de Vercel: ahí la recarga por
 * versión queda apagada (`src/lib/recarga-version.ts`).
 *
 * Sin imports a propósito: la importan la ruta (servidor) y el navegador.
 */
export const VERSION_APP: string = process.env.NEXT_PUBLIC_VERSION_APP ?? ''
