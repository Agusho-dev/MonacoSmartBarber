// Loader minimalista para páginas de autenticación
export default function AuthLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="h-8 w-8 rounded-full border-2 border-border border-t-foreground animate-spin" />
    </div>
  )
}
