/**
 * Envoltorio del audio del juego para la UI.
 *
 *  - Crea el AudioJuego recién la primera vez que se usa, siempre en el cliente (en el
 *    servidor no hay WebAudio).
 *  - Cada llamada va con try/catch: si el audio falla, el juego sigue mudo.
 *  - Recuerda la música pedida para no reiniciar el mismo tema dos veces.
 */
import { crearAudio, diagnosticarAudio, VOLUMEN_EFECTOS_POR_DEFECTO, VOLUMEN_MUSICA_POR_DEFECTO } from '../audio'
import type { AudioJuego, EventoJuego, Partida, SonidoUi, TemaMusica } from '../tipos'
import { publicarDepuracion } from './depuracion'

/**
 * Los niveles con los que se calibró la mezcla (la canción, con NIVEL_PISTA de musica.ts, queda
 * ≈ 7 dB por debajo de un golpe fuerte): subirlos acá deja la música encima de los golpes y
 * aprieta el limitador.
 */
const VOLUMEN_EFECTOS = VOLUMEN_EFECTOS_POR_DEFECTO
const VOLUMEN_MUSICA = VOLUMEN_MUSICA_POR_DEFECTO

export class AudioSeguro {
  private audio: AudioJuego | null = null
  private roto = false
  private silencio = false
  private musicaPrendida = true
  private tema: TemaMusica | null = null

  private obtener(): AudioJuego | null {
    if (this.roto || typeof window === 'undefined') return null
    if (!this.audio) {
      try {
        const audio = crearAudio()
        this.audio = audio
        audio.silenciar(this.silencio)
        audio.volumen(VOLUMEN_EFECTOS, this.musicaPrendida ? VOLUMEN_MUSICA : 0)
        publicarDepuracion('audio', () => diagnosticarAudio(audio))
      } catch (error) {
        console.error('[juego] audio no disponible', error)
        this.roto = true
        this.audio = null
      }
    }
    return this.audio
  }

  /** En el primer toque del usuario (iOS no deja sonar antes). */
  desbloquear(): void {
    const a = this.obtener()
    if (!a) return
    try {
      a.desbloquear().catch(() => {})
    } catch {
      // idem
    }
  }

  ui(sonido: SonidoUi): void {
    try {
      this.obtener()?.ui(sonido)
    } catch {
      // Un sonido de interfaz que falla no merece romper nada.
    }
  }

  procesar(eventos: readonly EventoJuego[], p: Partida): void {
    // Es lo único de la UI que recibe la partida en cada cuadro: el gancho de pruebas
    // (sólo en desarrollo) la toma de acá.
    publicarDepuracion('partida', p)
    const a = this.audio ?? this.obtener()
    if (!a) return
    try {
      a.procesar(eventos, p)
    } catch {
      // idem
    }
  }

  musica(tema: TemaMusica | null): void {
    if (tema === this.tema) return
    this.tema = tema
    try {
      this.obtener()?.musica(tema)
    } catch {
      // idem
    }
  }

  configurar(sonido: boolean, musica: boolean): void {
    this.silencio = !sonido
    this.musicaPrendida = musica
    if (!this.audio) return
    try {
      this.audio.silenciar(this.silencio)
      this.audio.volumen(VOLUMEN_EFECTOS, musica ? VOLUMEN_MUSICA : 0)
    } catch {
      // idem
    }
  }

  destruir(): void {
    try {
      this.audio?.destruir()
    } catch {
      // idem
    }
    this.audio = null
    this.tema = null
  }
}
