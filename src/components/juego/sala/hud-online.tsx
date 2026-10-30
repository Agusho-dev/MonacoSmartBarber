'use client'

import { Flag, LoaderCircle, Menu, Play, Zap } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { ARENAS } from '@/lib/juego/arenas'
import { LENTA_MS, ABANDONO_MS, type Lockstep } from '@/lib/juego/online/lockstep'
import { PERSONAJES } from '@/lib/juego/personajes'
import { VISTA_ANCHO } from '@/lib/juego/tipos'
import type { FichaPersonaje, IdArena, IdPersonaje, Lado, Partida } from '@/lib/juego/tipos'
import { EstadosHud } from '../estados-hud'
import { IconoMaquina } from '../iconos'
import { ImagenJuego } from '../imagen-juego'

/**
 * HUD de una pelea online. Misma estructura y los mismos `data-hud` que hud-pelea.tsx (los
 * escribe src/lib/juego/ui/hud.ts sin re-render), con dos diferencias:
 *  - el HUD trabaja en «vista del jugador» (índice 0 = yo): el sufijo de cada `data-hud` es
 *    ese índice, y `data-lado` es el lado de la PANTALLA (0 izquierda). Si sos el lado 1
 *    (el desafiado), tu barra queda a la derecha, arriba de tu luchador;
 *  - en vez de «CPU», el nombre de cada jugador («Vos» en el tuyo) y la señal de la conexión.
 */
export function HudOnline({
  fichas,
  nombres,
  lado,
  rondasParaGanar,
  segundos,
  onMenu,
}: {
  /** Por lado del mundo (0 = izquierda). */
  fichas: [FichaPersonaje, FichaPersonaje]
  nombres: [string, string]
  lado: Lado
  rondasParaGanar: number
  segundos: number
  onMenu: () => void
}) {
  return (
    <div className="cf-hud cf-hud--online">
      <LadoOnline fisico={0} lado={lado} ficha={fichas[0]} nombre={nombres[0]} rondas={rondasParaGanar} />
      <div className="cf-hud__centro">
        <div className="cf-reloj" data-hud="marco-reloj" aria-hidden="true">
          <span data-hud="reloj">{segundos}</span>
        </div>
        <div className="cf-turbo" data-hud="turbo" aria-hidden="true">
          <Zap />
          <span>Turbo</span>
        </div>
        <button type="button" className="cf-hud__pausa" onClick={onMenu} aria-label="Menú de la pelea">
          <Menu />
        </button>
        <span className="cf-online-senal" data-online="senal" data-calidad="buena" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
      <LadoOnline fisico={1} lado={lado} ficha={fichas[1]} nombre={nombres[1]} rondas={rondasParaGanar} />
    </div>
  )
}

