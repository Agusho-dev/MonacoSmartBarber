/**
 * Dónde va cada cosa en la pantalla de pelea. Función pura: recibe el tamaño de la
 * ventana y las áreas seguras, devuelve cajas en px CSS. La pantalla de pelea las
 * vuelca como variables CSS (nada de setState por cada resize).
 *
 *  - Horizontal: el lienzo 16:9 entra entero («contain») dentro del área segura, el HUD va
 *    encima de su borde de arriba y los controles flotan semitransparentes sobre todo.
 *  - Vertical: HUD arriba, lienzo 16:9 a todo el ancho y abajo la carga, las cartas y los
 *    controles (cómodo con dos pulgares, sin obligar a girar el celular).
 */

export interface Caja {
  x: number
  y: number
  w: number
  h: number
}

export interface Insets {
  arriba: number
  derecha: number
  abajo: number
  izquierda: number
}

export interface Circulo {
  x: number
  y: number
  r: number
}

export interface Disposicion {
  orientacion: 'horizontal' | 'vertical'
  /** Cartas y barra de carga en UNA fila ([carta][carga][carta]): horizontal o vertical justo. */
  fila: boolean
  /** Vertical con el lienzo angosto: conviene sugerir girar el celular. */
  chico: boolean
  lienzo: Caja
  hud: Caja
  /** Barra «CARGA DE LA MÁQUINA». */
  carga: Caja
  /** Fila de las dos cartas de especiales (en horizontal, la barra va entre las dos). */
  cartas: Caja
  carta: { w: number; h: number }
  /** Zonas táctiles (absolutas en la pantalla). */
  joystick: Caja
  botones: Caja
  /** Joystick: radio y lugar de reposo, RELATIVO a su zona. */
  joy: Circulo
  /** Botones, RELATIVOS a su zona. */
  golpe: Circulo
  herramienta: Circulo
  guardia: Circulo
  /** ESQUIVA: en el rincón entre HERRAMIENTA y GUARDIA, un anillo más afuera (no tapa GOLPE). */
  esquiva: Circulo
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const r0 = Math.round

/** Botón chico en arco alrededor de GOLPE: ángulo en grados (0 = derecha, 90 = arriba). */
function enArco(centro: Circulo, radio: number, distancia: number, grados: number): Circulo {
  const a = (grados * Math.PI) / 180
  return { x: r0(centro.x + Math.cos(a) * distancia), y: r0(centro.y - Math.sin(a) * distancia), r: radio }
}

function relativo(c: Circulo, zona: Caja): Circulo {
  return { x: r0(c.x - zona.x), y: r0(c.y - zona.y), r: c.r }
}

type Botones = Pick<Disposicion, 'golpe' | 'herramienta' | 'guardia' | 'esquiva'>

const ANGULO_HERRAMIENTA = 102
const ANGULO_GUARDIA = 166

/** Los cuatro botones en coordenadas ABSOLUTAS de la pantalla. */
function botonesEnArco(W: number, H: number, ins: Insets, escala: number, margenAbajo: number): Botones {
  const rG = r0(44 * escala)
  const rB = r0(32 * escala)
  const rE = r0(29 * escala)
  const golpe: Circulo = {
    x: r0(W - ins.derecha - 20 * escala - rG),
    y: r0(H - ins.abajo - margenAbajo - rG),
    r: rG,
  }
  const d = rG + rB + 13 * escala
  // ESQUIVA en la bisectriz del hueco entre HERRAMIENTA y GUARDIA, a la distancia justa para
  // quedar a `separacion` de las dos: D = d·cos(m) + √(s² − (d·sen m)²), m = medio ángulo.
  const medio = ((ANGULO_GUARDIA - ANGULO_HERRAMIENTA) / 2) * (Math.PI / 180)
  const s = rB + rE + 6 * escala
  const D = d * Math.cos(medio) + Math.sqrt(Math.max(0, s * s - (d * Math.sin(medio)) ** 2))
  return {
    golpe,
    herramienta: enArco(golpe, rB, d, ANGULO_HERRAMIENTA),
    guardia: enArco(golpe, rB, d, ANGULO_GUARDIA),
    esquiva: enArco(golpe, rE, Math.max(D, rG + rE + 6 * escala), (ANGULO_HERRAMIENTA + ANGULO_GUARDIA) / 2),
  }
}

/**
 * Las dos zonas táctiles de abajo: joystick a la izquierda y botones a la derecha. El corte va
 * a la mitad, salvo que algún botón se meta en la mitad del joystick (vertical en celulares
 * angostos): ahí el corte se corre para que todo el botón quede en su zona (un toque en su borde
 * iba al joystick).
 */
function zonasDeControl(W: number, H: number, y: number, b: Botones): { joystick: Caja; botones: Caja; relativos: Botones } {
  const izquierdaBotones = Math.min(...[b.golpe, b.herramienta, b.guardia, b.esquiva].map((c) => c.x - c.r))
  const corte = Math.max(r0(W * 0.4), Math.min(r0(W * 0.5), r0(izquierdaBotones - 8)))
  const joystick: Caja = { x: 0, y, w: corte, h: H - y }
  const botones: Caja = { x: corte, y, w: W - corte, h: H - y }
  return {
    joystick,
    botones,
    relativos: {
      golpe: relativo(b.golpe, botones),
      herramienta: relativo(b.herramienta, botones),
      guardia: relativo(b.guardia, botones),
      esquiva: relativo(b.esquiva, botones),
    },
  }
}

export function calcularDisposicion(W: number, H: number, ins: Insets): Disposicion {
  if (H > W * 1.05) return vertical(W, H, ins)
  return horizontal(W, H, ins)
}

function vertical(W: number, H: number, ins: Insets): Disposicion {
  const x0 = ins.izquierda
  const ancho = Math.max(200, W - ins.izquierda - ins.derecha)
  const hudH = clamp(r0(ancho * 0.2), 66, 86)
  const ly = ins.arriba + hudH
  let lw = ancho
  let lh = r0((lw * 9) / 16)
  // Holgado: la carga y las cartas apiladas (~150 px) y los controles abajo (~260). Si no
  // entra (Safari con sus barras, celulares chicos), van en una sola fila como en horizontal.
  const fila = H - ins.abajo - (ly + lh) < 410
  const minAbajo = 290
  if (fila && H - ins.abajo - (ly + lh) < minAbajo) {
    lh = Math.max(140, r0(H - ins.abajo - ly - minAbajo))
    lw = r0((lh * 16) / 9)
  }
  const lx = x0 + r0((ancho - lw) / 2)
  const y0 = ly + lh
  const abajo = H - ins.abajo - y0

  let carga: Caja
  let cartas: Caja
  let carta: { w: number; h: number }
  let yCtrl: number
  if (!fila) {
    const cargaH = 38
    const yCarga = y0 + 12
    const cartaH = clamp(r0(abajo * 0.24), 76, 112)
    const yCartas = yCarga + cargaH + 10
    carga = { x: x0 + 14, y: yCarga, w: ancho - 28, h: cargaH }
    cartas = { x: x0, y: yCartas, w: ancho, h: cartaH }
    carta = { w: r0(cartaH * 0.78), h: cartaH }
    yCtrl = yCartas + cartaH + 6
  } else {
    const cartaH = clamp(r0(abajo * 0.24), 60, 80)
    const cartaW = r0(cartaH * 0.8)
    const anchoFila = Math.min(ancho - 16, 460)
    const xFila = x0 + r0((ancho - anchoFila) / 2)
    const yFila = y0 + 10
    const sep = 10
    const cargaH = r0(clamp(cartaH * 0.52, 28, 38))
    carga = {
      x: xFila + cartaW + sep,
      y: yFila + r0((cartaH - cargaH) / 2) + 2,
      w: anchoFila - 2 * (cartaW + sep),
      h: cargaH,
    }
    cartas = { x: xFila, y: yFila, w: anchoFila, h: cartaH }
    carta = { w: cartaW, h: cartaH }
    yCtrl = yFila + cartaH + 8
  }
  const altoUtil = Math.max(150, H - ins.abajo - yCtrl)
  const escala = clamp(altoUtil / 270, 0.74, 1.14)

  const { joystick, botones, relativos } = zonasDeControl(W, H, yCtrl, botonesEnArco(W, H, ins, escala, 22 * escala))
  const R = r0(56 * escala)
  const joyAbs: Circulo = {
    x: r0(ins.izquierda + 26 * escala + R),
    y: r0(clamp(yCtrl + altoUtil * 0.56, yCtrl + R + 8, H - ins.abajo - R - 14)),
    r: R,
  }

  return {
    orientacion: 'vertical',
    fila,
    chico: lw < 330,
    lienzo: { x: lx, y: ly, w: lw, h: lh },
    hud: { x: x0, y: ins.arriba, w: ancho, h: hudH },
    carga,
    cartas,
    carta,
    joystick,
    botones,
    joy: relativo(joyAbs, joystick),
    ...relativos,
  }
}

function horizontal(W: number, H: number, ins: Insets): Disposicion {
  const availW = Math.max(200, W - ins.izquierda - ins.derecha)
  const availH = Math.max(120, H - ins.arriba - ins.abajo)
  const lw = r0(Math.min(availW, (availH * 16) / 9))
  const lh = r0((lw * 9) / 16)
  const lx = ins.izquierda + r0((availW - lw) / 2)
  const ly = ins.arriba + r0((availH - lh) / 2)
  const hudH = clamp(r0(lh * 0.2), 56, 86)

  const escala = clamp(Math.min(H / 390, (W / 844) * 1.12), 0.72, 1.12)
  const cartaH = r0(clamp(H * 0.17, 52, 78))
  const cartaW = r0(cartaH * 0.8)
  const anchoFila = r0(clamp(W * 0.4, 280, 440))
  const xFila = r0((W - anchoFila) / 2)
  const yFila = r0(H - ins.abajo - cartaH - 8)
  const sep = 10
  const cargaH = r0(clamp(cartaH * 0.52, 28, 38))

  const yZonas = ly + hudH + 4
  const { joystick, botones, relativos } = zonasDeControl(W, H, yZonas, botonesEnArco(W, H, ins, escala, 20 * escala))
  const R = r0(54 * escala)
  const joyAbs: Circulo = {
    x: r0(ins.izquierda + 30 * escala + R),
    y: r0(H - ins.abajo - 24 * escala - R),
    r: R,
  }

  return {
    orientacion: 'horizontal',
    fila: true,
    chico: false,
    lienzo: { x: lx, y: ly, w: lw, h: lh },
    hud: { x: lx, y: ly, w: lw, h: hudH },
    carga: {
      x: xFila + cartaW + sep,
      y: yFila + r0((cartaH - cargaH) / 2) + 2,
      w: anchoFila - 2 * (cartaW + sep),
      h: cargaH,
    },
    cartas: { x: xFila, y: yFila, w: anchoFila, h: cartaH },
    carta: { w: cartaW, h: cartaH },
    joystick,
    botones,
    joy: relativo(joyAbs, joystick),
    ...relativos,
  }
}

/** Vuelca la disposición como variables CSS en el elemento raíz de la pelea. */
export function aplicarDisposicion(el: HTMLElement, d: Disposicion): void {
  const s = el.style
  const caja = (pre: string, c: Caja) => {
    s.setProperty(`--${pre}-x`, `${c.x}px`)
    s.setProperty(`--${pre}-y`, `${c.y}px`)
    s.setProperty(`--${pre}-w`, `${c.w}px`)
    s.setProperty(`--${pre}-h`, `${c.h}px`)
  }
  const circulo = (pre: string, c: Circulo) => {
    s.setProperty(`--${pre}-x`, `${c.x}px`)
    s.setProperty(`--${pre}-y`, `${c.y}px`)
    s.setProperty(`--${pre}-r`, `${c.r}px`)
  }
  caja('lz', d.lienzo)
  caja('hud', d.hud)
  caja('cg', d.carga)
  caja('ct', d.cartas)
  caja('zj', d.joystick)
  caja('zb', d.botones)
  s.setProperty('--carta-w', `${d.carta.w}px`)
  s.setProperty('--carta-h', `${d.carta.h}px`)
  circulo('joy', d.joy)
  circulo('bg', d.golpe)
  circulo('bh', d.herramienta)
  circulo('bd', d.guardia)
  circulo('be', d.esquiva)
  el.dataset.orientacion = d.orientacion
  if (d.fila) el.dataset.fila = ''
  else delete el.dataset.fila
  if (d.chico) el.dataset.chico = ''
  else delete el.dataset.chico
}
