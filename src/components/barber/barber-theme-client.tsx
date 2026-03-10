'use client'

import { useEffect } from 'react'

export function BarberThemeClient() {
    useEffect(() => {
        // Add barber-theme-root class to html when barber section mounts
        document.documentElement.classList.add('barber-theme-root')
        // Remove when unmounting
        return () => {
            document.documentElement.classList.remove('barber-theme-root')
        }
    }, [])

    return null
}
