import 'server-only'

import { getCurrentOrgId } from '@/lib/actions/org'

/**
 * El error para cuando `validateBranchAccess` dice que no.
 *
 * `validateBranchAccess` devuelve null por dos motivos muy distintos: la
 * sucursal es de otra organización, o quien llama ya no tiene sesión. El que
 * pasa de verdad es el segundo: la cookie del panel del barbero dura 14 h y el
 * navegador la borra con el panel abierto. Desde ahí, Atender y Cobrar
 * contestaban «No autorizado para esta sucursal», que manda a buscar un permiso
 * que nadie tocó (Pueyrredón, 28/oct/2026). Sin sesión, se dice eso.
 *
 * El texto es neutro a propósito: estas acciones también se llaman desde el
 * dashboard, donde no hay PIN. En el panel, el vigía de la sesión
 * (src/lib/vigia-sesion-panel.ts) lleva a la pantalla del PIN.
 *
 * Módulo plano y no 'use server': un export de un archivo 'use server' es un
 * endpoint, y esto no tiene por qué serlo.
 */
export async function errorSinAccesoASucursal(): Promise<string> {
  return (await getCurrentOrgId()) ? 'No autorizado para esta sucursal' : 'Tu sesión venció. Volvé a entrar para seguir.'
}
