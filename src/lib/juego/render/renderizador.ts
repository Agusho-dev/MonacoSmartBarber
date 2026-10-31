/**
 * El renderizador: arma la escena, procesa los eventos drenados del motor, avanza los efectos en
 * tiempo real (dtMs, aunque el motor esté en hitstop o cámara lenta) y dibuja el cuadro.
 *
 * Orden del cuadro: arena → luces → sombras y reflejos → grieta del sismo y polvo de atrás →
 * luchadores (el que pega adelante; el agarrado, delante de Brian) → proyectiles (los de Simón y
 * Chipi y los del elenco nuevo, arsenal.ts) → partículas → tajos → números y textos de impacto →
 * super flash → viñeta → banda del especial → destello → anuncios y combos. El HUD es DOM.
 */
import { PERSONAJES } from '../personajes'
import { VISTA_ANCHO } from '../tipos'
import type {
  CuadroAtlas,
  EventoJuego,
  IdPersonaje,
  Lado,
  LuchadorEstado,
  OpcionesRender,
  Partida,
  RecursosJuego,
  Renderizador,
} from '../tipos'
import { actualizarArsenal, dibujarArsenal, dibujarArsenalFondo, Rastros } from './arsenal'
import { actualizarCamara, ajustarCamara, crearCamara } from './camara'
import type { Calidad, Escena } from './escena'
import { prepararEfectos } from './efectos'
import { alImpactoAnimacion, procesarEventos, type Mundo } from './eventos'
import { liberarLienzo, pilaDeFuentes } from './lienzo'
import {
  actualizarVisual,
  cambiarAtlasVisual,
  crearVisual,
  dibujarLuchador,
  dibujarReflejo,
  dibujarSombra,
  liberarAtlas,
  liberarVisual,
  planoDe,
  prepararAtlas,
  prepararAtlasPelado,
  reiniciarVisual,
  type AtlasPreparado,
  type VisualLuchador,
} from './luchadores'
import {
  actualizarSuperFlash,
  apagarSuperFlash,
  crearDestello,
  crearEscenario,
  crearSuperFlash,
  dibujarDestello,
  dibujarFondo,
  dibujarLuces,
  dibujarSuperFlashBanda,
  dibujarSuperFlashMundo,
  dibujarVineta,
  liberarEscenario,
  liberarSuperFlash,
  prepararEscenario,
  type Escenario,
} from './pantalla'
import { dibujarParticulas, emitirBrillos, emitirPolvo, Particulas, Tajos } from './particulas'
import { actualizarProyectiles, dibujarProyectiles } from './proyectiles'
import type { RecursosConEfectos } from './recursos'
import { crearSprites } from './sprites'
import { Textos } from './textos'
import { crearUtileria } from './utileria'
import { acotar, azar, mezcla, pasoSuave } from './util'

const LIMITE_PARTICULAS: Record<Calidad, number> = { alta: 250, media: 150, baja: 70 }
const DENSIDAD: Record<Calidad, number> = { alta: 1, media: 0.6, baja: 0.35 }

/** La gorra que le vuela al que recibe el ¡AL CERO! (Chipi): un sprite suelto de su hoja de rapado. */
interface Gorra {
  activa: boolean
  quieta: boolean
  img: CanvasImageSource | null
  c: CuadroAtlas | null
  /** Unidades de mundo por px del atlas (la del luchador). */
  esc: number
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  mira: 1 | -1
  botes: number
}

const GRAVEDAD_GORRA = 1500

function caido(l: LuchadorEstado): boolean {
  return l.estado === 'ko' || l.estado === 'derribado'
}

/** Quién va adelante: el agarrado (lo levantan delante); el que pega; si nadie, el jugador 1; el caído, atrás. */
function ladoAdelante(p: Partida): Lado {
  const a = p.luchadores[0]
  const b = p.luchadores[1]
  if (a.estado === 'agarrado') return 0
  if (b.estado === 'agarrado') return 1
  if (caido(a) && !caido(b)) return 1
  if (caido(b) && !caido(a)) return 0
  if (b.estado === 'atacando' && a.estado !== 'atacando') return 1
  return 0
}

