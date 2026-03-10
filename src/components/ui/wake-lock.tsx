'use client'

import { useEffect, useRef } from 'react'

export function WakeLock() {
    const wakeLockRef = useRef<any>(null)

    useEffect(() => {
        let isMounted = true

        const requestWakeLock = async () => {
            try {
                if ('wakeLock' in navigator) {
                    // @ts-ignore
                    wakeLockRef.current = await navigator.wakeLock.request('screen')
                    console.log('Wake Lock is active!')

                    wakeLockRef.current.addEventListener('release', () => {
                        console.log('Wake Lock was released')
                    })
                }
            } catch (err: any) {
                console.error(`${err.name}, ${err.message}`)
            }
        }

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && isMounted) {
                requestWakeLock()
            }
        }

        // Only request block in browser environment
        if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
            requestWakeLock()
            document.addEventListener('visibilitychange', handleVisibilityChange)
        }

        return () => {
            isMounted = false
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange)
            }
            if (wakeLockRef.current) {
                wakeLockRef.current.release().catch(console.error)
            }
        }
    }, [])

    return null
}
