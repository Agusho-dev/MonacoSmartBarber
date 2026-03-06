export default function TabletLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh bg-background text-foreground overflow-hidden">
      {children}
    </div>
  )
}
