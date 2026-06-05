import { ImageResponse } from 'next/og'

// Favicon generado: monograma "M" de Monaco en los colores de marca
// (gris oscuro + blanco + acento rojo). El wordmark completo "MONACO BARBER
// STUDIO" es ilegible a tamaño favicon, así que lo destilamos a la inicial.
export const size = { width: 64, height: 64 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#393939',
        }}
      >
        <div
          style={{
            fontSize: 46,
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1,
            letterSpacing: -2,
          }}
        >
          M
        </div>
        <div
          style={{
            width: 24,
            height: 4,
            marginTop: 3,
            borderRadius: 2,
            background: '#d6242c',
          }}
        />
      </div>
    ),
    { ...size }
  )
}
