import { listRecentPlatformActions } from '@/lib/actions/platform'

export const dynamic = 'force-dynamic'

export default async function PlatformAuditLog() {
  const actions = await listRecentPlatformActions(200)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800/50 text-left text-zinc-400">
            <tr>
              <th className="px-4 py-2 font-medium">Fecha</th>
              <th className="px-4 py-2 font-medium">Admin</th>
              <th className="px-4 py-2 font-medium">Acción</th>
              <th className="px-4 py-2 font-medium">Target org</th>
              <th className="px-4 py-2 font-medium">Payload</th>
            </tr>
          </thead>
          <tbody>
            {actions.map(a => (
              <tr key={a.id} className="border-t border-zinc-800 align-top">
                <td className="px-4 py-2 text-xs text-zinc-500">{new Date(a.created_at).toLocaleString('es-AR')}</td>
                <td className="px-4 py-2 font-mono text-xs">{a.admin_user_id.slice(0, 8)}…</td>
                <td className="px-4 py-2">{a.action}</td>
                <td className="px-4 py-2 font-mono text-xs">{a.target_org_id?.slice(0, 8) ?? '—'}</td>
                <td className="px-4 py-2 text-xs text-zinc-500">
                  <pre className="whitespace-pre-wrap break-words">{JSON.stringify(a.payload, null, 0)}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
