import { ImageResponse } from 'next/og'

// Ícono para iOS (agregar a inicio): mismo monograma "M" de Monaco.
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
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
            fontSize: 124,
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1,
            letterSpacing: -5,
          }}
        >
          M
        </div>
        <div
          style={{
            width: 64,
            height: 9,
            marginTop: 10,
            borderRadius: 4,
            background: '#d6242c',
          }}
        />
      </div>
    ),
    { ...size }
  )
}
