'use client'

// El modelo de IA en una celda de iOS (configuración de la IA y de las
// etiquetas): el menú del sistema con los modelos conocidos, agrupados por
// proveedor (MODEL_GROUPS), y «Otro de OpenRouter…», que abre un campo para
// pegar el ID y usarlo. En el iPhone es la rueda nativa. Reemplaza en la
// configuración al ModelPicker del dashboard (letra de 9 a 12 px y una lista
// propia); el editor de automatizaciones sigue con ese.

import { useState } from 'react'
import { BotonTextoCeldaIos, CeldaCampoIos, CeldaSelectorIos } from '../navegacion/lista-ios'
import { MODEL_GROUPS } from '../shared/model-picker'

const OTRO = '__otro__'
const CONOCIDOS = new Set(MODEL_GROUPS.flatMap((g) => g.models.map((m) => m.id)))
const OPCIONES = [
  ...MODEL_GROUPS.flatMap((g) =>
    g.models.map((m) => ({ valor: m.id, texto: m.free ? `${m.label} (gratis)` : m.label, grupo: g.provider })),
  ),
  { valor: OTRO, texto: 'Otro de OpenRouter…', grupo: 'Otro' },
]

export function CeldaModeloIos({
  etiqueta,
  valor,
  onCambio,
}: {
  etiqueta: string
  valor: string
  /** Se llama al elegir un modelo de la lista o al tocar «Usar» con un ID pegado. */
  onCambio: (id: string) => void
}) {
  const conocido = CONOCIDOS.has(valor)
  // Un modelo que no está en la lista (uno de OpenRouter pegado a mano) se
  // muestra en el campo, con «Otro» elegido arriba.
  const [pegando, setPegando] = useState(!conocido)
  const [pegado, setPegado] = useState(conocido ? '' : valor)
  const elegido = pegando || !conocido ? OTRO : valor
  const usar = () => {
    const id = pegado.trim()
    if (id) onCambio(id)
  }

  return (
    <>
      <CeldaSelectorIos
        etiqueta={etiqueta}
        valor={elegido}
        opciones={OPCIONES}
        onCambio={(v) => {
          if (v === OTRO) {
            setPegando(true)
            return
          }
          setPegando(false)
          onCambio(v)
        }}
      />
      {elegido === OTRO && (
        <CeldaCampoIos
          etiqueta="ID del modelo en OpenRouter"
          placeholder="google/gemma-2-9b-it:free"
          valor={pegado}
          onCambio={setPegado}
          derecha={
            <BotonTextoCeldaIos onClick={usar} deshabilitado={!pegado.trim() || pegado.trim() === valor}>
              Usar
            </BotonTextoCeldaIos>
          }
        />
      )}
    </>
  )
}
