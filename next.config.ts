import type { NextConfig } from "next";
import path from "node:path";

/**
 * Versión de ESTE deployment, horneada en el bundle del navegador y en el del
 * servidor (`src/lib/version-app.ts`). La compara la recarga por versión del
 * panel, el kiosko y la TV contra `/api/version` para darse cuenta de que quedó
 * un bundle viejo abierto después de un deploy.
 *
 * Vacía fuera de Vercel (desarrollo, build local): ahí la recarga queda apagada.
 */
const VERSION_APP = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "";

const nextConfig: NextConfig = {
  // Fijar el workspace root explícitamente: hay un package-lock.json huérfano
  // en el directorio padre (MSB_FULL/) que hacía que Turbopack inferiera mal
  // el root y rompiera la resolución de tailwindcss.
  turbopack: {
    root: path.resolve(__dirname),
  },

  env: {
    NEXT_PUBLIC_VERSION_APP: VERSION_APP,
  },

  /* config options here */
  reactCompiler: true,
  // Tree-shake imports de paquetes grandes que se usan parcialmente.
  // Reduce 50-150KB del bundle cliente (especialmente lucide-react que se importa
  // desde cientos de archivos con 8-12 íconos cada uno, y date-fns).
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns', '@radix-ui/react-icons', 'recharts'],
    serverActions: {
      // El default de Next es 1 MB. Se subió cuando la foto de un barbero
      // (2–5 MB, salida de un iPhone) viajaba por server action y, al pasarse,
      // Next rechazaba la llamada antes de llegar al servidor y la pantalla
      // quedaba colgada.
      //
      // En producción este número NO es el techo: Vercel corta cualquier cuerpo
      // de más de 4,5 MB antes de que llegue a Next (413
      // FUNCTION_PAYLOAD_TOO_LARGE), así que los 8 MB sólo aplican en un
      // `next start` local. Por eso ningún archivo grande puede depender de una
      // server action: las fotos del corte suben directo a Storage con una URL
      // firmada (mig 219, src/lib/fotos-corte/subida.ts) y no pasan por acá, y
      // los avatares y logos se comprimen en el browser antes de mandarlos (un
      // avatar termina en ~30 KB). Lo que queda cubierto es el caso raro de un
      // archivo que el browser no sabe decodificar (un HEIC de iPhone) y se
      // manda el original: hasta 4,5 MB llega; más grande, Vercel lo rechaza.
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
