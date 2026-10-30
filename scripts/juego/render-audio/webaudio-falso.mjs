// Web Audio de mentira para probar el audio de «Corte Final» en Node: valida como un navegador (y
// ANOTA cada violación en ctx.errores antes de tirar, porque el audio atrapa excepciones para no
// romper el juego), lleva la cuenta de nodos conectados (fugas) y deja avanzar el reloj a mano.

function finito(ctx, quien, ...xs) {
  for (const x of xs) {
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      const e = new TypeError(`${quien}: valor no finito ${x}`)
      ctx.errores.push(e.message)
      throw e
    }
  }
}

class MockParam {
  constructor(ctx, valor, nombre) {
    this.ctx = ctx
    this._v = valor
    this.nombre = nombre
    this.eventos = []
    this.entradas = 0
  }
  get value() {
    return this._v
  }
  set value(x) {
    finito(this.ctx, this.nombre + '.value', x)
    this._v = x
  }
  _ev(tipo, v, t, extra) {
    finito(this.ctx, `${this.nombre}.${tipo}`, v, t)
    if (t < 0) {
      this.ctx.errores.push(`${this.nombre}.${tipo}: tiempo negativo ${t}`)
      throw new RangeError('tiempo negativo')
    }
    this.eventos.push({ tipo, v, t, extra })
    if (this.eventos.length > this.ctx.maxEventosParam) this.ctx.maxEventosParam = this.eventos.length
    return this
  }
  setValueAtTime(v, t) {
    return this._ev('set', v, t)
  }
  linearRampToValueAtTime(v, t) {
    return this._ev('lin', v, t)
  }
  exponentialRampToValueAtTime(v, t) {
    if (v === 0) {
      this.ctx.errores.push(`${this.nombre}.exp: rampa exponencial a 0`)
      throw new RangeError('exp a 0')
    }
    return this._ev('exp', v, t)
  }
  setTargetAtTime(v, t, tc) {
    finito(this.ctx, this.nombre + '.setTarget tc', tc)
    if (tc < 0) {
      this.ctx.errores.push(`${this.nombre}.setTarget: tc negativo`)
      throw new RangeError('tc')
    }
    return this._ev('target', v, t, tc)
  }
  cancelScheduledValues(t) {
    finito(this.ctx, this.nombre + '.cancel', t)
    this.eventos = this.eventos.filter((e) => e.t < t)
    return this
  }
  cancelAndHoldAtTime(t) {
    return this.cancelScheduledValues(t)
  }
  /** Último valor objetivo agendado (para mirar volúmenes y silencios). */
  objetivo() {
    const e = this.eventos[this.eventos.length - 1]
    return e ? e.v : this._v
  }
}

class MockNode {
  constructor(ctx, tipo) {
    this.ctx = ctx
    this.tipo = tipo
    this.salidas = new Set()
    ctx.creados++
    ctx.creadosPorTipo[tipo] = (ctx.creadosPorTipo[tipo] || 0) + 1
  }
  connect(dest) {
    if (!dest || (!(dest instanceof MockNode) && !(dest instanceof MockParam))) {
      this.ctx.errores.push(`${this.tipo}.connect: destino inválido`)
      throw new TypeError('destino inválido')
    }
    if (dest instanceof MockNode && dest.ctx !== this.ctx) {
      this.ctx.errores.push(`${this.tipo}.connect: otro contexto`)
      throw new Error('otro contexto')
    }
    this.salidas.add(dest)
    this.ctx.conectados.add(this)
    return dest instanceof MockNode ? dest : undefined
  }
  disconnect() {
    this.salidas.clear()
    this.ctx.conectados.delete(this)
  }
}

class MockGain extends MockNode {
  constructor(ctx) {
    super(ctx, 'gain')
    this.gain = new MockParam(ctx, 1, 'gain')
  }
}
class MockBiquad extends MockNode {
  constructor(ctx) {
    super(ctx, 'biquad')
    this._type = 'lowpass'
    this.frequency = new MockParam(ctx, 350, 'biquad.frequency')
    this.Q = new MockParam(ctx, 1, 'biquad.Q')
    this.gain = new MockParam(ctx, 0, 'biquad.gain')
    this.detune = new MockParam(ctx, 0, 'biquad.detune')
  }
  get type() {
    return this._type
  }
  set type(t) {
    const ok = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass']
    if (!ok.includes(t)) this.ctx.errores.push('biquad.type inválido: ' + t)
    this._type = t
  }
}
class MockSource extends MockNode {
  constructor(ctx, tipo) {
    super(ctx, tipo)
    this.onended = null
    this._t0 = null
    this._t1 = null
    this.terminada = false
  }
  start(t = 0, offset) {
    if (this._t0 !== null) {
      this.ctx.errores.push(`${this.tipo}.start dos veces`)
      throw new Error('InvalidStateError')
    }
    finito(this.ctx, this.tipo + '.start', t)
    if (offset !== undefined) finito(this.ctx, this.tipo + '.start offset', offset)
    if (t < 0) {
      this.ctx.errores.push(`${this.tipo}.start negativo`)
      throw new RangeError('start')
    }
    this._t0 = t
    this.ctx.fuentes.add(this)
    this.ctx.iniciosAgendados.push({ tipo: this.tipo, t, ahora: this.ctx.currentTime })
  }
  stop(t = 0) {
    if (this._t0 === null) {
      this.ctx.errores.push(`${this.tipo}.stop sin start`)
      throw new Error('InvalidStateError')
    }
    finito(this.ctx, this.tipo + '.stop', t)
    this._t1 = t
  }
}
class MockOsc extends MockSource {
  constructor(ctx) {
    super(ctx, 'osc')
    this._type = 'sine'
    this.frequency = new MockParam(ctx, 440, 'osc.frequency')
    this.detune = new MockParam(ctx, 0, 'osc.detune')
  }
  get type() {
    return this._type
  }
  set type(t) {
    if (t === 'custom') {
      this.ctx.errores.push('osc.type = custom')
      throw new Error('InvalidStateError')
    }
    if (!['sine', 'square', 'sawtooth', 'triangle'].includes(t)) this.ctx.errores.push('osc.type inválido: ' + t)
    this._type = t
  }
  setPeriodicWave(w) {
    if (!w || !w.esOnda) this.ctx.errores.push('setPeriodicWave sin onda')
    this._type = 'custom'
  }
}
class MockBufferSource extends MockSource {
  constructor(ctx) {
    super(ctx, 'buffer')
    this.buffer = null
    this.loop = false
    this.playbackRate = new MockParam(ctx, 1, 'buffer.playbackRate')
    this.detune = new MockParam(ctx, 0, 'buffer.detune')
  }
  start(t = 0, offset) {
    if (!this.buffer) this.ctx.errores.push('buffer source sin buffer')
    if (offset !== undefined && this.buffer && offset > this.buffer.duration) this.ctx.errores.push('offset fuera del buffer')
    super.start(t, offset)
  }
}

