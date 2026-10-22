// =============================================================================
// El borrado con "Deshacer" del historial de Tex, sin React ni sonner (se los
// pasa la pantalla): así se prueba solo.
//
// La conversación se esconde al instante y el borrado de verdad corre cuando
// el aviso se va (a los 5 s, o si la persona lo cierra). Si la persona se va
// de la pantalla antes, el borrado corre igual Y el aviso se cierra: el
// Toaster vive en el layout raíz y sobrevive a la navegación, así que el
// "Deshacer" quedaba visible y tocarlo no hacía nada (ya se había borrado).
// =============================================================================

export type IdAviso = string | number

export interface AvisosDeBorrado {
  /** Muestra "Borraste la conversación" con [Deshacer] y devuelve el id del aviso. */
  mostrar: (opciones: { descripcion: string; onDeshacer: () => void; onCerrar: () => void }) => IdAviso
  cerrar: (id: IdAviso) => void
  /** "Deshacer" llegó tarde: el borrado ya se hizo. */
  tarde: () => void
}

export interface BorradosConDeshacer {
  /** Programa el borrado: corre al irse el aviso; "Deshacer" lo cancela. */
  programar: (id: string, descripcion: string, borrar: () => void | Promise<void>, deshacer: () => void) => void
  /** La pantalla se va: los borrados pendientes se hacen ya y sus avisos se cierran. */
  alSalir: () => void
}

export function crearBorradosConDeshacer(avisos: AvisosDeBorrado): BorradosConDeshacer {
  const pendientes = new Map<string, { ejecutar: () => void; aviso: IdAviso | null }>()
  return {
    programar(id, descripcion, borrar, deshacer) {
      let resuelto = false
      const entrada: { ejecutar: () => void; aviso: IdAviso | null } = {
        ejecutar: () => {
          if (resuelto) return
          resuelto = true
          pendientes.delete(id)
          void borrar()
        },
        aviso: null,
      }
      pendientes.set(id, entrada)
      entrada.aviso = avisos.mostrar({
        descripcion,
        onDeshacer: () => {
          if (resuelto) {
            avisos.tarde()
            return
          }
          resuelto = true
          pendientes.delete(id)
          deshacer()
        },
        onCerrar: () => entrada.ejecutar(),
      })
    },
    alSalir() {
      for (const { ejecutar, aviso } of [...pendientes.values()]) {
        ejecutar()
        if (aviso != null) avisos.cerrar(aviso)
      }
    },
  }
}
