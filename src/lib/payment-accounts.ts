/**
 * Rotación de cuentas de cobro por tope mensual (migración 160).
 *
 * Regla única, compartida por la tablet del barbero y el dashboard, para que las
 * dos pantallas nunca digan cosas distintas sobre qué cuenta está recibiendo:
 *
 *   1. Se recorren las cuentas ACTIVAS por `sort_order`.
 *   2. Recibe la primera que todavía no llegó a su tope del mes.
 *      Una cuenta sin tope (`monthly_limit = null`) nunca se llena.
 *   3. Si todas llegaron al tope, se elige la menos excedida (la que menos se
 *      pasa en proporción) y se avisa: el cobro nunca se bloquea, pero el dueño
 *      tiene que habilitar otra cuenta o cobrar en efectivo.
 *
 * El acumulado (`month_income`) sale de la RPC `get_transfer_accounts_state`, que
 * lo deriva de `transfer_logs` (cobros + propinas transferidas). No hay contador
 * denormalizado: el que existía nunca se escribió (RPC rota con error 42702).
 */

export interface TransferAccountState {
  id: string
  name: string
  alias_or_cbu: string | null
  sort_order: number
  monthly_limit: number | null
  month_income: number
  is_full: boolean
}

export interface TransferAccountPick {
  /** Cuenta que recibe el cobro. `null` si la sucursal no tiene ninguna cuenta activa. */
  account: TransferAccountState | null
  /** Cuentas que se saltearon por estar llenas (en orden). Sirve para avisar que el sistema rotó. */
  skipped: TransferAccountState[]
  /** Todas las cuentas activas llegaron al tope: hay que habilitar otra o cobrar en efectivo. */
  allFull: boolean
}

/** Porcentaje del tope consumido (0–1+). Sin tope → 0. */
export function accountUsage(acc: Pick<TransferAccountState, 'monthly_limit' | 'month_income'>): number {
  if (!acc.monthly_limit || acc.monthly_limit <= 0) return 0
  return acc.month_income / acc.monthly_limit
}

/** Cuánto falta para llegar al tope. Sin tope → null. */
export function accountRemaining(
  acc: Pick<TransferAccountState, 'monthly_limit' | 'month_income'>
): number | null {
  if (!acc.monthly_limit || acc.monthly_limit <= 0) return null
  return Math.max(0, acc.monthly_limit - acc.month_income)
}

/**
 * Elige la cuenta que debe recibir el cobro. `accounts` tiene que venir ordenada
 * por `sort_order` (es como la devuelve la RPC).
 */
export function pickTransferAccount(accounts: TransferAccountState[]): TransferAccountPick {
  if (accounts.length === 0) return { account: null, skipped: [], allFull: false }

  const skipped: TransferAccountState[] = []
  for (const acc of accounts) {
    if (!acc.is_full) return { account: acc, skipped, allFull: false }
    skipped.push(acc)
  }

  // Todas llenas: la menos excedida es la que menos daño hace.
  const leastExceeded = accounts.reduce((best, acc) =>
    accountUsage(acc) < accountUsage(best) ? acc : best
  )
  return {
    account: leastExceeded,
    skipped: skipped.filter((a) => a.id !== leastExceeded.id),
    allFull: true,
  }
}
