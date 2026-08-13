import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Fijar el workspace root explícitamente: hay un package-lock.json huérfano
  // en el directorio padre (MSB_FULL/) que hacía que Turbopack inferiera mal
  // el root y rompiera la resolución de tailwindcss.
  turbopack: {
    root: path.resolve(__dirname),
  },

  /* config options here */
  reactCompiler: true,
  // Tree-shake imports de paquetes grandes que se usan parcialmente.
  // Reduce 50-150KB del bundle cliente (especialmente lucide-react que se importa
  // desde cientos de archivos con 8-12 íconos cada uno, y date-fns).
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns', '@radix-ui/react-icons', 'recharts'],
    serverActions: {
      // El default es 1 MB y las fotos que sube el dueño salen de un iPhone:
      // 2–5 MB cada una. Al pasarse, Next rechaza la llamada ANTES de que
      // llegue al servidor, la promesa se rechaza y la pantalla se queda
      // colgada — así se murió la carga de la foto de un barbero.
      //
      // Es un colchón, no el arreglo: las imágenes se comprimen en el browser
      // antes de mandarlas (un avatar termina en ~30 KB). Esto cubre el caso
      // en que el browser no pueda decodificar el archivo (un HEIC de iPhone)
      // y haya que subir el original.
      bodySizeLimit: '8mb',
    },
  },
  images: {
    // Logos de organización + avatares de staff/clientes vienen del bucket
    // público de Supabase. Necesario para que <Image> de next/image los acepte
    // y aplique optimización + caching CDN.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'gzsfoqpxvnwmvngfoqqk.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async headers() {
    return [
      {
        // Apply no-cache headers a rutas dinámicas SOLAMENTE.
        // Excluye /_next/static (chunks JS/CSS/fonts hash-nombrados, immutables),
        // /_next/image (CDN de imágenes optimizadas) y favicon.
        // El patrón anterior '/:path*' aplicaba no-store a TODO incluyendo bundles
        // hasheados, derrotando el caching del CDN y forzando re-download en cada nav.
        source: '/((?!_next/static|_next/image|favicon.ico).*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
        ],
      },
    ]
  },
};

export default nextConfig;
