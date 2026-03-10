'use client'

import { useState, useEffect } from 'react'
import { Maximize, Minimize } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function FullscreenButton() {
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)

        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement)
        }

        document.addEventListener('fullscreenchange', handleFullscreenChange)
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }, [])

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch((err) => {
                console.error(`Error attempting to enable fullscreen: ${err.message}`)
            })
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen()
            }
        }
    }

    if (!mounted) return null

    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            className="fixed bottom-4 right-4 z-[100] rounded-full bg-background/80 backdrop-blur-md border border-border/50 shadow-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground md:bottom-6 md:right-6 md:h-12 md:w-12 h-10 w-10"
            aria-label="Toggle Fullscreen"
        >
            {isFullscreen ? (
                <Minimize className="size-5" />
            ) : (
                <Maximize className="size-5" />
            )}
        </Button>
    )
}
