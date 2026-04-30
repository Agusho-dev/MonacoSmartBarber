'use client'

import { useState, useRef } from 'react'
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

export function AudioPlayer({ src, isOut }: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [, setIsLoaded] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  // Load duration when metadata is ready
  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration)
      setIsLoaded(true)
    }
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
  }

  const handleEnded = () => {
    setIsPlaying(false)
    setCurrentTime(0)
    if (audioRef.current) {
      audioRef.current.currentTime = 0
    }
  }

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        audioRef.current.play().catch(err => console.error("Error playing audio", err))
      }
      setIsPlaying(!isPlaying)
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    if (audioRef.current) {
      audioRef.current.currentTime = time
      setCurrentTime(time)
    }
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className={`flex flex-col w-full max-w-[240px] px-2.5 py-1.5`}>
      <div className="flex items-center gap-3">
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
        
        {/* Play/Pause Button */}
        <button
          onClick={togglePlay}
          className={`shrink-0 flex items-center justify-center size-9 rounded-full transition-colors ${
            isOut ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-muted hover:bg-muted/80 text-foreground'
          }`}
        >
          {isPlaying ? (
            <Pause className="size-4" />
          ) : (
            <Play className="size-4 ml-0.5" />
          )}
        </button>

        <div className="flex-1 flex flex-col justify-center gap-1 min-w-[120px]">
          {/* Progress Bar Container */}
          <div className="group relative h-4 flex items-center w-full">
            {/* Background Track */}
            <div className={`absolute w-full h-1 rounded-full ${
               isOut ? 'bg-green-800/40' : 'bg-accent-foreground/10'
            }`} />
            
            {/* Progress Track */}
            <div 
              className={`absolute h-1 rounded-full ${
                isOut ? 'bg-green-300' : 'bg-green-500'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
            
            {/* Thumb (visible on hover or always slightly visible) */}
            <div 
              className={`absolute size-3 rounded-full shadow transition-transform 
              ${isOut ? 'bg-white' : 'bg-green-500'} 
              group-hover:scale-110`}
              style={{ 
                left: `calc(${progressPercent}% - 6px)`,
              }} 
            />
            
            {/* Invisible native input range for interaction */}
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="absolute w-full opacity-0 cursor-pointer h-full"
            />
          </div>

          {/* Time Display */}
          <div className="flex justify-between items-center px-1">
            <span className={`text-[10px] tabular-nums font-medium ${
              isOut ? 'text-green-100' : 'text-muted-foreground'
            }`}>
              {formatTime(currentTime)}
            </span>
            <span className={`text-[10px] tabular-nums font-medium ${
              isOut ? 'text-green-100' : 'text-muted-foreground'
            }`}>
              {formatTime(duration)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
