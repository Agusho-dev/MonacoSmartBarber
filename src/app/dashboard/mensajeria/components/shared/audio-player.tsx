'use client'

import { useState, useRef, useMemo } from 'react'
import { Play, Pause } from 'lucide-react'

interface AudioPlayerProps {
  src: string
  isOut: boolean
}

function formatTime(seconds: number) {
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const BAR_COUNT = 34

// Waveform determinístico derivado del src (sin decodificar el audio: evita
// problemas de CORS con el CDN de Meta/Supabase y es instantáneo). WhatsApp Web
// también muestra una onda pseudo-aleatoria hasta que decodifica el archivo.
function useWaveform(src: string) {
  return useMemo(() => {
    let seed = 0
    for (let i = 0; i < src.length; i++) seed = (seed * 31 + src.charCodeAt(i)) >>> 0
    // LCG inline (sin closure `rand()`): el React Compiler no puede probar que una
    // función que reasigna `seed` no escape del render y lo marca como error.
    // La secuencia de valores es idéntica a la versión con closure.
    const bars: number[] = []
    for (let i = 0; i < BAR_COUNT; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const rand = seed / 0x7fffffff
      // Perfil tipo "voz": más energía al centro, algo de variación aleatoria.
      const centerBias = 1 - Math.abs(i - BAR_COUNT / 2) / (BAR_COUNT / 2)
      const h = 0.28 + rand * 0.72 * (0.5 + centerBias * 0.5)
      bars.push(Math.max(0.18, Math.min(1, h)))
    }
    return bars
  }, [src])
}

export function AudioPlayer({ src, isOut }: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const bars = useWaveform(src)

  const handleLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration)
  }
  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime)
  }
  const handleEnded = () => {
    setIsPlaying(false)
    setCurrentTime(0)
    if (audioRef.current) audioRef.current.currentTime = 0
  }

  const togglePlay = () => {
    if (!audioRef.current) return
    if (isPlaying) audioRef.current.pause()
    else audioRef.current.play().catch((err) => console.error('Error playing audio', err))
    setIsPlaying(!isPlaying)
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    if (audioRef.current) {
      audioRef.current.currentTime = time
      setCurrentTime(time)
    }
  }

  const progress = duration > 0 ? currentTime / duration : 0
  const playedBars = Math.round(progress * BAR_COUNT)

  // Colores de WhatsApp, con los tokens de .wa-scope: lo reproducido en azul
  // (saliente) o verde (entrante), lo que falta en un tono apagado del texto.
  const playedColor = isOut ? 'var(--wa-tick)' : 'var(--wa-accent)'
  const restColor = isOut
    ? 'color-mix(in oklab, var(--wa-bubble-text) 35%, transparent)'
    : 'color-mix(in oklab, var(--wa-text-2) 45%, transparent)'
  const timeColor = isOut ? 'var(--wa-meta-out)' : 'var(--wa-meta-in)'

  return (
    <div className="flex items-center gap-2.5 w-full max-w-[248px] pl-1 pr-2 py-1.5">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        className="hidden"
      />

      {/* Play/Pause */}
      <button
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
        className={`shrink-0 flex items-center justify-center size-9 rounded-full transition-colors text-[var(--wa-bubble-text)] ${
          isOut ? 'bg-white/15 hover:bg-white/25' : 'bg-white/10 hover:bg-white/15'
        }`}
      >
        {isPlaying ? <Pause className="size-4" /> : <Play className="size-4 ml-0.5" />}
      </button>

      {/* min-w-0: en una burbuja angosta (el chat de 356 px de la compu a 1024)
          la onda se achica con ella en vez de empujar la burbuja hacia afuera. */}
      <div className="flex-1 flex flex-col justify-center gap-1 min-w-0">
        {/* Waveform */}
        <div className="relative h-6 flex items-center">
          <div className="flex items-center gap-[2px] w-full h-full overflow-hidden" aria-hidden="true">
            {bars.map((h, i) => (
              <span
                key={i}
                className="flex-1 rounded-full transition-colors"
                style={{
                  height: `${Math.round(h * 100)}%`,
                  minWidth: 2,
                  backgroundColor: i < playedBars ? playedColor : restColor,
                }}
              />
            ))}
          </div>
          {/* Seek (invisible, accesible) */}
          <input
            type="range"
            min={0}
            max={duration || 100}
            step="any"
            value={currentTime}
            onChange={handleSeek}
            aria-label="Buscar en el audio"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>

        {/* Tiempo: al reproducir muestra transcurrido; en reposo, duración total */}
        <span className="text-[11px] tabular-nums font-medium" style={{ color: timeColor }}>
          {formatTime(isPlaying || currentTime > 0 ? currentTime : duration)}
        </span>
      </div>
    </div>
  )
}
