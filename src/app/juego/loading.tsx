import { LogoCorteFinal } from '@/components/juego/logo-corte-final'

export default function CargandoJuego() {
  return (
    <div className="cf-juego">
      <div className="cf-pantalla cf-arranque" role="status" aria-label="Cargando Corte Final">
        <LogoCorteFinal className="cf-arranque__logo" />
        <span className="cf-arranque__barra" aria-hidden="true">
          <span />
        </span>
      </div>
    </div>
  )
}
