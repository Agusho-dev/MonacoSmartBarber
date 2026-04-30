'use client'

import { useState, useEffect, useSyncExternalStore } from 'react'
import { Maximize, Minimize } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Subscribe-once helper to know if the component is mounted on the client.
// Using useSyncExternalStore avoids setState-inside-effect lint errors.
function subscribeNoop() {
    return () => {}
}

export function FullscreenButton() {
    const [isFullscreen, setIsFullscreen] = useState(false)
    const mounted = useSyncExternalStore(
        subscribeNoop,
        () => true, // client snapshot
        () => false, // server snapshot
    )

    useEffect(() => {
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
            className="fixed top-2 right-2 z-[30] rounded-full bg-background/70 backdrop-blur-md border border-border/40 shadow-sm hover:bg-muted/60 text-muted-foreground hover:text-foreground h-8 w-8 md:top-3 md:right-3 md:h-10 md:w-10 opacity-60 hover:opacity-100 transition-opacity"
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