class MockBuffer {
  constructor(canales, largo, sr) {
    if (!(largo > 0) || !(sr >= 3000)) throw new Error('createBuffer inválido')
    this.numberOfChannels = canales
    this.length = largo
    this.sampleRate = sr
    this.duration = largo / sr
    this._d = Array.from({ length: canales }, () => new Float32Array(largo))
  }
  getChannelData(c) {
    return this._d[c]
  }
}

class MockAudioContext {
  constructor(opciones) {
    this.opciones = opciones
    this.errores = []
    this.creados = 0
    this.creadosPorTipo = {}
    this.conectados = new Set()
    this.fuentes = new Set()
    this.iniciosAgendados = []
    this.maxEventosParam = 0
    this.currentTime = 0
    this.sampleRate = 48000
    this.baseLatency = 0.01
    this.outputLatency = 0.02
    this.state = 'suspended'
    this.onstatechange = null
    this.destination = new MockNode(this, 'destination')
    MockAudioContext.instancias.push(this)
  }
  _estado(s) {
    if (this.state === s) return
    this.state = s
    if (this.onstatechange) this.onstatechange()
  }
  resume() {
    if (this.state !== 'closed') this._estado('running')
    return Promise.resolve()
  }
  suspend() {
    if (this.state !== 'closed') this._estado('suspended')
    return Promise.resolve()
  }
  close() {
    this._estado('closed')
    return Promise.resolve()
  }
  createGain() {
    return new MockGain(this)
  }
  createBiquadFilter() {
    return new MockBiquad(this)
  }
  createOscillator() {
    return new MockOsc(this)
  }
  createBufferSource() {
    return new MockBufferSource(this)
  }
  createBuffer(c, l, sr) {
    return new MockBuffer(c, l, sr)
  }
  createStereoPanner() {
    const n = new MockNode(this, 'panner')
    n.pan = new MockParam(this, 0, 'pan')
    return n
  }
  createWaveShaper() {
    const n = new MockNode(this, 'shaper')
    n.curve = null
    n.oversample = 'none'
    return n
  }
  createConvolver() {
    const n = new MockNode(this, 'convolver')
    n.buffer = null
    n.normalize = true
    return n
  }
  createDelay(max) {
    const n = new MockNode(this, 'delay')
    n.delayTime = new MockParam(this, 0, 'delayTime')
    n.max = max
    return n
  }
  createDynamicsCompressor() {
    const n = new MockNode(this, 'compressor')
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new MockParam(this, 0, 'comp.' + k)
    return n
  }
  createPeriodicWave(real, imag) {
    if (real.length !== imag.length || real.length < 2) this.errores.push('createPeriodicWave: largos')
    return { esOnda: true }
  }
  /** Avanza el reloj de audio y dispara los onended de las fuentes que terminaron. */
  avanzar(seg) {
    if (this.state === 'running') this.currentTime += seg
    for (const f of [...this.fuentes]) {
      // Un buffer sin loop y sin stop termina solo al acabarse (el buffer vacío del desbloqueo de iOS).
      const fin = f._t1 !== null ? f._t1 : f.tipo === 'buffer' && !f.loop && f.buffer ? f._t0 + f.buffer.duration : null
      if (fin !== null && fin <= this.currentTime && !f.terminada) {
        f.terminada = true
        this.fuentes.delete(f)
        if (f.onended) f.onended()
      }
    }
  }
  /** Fuentes sin stop agendado (sonarían para siempre). */
  fuentesSinFin() {
    return [...this.fuentes].filter((f) => f._t1 === null && (f.tipo === 'osc' || f.loop)).length
  }
}
MockAudioContext.instancias = []

export { MockAudioContext, MockParam, MockNode }
