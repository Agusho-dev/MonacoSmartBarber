'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default marker icons (Leaflet + bundlers issue)
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

interface LocationPickerMapProps {
  latitude: number
  longitude: number
  onLocationChange: (lat: number, lng: number) => void
}

export function LocationPickerMap({
  latitude,
  longitude,
  onLocationChange,
}: LocationPickerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center: [latitude, longitude],
      zoom: 15,
      zoomControl: true,
      attributionControl: false,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map)

    const marker = L.marker([latitude, longitude], {
      icon: defaultIcon,
      draggable: true,
    }).addTo(map)

    marker.on('dragend', () => {
      const pos = marker.getLatLng()
      onLocationChange(pos.lat, pos.lng)
    })

    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng)
      onLocationChange(e.latlng.lat, e.latlng.lng)
    })

    mapRef.current = map
    markerRef.current = marker

    // Fix map rendering in dialog (tiles not loading)
    setTimeout(() => map.invalidateSize(), 100)

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update marker and center when coordinates change externally
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return
    const current = markerRef.current.getLatLng()
    if (Math.abs(current.lat - latitude) > 0.0001 || Math.abs(current.lng - longitude) > 0.0001) {
      markerRef.current.setLatLng([latitude, longitude])
      mapRef.current.setView([latitude, longitude], mapRef.current.getZoom())
    }
  }, [latitude, longitude])

  return (
    <div
      ref={containerRef}
      className="h-[200px] w-full rounded-lg border border-input overflow-hidden"
      style={{ zIndex: 0 }}
    />
  )
}
