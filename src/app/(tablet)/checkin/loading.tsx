// Loader full-screen para el kiosk de check-in (tablet)
export default function CheckinLoading() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-zinc-900">
      <div className="h-12 w-12 rounded-full border-4 border-zinc-700 border-t-white animate-spin" />
      <p className="text-sm font-medium text-zinc-400 tracking-wide uppercase">
        Cargando...
      </p>
    </div>
  )
}
