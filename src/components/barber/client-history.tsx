'use client'

import { TiraUltimosCortes } from './tira-ultimos-cortes'

interface ClientHistoryProps {
  clientId: string
}

/**
 * Historial de cortes de un cliente, con sus fotos (variante completa).
 *
 * Antes leía con getClientProfile, que corría con el cliente de Supabase de
 * quien llamaba: en el panel del barbero eso es anon y desde la mig 049 anon lee
 * 0 fotos. "Primera visita del cliente" y "No hay fotos aún" se mostraban para
 * clientes que tenían las dos cosas, y un error se veía igual que "nada".
 * Ahora es un envoltorio de TiraUltimosCortes (server action con service role y
 * estados explícitos).
 */
export function ClientHistory({ clientId }: ClientHistoryProps) {
  return <TiraUltimosCortes clientId={clientId} limite={12} variante="completa" titulo={null} />
}
