import Image from "next/image"

const FEATURES = [
  { label: "Cola en tiempo real", desc: "Gestión de turnos al instante" },
  { label: "Puntos y recompensas", desc: "Fidelizá a tus clientes" },
  { label: "Reseñas automáticas", desc: "Feedback post-visita" },
  { label: "Multi-sucursal", desc: "Todo desde un solo lugar" },
]

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: "oklch(0.07 0 0)" }}>

      {/* ── Panel izquierdo — branding cinematográfico ───────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[50%] xl:w-[52%] shrink-0 flex-col justify-between p-12 xl:p-16 relative overflow-hidden"
        style={{ background: "oklch(0.06 0 0)" }}
      >
        {/* Orbs animados de fondo — más grandes y difusos */}
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full animate-orb-drift"
            style={{
              background:
                "radial-gradient(circle, oklch(0.78 0.12 85 / 0.14) 0%, transparent 65%)",
            }}
          />
          <div
            className="absolute -bottom-40 -right-20 w-[500px] h-[500px] rounded-full animate-orb-drift"
            style={{
              background:
                "radial-gradient(circle, oklch(0.78 0.12 85 / 0.08) 0%, transparent 65%)",
              animationDelay: "-5s",
            }}
          />
          <div
            className="absolute top-1/3 right-1/4 w-[300px] h-[300px] rounded-full animate-orb-drift"
            style={{
              background:
                "radial-gradient(circle, oklch(0.5 0.15 270 / 0.06) 0%, transparent 70%)",
              animationDelay: "-10s",
            }}
          />
          {/* Grilla sutil */}
          <div
            className="absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage:
                "linear-gradient(oklch(1 0 0) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0) 1px, transparent 1px)",
              backgroundSize: "64px 64px",
            }}
          />
          {/* Noise texture overlay */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
            }}
          />
        </div>

        {/* Logo — grande y prominente */}
        <div className="relative z-10 flex items-center gap-4">
          <Image
            src="/bos_icon.png"
            alt="BOS"
            width={48}
            height={48}
            className="brightness-0 invert"
          />
          <Image
            src="/barberos_logo.png"
            alt="barberOS"
            width={160}
            height={40}
            className="brightness-0 invert object-contain"
          />
        </div>

        {/* Tagline central — tipografía hero */}
        <div className="relative z-10 space-y-6">
          <div>
            <h2 className="text-6xl xl:text-7xl font-bold tracking-tight text-white leading-[1.05]">
              Tu barbería,
            </h2>
            <h2
              className="text-6xl xl:text-7xl font-bold tracking-tight leading-[1.05] mt-1"
              style={{
                background: "linear-gradient(135deg, oklch(0.85 0.12 85), oklch(0.68 0.12 65))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              potenciada.
            </h2>
          </div>
          <p className="text-white/30 text-base leading-relaxed max-w-sm">
            El software que necesitás para gestionar tu negocio de la manera más inteligente.
          </p>
        </div>

        {/* Features grid — más visual */}
        <div className="relative z-10 grid grid-cols-2 gap-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.label}
              className="rounded-xl border px-4 py-3 transition-colors hover:border-white/10 hover:bg-white/[0.02]"
              style={{
                borderColor: "oklch(1 0 0 / 0.06)",
                background: "oklch(1 0 0 / 0.02)",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="size-1.5 rounded-full shrink-0"
                  style={{ background: "oklch(0.78 0.12 85)" }}
                />
                <span className="text-sm font-medium text-white/70">{feature.label}</span>
              </div>
              <p className="text-xs text-white/25 pl-3.5">{feature.desc}</p>
            </div>
          ))}
        </div>

        {/* Línea divisora vertical decorativa */}
        <div
          className="absolute top-0 right-0 bottom-0 w-px"
          style={{
            background:
              "linear-gradient(to bottom, transparent, oklch(0.78 0.12 85 / 0.15) 30%, oklch(0.78 0.12 85 / 0.15) 70%, transparent)",
          }}
        />
      </div>

      {/* ── Panel derecho — formulario ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center p-6 lg:p-12 overflow-hidden">
        {/* Header mobile */}
        <div className="lg:hidden flex items-center gap-3 mb-8">
          <Image
            src="/bos_icon.png"
            alt="BOS"
            width={36}
            height={36}
            className="brightness-0 invert"
          />
          <Image
            src="/barberos_logo.png"
            alt="barberOS"
            width={120}
            height={32}
            className="brightness-0 invert object-contain"
          />
        </div>
        <div className="w-full max-w-[400px]">{children}</div>
      </div>
    </div>
  )
}