function LadoOnline({
  fisico,
  lado,
  ficha,
  nombre,
  rondas,
}: {
  fisico: Lado
  lado: Lado
  ficha: FichaPersonaje
  nombre: string
  rondas: number
}) {
  const yo = fisico === lado
  const v = yo ? 0 : 1
  return (
    <div
      className="cf-hud__lado"
      data-lado={fisico}
      data-yo={yo ? '' : undefined}
      style={{ '--cf-acento': ficha.color } as CSSProperties}
      aria-hidden="true"
    >
      <div className="cf-hud__cara" data-hud={`cara-${v}`}>
        <ImagenJuego src={ficha.rutas.cara} alt="" tipo="cara" color={ficha.color} espejar={fisico === 1} prioridad />
      </div>
      <div className="cf-hud__barras">
        <div className="cf-hud__fila">
          <span className="cf-hud__nombre">{ficha.nombre}</span>
          <span className="cf-hud__jugador" data-yo={yo ? '' : undefined}>
            {yo ? 'Vos' : nombre}
          </span>
          <EstadosHud lado={v} />
        </div>
        <div className="cf-vida" data-hud={`barra-vida-${v}`} data-nivel="alta">
          <div className="cf-vida__chip" data-hud={`chip-${v}`} />
          <div className="cf-vida__relleno" data-hud={`vida-${v}`} />
        </div>
        <div className="cf-guardia" data-hud={`barra-guardia-${v}`}>
          <div className="cf-guardia__relleno" data-hud={`guardia-${v}`} />
        </div>
        <div className="cf-hud__pie">
          <div className="cf-hud__rondas">
            {Array.from({ length: Math.max(1, rondas) }, (_, i) => (
              <span key={i} className="cf-ronda" data-hud={`ronda-${v}`} />
            ))}
          </div>
          {!yo && (
            <div className="cf-mini-carga">
              <IconoMaquina />
              <div className="cf-mini-carga__barra">
                <div className="cf-mini-carga__relleno" data-hud="carga-rival" />
              </div>
              <span data-hud="carga-rival-num">2</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** «VOS» sobre tu luchador al empezar y el «Conexión lenta…» (los mueve crearCapasOnline). */
export function CapasOnline({ rival }: { rival: string }) {
  return (
    <>
      <div className="cf-online-vos" data-online="vos" aria-hidden="true">
        <span>Vos</span>
      </div>
      <div className="cf-online-lenta" data-online="lenta" role="status" aria-live="polite">
        <LoaderCircle className="cf-girando" aria-hidden="true" />
        <span data-online="lenta-texto">Conexión lenta…</span>
        <span className="cf-online-lenta__rival" data-online="lenta-rival">
          Esperando a {rival}
        </span>
      </div>
    </>
  )
}

export interface CapasOnlineControl {
  actualizar(
    p: Partida,
    lock: Lockstep,
    lienzo: { x: number; y: number; w: number; h: number } | null,
    /** El canal de la pelea está unido: si no, el que se quedó sin red es este celular. */
    conectado: boolean,
  ): void
}

/**
 * Lo de cada cuadro de la pelea online, por refs (nada de setState): dónde va el «VOS», si se
 * muestra «Conexión lenta…» (y cuánto falta para ganar por abandono) o «Sin conexión», y la señal.
 */
export function crearCapasOnline(
  raiz: HTMLElement,
  op: { lado: Lado; personajes: [IdPersonaje, IdPersonaje]; arena: IdArena },
): CapasOnlineControl {
  const vos = raiz.querySelector<HTMLElement>('[data-online="vos"]')
  const lenta = raiz.querySelector<HTMLElement>('[data-online="lenta"]')
  const lentaTexto = raiz.querySelector<HTMLElement>('[data-online="lenta-texto"]')
  const lentaRival = raiz.querySelector<HTMLElement>('[data-online="lenta-rival"]')
  const textoEsperando = lentaRival?.textContent ?? ''
  const senal = raiz.querySelector<HTMLElement>('[data-online="senal"]')
  const suelo = ARENAS[op.arena]?.suelo ?? 0.82
  const altura = PERSONAJES[op.personajes[op.lado]]?.alturaMundo ?? 210
  let vosVisible = false
  let lentaVisible = false
  let textoLenta = ''
  let textoSegundo = textoEsperando
  let calidad = 'buena'
  let esperaReciente = 0

  const marcar = (el: HTMLElement | null, nombre: string, si: boolean) => {
    if (!el) return
    if (si) el.setAttribute(nombre, '')
    else el.removeAttribute(nombre)
  }

  return {
    actualizar(p, lock, lienzo, conectado) {
      // «VOS»: en la presentación, el anuncio y el primer segundo y medio del round 1.
      const mostrarVos =
        p.round === 1 && (p.fase === 'presentacion' || p.fase === 'anuncio' || (p.fase === 'pelea' && p.ticksFase < 90))
      if (vos && lienzo && mostrarVos) {
        const L = p.luchadores[op.lado]
        const esc = lienzo.w / VISTA_ANCHO
        // La cámara arranca con un zoom leve alrededor del centro: se aproxima igual.
        const xRel = 0.5 + (L.x / VISTA_ANCHO - 0.5) * 1.06
        const x = lienzo.x + lienzo.w * xRel
        const y = lienzo.y + lienzo.h * suelo - (Math.max(0, L.y) + altura * 1.06 + 18) * esc
        vos.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
      }
      if (mostrarVos !== vosVisible) {
        vosVisible = mostrarVos
        marcar(vos, 'data-visible', mostrarVos)
      }

      const espera = p.fase === 'terminada' ? 0 : lock.msEsperando()
      const verLenta = espera >= LENTA_MS
      if (verLenta !== lentaVisible) {
        lentaVisible = verLenta
        marcar(lenta, 'data-visible', verLenta)
      }
      if (verLenta && lentaTexto) {
        const faltan = Math.ceil((ABANDONO_MS - espera) / 1000)
        // Sin red de este lado no hay cuenta: el que se fue es este celular, no el otro.
        const t = !conectado
          ? 'Sin conexión'
          : espera > 3000
            ? `Conexión lenta… ${Math.max(0, faltan)}`
            : 'Conexión lenta…'
        if (t !== textoLenta) {
          textoLenta = t
          lentaTexto.textContent = t
        }
        const segundo = conectado ? textoEsperando : 'Reconectando…'
        if (lentaRival && segundo !== textoSegundo) {
          textoSegundo = segundo
          lentaRival.textContent = segundo
        }
      }

      // Señal: buena si la red alcanza para 60 ticks/s sin esperas, regular si frena, mala si espera mucho.
      if (espera > 0) esperaReciente = Math.max(esperaReciente, espera)
      else esperaReciente *= 0.985
      const base = lock.velocidadBase()
      const nueva = verLenta || esperaReciente > 250 ? 'mala' : base < 0.95 || esperaReciente > 60 ? 'regular' : 'buena'
      if (nueva !== calidad && senal) {
        calidad = nueva
        senal.dataset.calidad = nueva
      }
    },
  }
}

/** El botón de pausa online: no hay pausa (la pelea sigue), sólo seguir o abandonar. */
export function MenuOnline({
  rival,
  onSeguir,
  onAbandonar,
}: {
  rival: string
  onSeguir: () => void
  onAbandonar: () => void
}) {
  const [confirmar, setConfirmar] = useState(false)
  return (
    <div className="cf-capa cf-online-menu" role="dialog" aria-modal="true" aria-labelledby="cf-online-menu-titulo">
      <div className="cf-pausa">
        <h2 id="cf-online-menu-titulo" className="cf-titulo cf-online-menu__titulo">
          Sin pausa
        </h2>
        <p className="cf-texto-suave">Es online: la pelea sigue mientras mirás esto.</p>
        <button type="button" className="cf-btn cf-btn--grande cf-pausa__continuar" onClick={onSeguir} autoFocus>
          <Play aria-hidden="true" />
          <span>Seguir peleando</span>
        </button>
        <button
          type="button"
          className="cf-btn cf-btn--sec"
          data-peligro={confirmar ? '' : undefined}
          onClick={() => (confirmar ? onAbandonar() : setConfirmar(true))}
        >
          <Flag aria-hidden="true" />
          <span>{confirmar ? `Tocá de nuevo: gana ${rival}` : 'Abandonar'}</span>
        </button>
      </div>
    </div>
  )
}