export function crearRenderizadorImpl(
  canvas: HTMLCanvasElement,
  recursos: RecursosJuego,
  opciones: Partial<OpcionesRender> = {},
): Renderizador {
  const calidad: Calidad = opciones.calidad === 'media' || opciones.calidad === 'baja' ? opciones.calidad : 'alta'
  const ctx0 = canvas.getContext('2d', { alpha: false })
  if (!ctx0) throw new Error('Corte Final: el navegador no dio un contexto 2D para el juego')
  const ctx: CanvasRenderingContext2D = ctx0
  const def = recursos.arena.def
  const cam = crearCamara(def.suelo)
  const E: Escena = {
    ctx,
    cam,
    calidad,
    densidad: DENSIDAD[calidad],
    parts: new Particulas(LIMITE_PARTICULAS.alta, LIMITE_PARTICULAS[calidad]),
    tajos: new Tajos(),
    spr: crearSprites(),
    util: crearUtileria(),
    fx: prepararEfectos((recursos as RecursosConEfectos).efectosComunes),
    ms: 0,
    s: 0,
    sueloY: cam.sueloY,
    familias: {
      titulo: pilaDeFuentes(opciones.fuentes?.titulo, canvas),
      numeros: pilaDeFuentes(opciones.fuentes?.numeros ?? opciones.fuentes?.titulo, canvas),
    },
    escalaTextos: 1,
  }
  let escenario: Escenario = crearEscenario(def, recursos.arena.imagen)
  const aspecto = escenario.altoImg > 0 ? escenario.anchoImg / escenario.altoImg : 16 / 9
  const textos = new Textos(E)
  textos.numerosVisibles = opciones.numerosDeDanio !== false
  const vis: [VisualLuchador, VisualLuchador] = [crearVisual(0), crearVisual(1)]
  const atlasPorId = new Map<IdPersonaje, AtlasPreparado | null>()
  const atlasLados: [AtlasPreparado | null, AtlasPreparado | null] = [null, null]
  const rapados = (recursos as RecursosConEfectos).rapados ?? {}
  const peladoPorId = new Map<IdPersonaje, { at: AtlasPreparado; lienzo: HTMLCanvasElement } | null>()
  /** Quién quedó pelado en esta partida (el remate dura hasta el final). */
  const pelado: [boolean, boolean] = [false, false]
  const gorra: Gorra = {
    activa: false,
    quieta: false,
    img: null,
    c: null,
    esc: 1,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: 0,
    vr: 0,
    mira: 1,
    botes: 0,
  }
  const destello = crearDestello()
  const sf = crearSuperFlash()
  /** Seguimiento de los proyectiles del elenco nuevo (estallidos al desaparecer, grieta, nube). */
  const rastros = new Rastros()
  let mundo: Mundo | null = null
  let listo = false
  let destruido = false
  let errorAvisado = false
  let anchoCss = 0
  let altoCss = 0
  let dprPedido = 1

  function atlasDe(id: IdPersonaje): AtlasPreparado | null {
    if (atlasPorId.has(id)) return atlasPorId.get(id) ?? null
    const r = recursos.atlas[id]
    const ficha = PERSONAJES[id]
    let at: AtlasPreparado | null = null
    if (r && ficha) at = prepararAtlas(ficha, r.datos, r.imagen)
    if (!at) console.error(`[juego] falta el atlas de «${id}»: se dibuja una silueta`)
    atlasPorId.set(id, at)
    return at
  }

  /** El atlas pelado de un luchador: se arma la primera vez que hace falta (un lienzo como el atlas). */
  function atlasPelado(id: IdPersonaje): AtlasPreparado | null {
    if (peladoPorId.has(id)) return peladoPorId.get(id)?.at ?? null
    const base = recursos.atlas[id]
    const rapado = rapados[id]
    const ficha = PERSONAJES[id]
    let hecho: { at: AtlasPreparado; lienzo: HTMLCanvasElement } | null = null
    if (base && rapado && ficha) {
      try {
        hecho = prepararAtlasPelado(ficha, base.datos, base.imagen, rapado)
      } catch (e) {
        console.warn(`[juego] no se pudo armar el atlas pelado de «${id}»`, e)
      }
    }
    peladoPorId.set(id, hecho)
    return hecho?.at ?? null
  }

  function liberarPelados(): void {
    for (const hecho of peladoPorId.values()) {
      if (!hecho) continue
      liberarAtlas(hecho.at)
      liberarLienzo(hecho.lienzo)
    }
    peladoPorId.clear()
  }

  /** Centro de la cabeza en mundo-pantalla, con el cuadro que el motor dejó (rapado.json: «cabezas»). */
  function cabezaDe(l: LuchadorEstado, v: VisualLuchador): { x: number; y: number } | null {
    const at = v.at
    if (!at) return null
    const f = at.cuadros[planoDe(at, l)]
    if (!f) return null
    const e = at.escala
    const yPie = E.sueloY - l.y
    const izq = l.mira < 0 ? l.x - (f.w - f.ax) * e : l.x - f.ax * e
    const arriba = yPie - f.ay * e
    const lista = l.anim === 'danio' || l.anim === 'ko' ? rapados[l.id]?.datos.cabezas?.[l.anim] : undefined
    const c = lista?.[l.cuadro]
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return { x: izq + (f.w * e) / 2, y: arriba + 18 }
    return { x: izq + (l.mira < 0 ? f.w - c[0] : c[0]) * e, y: arriba + c[1] * e }
  }

  /** ¡AL CERO!: el lado queda pelado hasta el final y, si tenía gorra, le vuela. Devuelve su cabeza. */
  function rapar(lado: Lado): { x: number; y: number } | null {
    const M = mundo
    if (!M) return null
    const l = M.p.luchadores[lado]
    const v = vis[lado]
    const cabeza = cabezaDe(l, v)
    const at = atlasPelado(l.id)
    if (!at) return cabeza
    const conGorra = v.at !== at
    cambiarAtlasVisual(v, at, calidad !== 'baja')
    pelado[lado] = true
    const r = rapados[l.id]
    const extra = r?.datos.extras?.gorra
    const c = extra?.cuadros?.[0]
    if (conGorra && r && c && cabeza && c.w > 0 && c.h > 0) {
      const mira: 1 | -1 = l.mira < 0 ? -1 : 1
      const d = Array.isArray(extra.desfase) ? extra.desfase : [0, -6]
      gorra.activa = true
      gorra.quieta = false
      gorra.img = r.imagen
      gorra.c = c
      gorra.esc = at.escala
      gorra.mira = mira
      gorra.x = cabeza.x + mira * (Number(d[0]) || 0) * at.escala
      gorra.y = cabeza.y + (Number(d[1]) || 0) * at.escala
      // sale para atrás (lejos del que remató), alto y girando
      gorra.vx = -mira * azar(140, 200)
      gorra.vy = -azar(560, 680)
      gorra.vr = -mira * azar(9, 13)
      gorra.rot = 0
      gorra.botes = 0
    }
    return cabeza
  }

  function moverGorra(dtS: number): void {
    if (!gorra.activa || gorra.quieta || !gorra.c) return
    gorra.vy += GRAVEDAD_GORRA * dtS
    gorra.x += gorra.vx * dtS
    gorra.y += gorra.vy * dtS
    gorra.rot += gorra.vr * dtS
    if (gorra.x < 24 || gorra.x > VISTA_ANCHO - 24) {
      gorra.x = acotar(gorra.x, 24, VISTA_ANCHO - 24)
      gorra.vx = -gorra.vx * 0.5
    }
    const piso = E.sueloY - gorra.c.h * gorra.esc * 0.4
    if (gorra.y >= piso && gorra.vy > 0) {
      gorra.y = piso
      gorra.botes++
      emitirPolvo(E, gorra.x, E.sueloY, 3, 12, 0.6)
      if (gorra.botes >= 3 || gorra.vy < 160) {
        // queda tirada en el piso, derecha o dada vuelta
        gorra.quieta = true
        gorra.rot = Math.round(gorra.rot / Math.PI) * Math.PI
      } else {
        gorra.vy = -gorra.vy * 0.38
        gorra.vx *= 0.55
        gorra.vr *= 0.5
      }
    }
  }

  function dibujarGorra(): void {
    const c = gorra.c
    if (!gorra.activa || !gorra.img || !c) return
    const k = cam.esc * gorra.esc
    const sx = k * gorra.mira
    const cs = Math.cos(gorra.rot)
    const sn = Math.sin(gorra.rot)
    ctx.setTransform(sx * cs, sx * sn, -k * sn, k * cs, cam.tx + cam.esc * gorra.x, cam.ty + cam.esc * gorra.y)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(gorra.img, c.x, c.y, c.w, c.h, -c.ax, -c.ay, c.w, c.h)
  }

  function nuevaPartida(p: Partida): Mundo {
    pelado[0] = false
    pelado[1] = false
    gorra.activa = false
    for (let lado = 0; lado < 2; lado++) {
      const l = p.luchadores[lado]
      const at = atlasDe(l.id)
      atlasLados[lado] = at
      const alterno = lado === 1 && p.luchadores[0].id === p.luchadores[1].id
      reiniciarVisual(vis[lado], at, alterno, calidad !== 'baja')
    }
    E.parts.vaciar()
    E.tajos.vaciar()
    rastros.vaciar()
    textos.vaciar()
    apagarSuperFlash(sf)
    destello.edad = destello.dur
    cam.zoom = 1.12
    cam.centroX = (p.luchadores[0].x + p.luchadores[1].x) / 2
    cam.temblor = 0
    cam.golpe = 0
    mundo = {
      E,
      vis,
      textos,
      destello,
      sf,
      p,
      caras: recursos.caras,
      perdedorKo: null,
      focoMs: 0,
      focoLado: 0,
      rapar,
      prepararRapado: (lado) => {
        atlasPelado(p.luchadores[lado].id)
      },
    }
    return mundo
  }

  function redimensionar(ancho: number, alto: number, dpr: number): void {
    if (destruido) return
    anchoCss = Number.isFinite(ancho) ? Math.max(0, ancho) : 0
    altoCss = Number.isFinite(alto) ? Math.max(0, alto) : 0
    dprPedido = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
    if (anchoCss < 2 || altoCss < 2) {
      listo = false
      return
    }
    const d = acotar(dprPedido, 1, calidad === 'baja' ? 1.5 : 2)
    const W = Math.max(1, Math.round(anchoCss * d))
    const H = Math.max(1, Math.round(altoCss * d))
    // las rotaciones disparan varios resize seguidos con el mismo tamaño: no se rehace nada
    if (listo && W === cam.anchoPx && H === cam.altoPx && canvas.width === W && canvas.height === H) return
    if (canvas.width !== W) canvas.width = W
    if (canvas.height !== H) canvas.height = H
    ajustarCamara(cam, W, H, aspecto)
    // en pantallas angostas (celular vertical) los números chicos crecen un poco
    E.escalaTextos = acotar(1 + ((620 - anchoCss) / 620) * 0.6, 1, 1.35)
    prepararEscenario(E, escenario)
    textos.invalidar()
    listo = true
  }

  function autoTamano(): void {
    if (typeof window === 'undefined') return
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w > 1 && h > 1) redimensionar(w, h, window.devicePixelRatio || 1)
  }

  /** Zoom 1,0–1,1 según la distancia, más los momentos de cámara (intro, K.O., remate, especial). */
  function moverCamara(M: Mundo, p: Partida, dtS: number): void {
    const a = p.luchadores[0]
    const b = p.luchadores[1]
    let x = (a.x + b.x) / 2
    let z = 1 + 0.1 * pasoSuave(560, 200, Math.abs(a.x - b.x))
    let rapidez = 1
    if (p.fase === 'presentacion') {
      z = Math.max(z, 1.08)
    } else if (p.fase === 'ko' && M.perdedorKo !== null) {
      x = mezcla(x, p.luchadores[M.perdedorKo].x, 0.6)
      z = 1.13
    } else if (p.fase === 'final' && M.perdedorKo !== null) {
      x = mezcla(x, p.luchadores[M.perdedorKo].x, 0.5)
      z = 1.09
    }
    if (M.focoMs > 0) {
      x = mezcla(x, p.luchadores[M.focoLado].x, 0.5)
      z += 0.05
      rapidez = 2
    }
    actualizarCamara(cam, dtS, x, z, rapidez)
  }

  function actualizar(M: Mundo, p: Partida, dtMs: number): void {
    const dtS = dtMs / 1000
    E.ms += dtMs
    E.s = E.ms / 1000
    for (let lado = 0; lado < 2; lado++) {
      const ladoT = lado as Lado
      const mascara = actualizarVisual(E, p.luchadores[lado], vis[lado], dtMs)
      if (mascara) {
        for (let k = 0; k < 30; k++) if (mascara & (1 << k)) alImpactoAnimacion(M, ladoT, k)
      }
    }
    actualizarProyectiles(E, p, dtS)
    actualizarArsenal(E, p, rastros, dtMs)
    moverGorra(dtS)
    E.parts.actualizar(dtS, E.sueloY, E.s)
    E.tajos.actualizar(dtMs)
    textos.actualizar(dtMs, p)
    actualizarSuperFlash(sf, dtMs)
    if (destello.edad < destello.dur) destello.edad += dtMs
    if (M.focoMs > 0) M.focoMs -= dtMs
    // festejo: chispitas doradas alrededor del que ganó el round
    if (p.fase === 'entre_rounds' && p.ganadorRound !== null && Math.random() < dtS * 12 * E.densidad) {
      const v = vis[p.ganadorRound]
      emitirBrillos(E, v.cajaX + Math.random() * v.cajaW, v.cajaY + Math.random() * v.cajaH * 0.6, 1, 1, 6, 70)
    }
  }

  function pintar(p: Partida): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = def.tono || '#111111'
    ctx.fillRect(0, 0, cam.anchoPx, cam.altoPx)
    dibujarFondo(E, escenario)
    dibujarLuces(E, escenario, p.turbo)
    const a = p.luchadores[0]
    const b = p.luchadores[1]
    dibujarSombra(E, a, vis[0])
    dibujarSombra(E, b, vis[1])
    if (calidad !== 'baja') {
      dibujarReflejo(E, a, vis[0])
      dibujarReflejo(E, b, vis[1])
    }
    dibujarArsenalFondo(E, rastros)
    dibujarParticulas(E, 0)
    const frente = ladoAdelante(p)
    const atras = frente === 0 ? 1 : 0
    dibujarLuchador(E, p.luchadores[atras], vis[atras])
    dibujarLuchador(E, p.luchadores[frente], vis[frente])
    dibujarGorra()
    dibujarProyectiles(E, p, atlasLados)
    dibujarArsenal(E, p, rastros, atlasLados)
    dibujarParticulas(E, 1)
    E.tajos.dibujar(E)
    textos.dibujarMundo()
    if (sf.activo) dibujarSuperFlashMundo(E, sf, p.luchadores, vis)
    dibujarParticulas(E, 2)
    dibujarVineta(E, escenario, p.turbo)
    dibujarSuperFlashBanda(E, sf, cam.altoVista)
    dibujarDestello(E, destello)
    textos.dibujarPantalla(cam.altoVista)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  function dibujar(p: Partida, eventos: readonly EventoJuego[], dtMs: number): void {
    if (destruido || !p) return
    if (!listo) {
      autoTamano()
      if (!listo) return
    }
    try {
      const dt = acotar(Number.isFinite(dtMs) ? dtMs : 16.7, 0, 100)
      const M = mundo && mundo.p === p ? mundo : nuevaPartida(p)
      procesarEventos(M, eventos)
      actualizar(M, p, dt)
      moverCamara(M, p, dt / 1000)
      // Mientras no se juega (cortina, presentación, anuncios, K.O., entre rounds): un texto por
      // cuadro queda pintado y rasterizado antes de que haga falta (textos.ts). Antes de pintar:
      // el cuadro lo tapa entero.
      if (p.fase !== 'pelea') textos.precalentar(p)
      pintar(p)
    } catch (e) {
      // un error de dibujo no puede cortar el loop del juego: se avisa una vez y se sigue
      if (!errorAvisado) {
        errorAvisado = true
        console.error('[juego] error en el render', e)
      }
    }
  }

  /** Si el navegador pierde el contexto (Android en segundo plano), se rehacen las cachés. */
  function alRecuperarContexto(): void {
    if (destruido) return
    for (const at of atlasPorId.values()) if (at) liberarAtlas(at)
    // el lienzo del atlas pelado pudo perder lo dibujado: se rearma
    liberarPelados()
    E.spr.liberar()
    E.spr = crearSprites()
    E.util.liberar()
    liberarEscenario(escenario)
    escenario = crearEscenario(def, recursos.arena.imagen)
    for (let lado = 0; lado < 2; lado++) {
      const v = vis[lado]
      const id = mundo?.p.luchadores[lado]?.id
      const at = pelado[lado] && id ? (atlasPelado(id) ?? atlasDe(id)) : v.at
      liberarVisual(v)
      reiniciarVisual(v, at, v.alterno, calidad !== 'baja')
    }
    textos.liberar()
    textos.invalidar()
    liberarSuperFlash(sf)
    listo = false
    if (anchoCss > 1 && altoCss > 1) redimensionar(anchoCss, altoCss, dprPedido)
  }
  canvas.addEventListener('contextrestored', alRecuperarContexto)

  function destruir(): void {
    if (destruido) return
    destruido = true
    canvas.removeEventListener('contextrestored', alRecuperarContexto)
    for (const at of atlasPorId.values()) if (at) liberarAtlas(at)
    atlasPorId.clear()
    liberarPelados()
    gorra.activa = false
    gorra.img = null
    liberarVisual(vis[0])
    liberarVisual(vis[1])
    textos.liberar()
    E.spr.liberar()
    E.util.liberar()
    liberarEscenario(escenario)
    liberarSuperFlash(sf)
    E.parts.vaciar()
    rastros.vaciar()
    mundo = null
  }

  autoTamano()
  return { dibujar, redimensionar, destruir }
}
