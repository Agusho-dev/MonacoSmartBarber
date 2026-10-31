// Galería del render: una partida FALSA (sin motor) para mirar cada proyectil, estado y especial
// del elenco con el renderizador real. galeria.mjs la inyecta (después del render-bundle.js de
// empaquetar.mjs) en una página del mismo origen del dev server: los atlas y la arena se bajan de
// /juego/... Expone window.G (crear, escena, medir).
;(function () {
  'use strict'
  var R = window.CorteFinalRender.indice
  var PJ = window.CorteFinalRender.internos.personajes.PERSONAJES
  document.documentElement.innerHTML =
    '<head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#000;overflow:hidden;height:100%}canvas{display:block;width:100vw;height:100vh}</style></head><body><canvas id="c"></canvas></body>'
  var canvas = document.getElementById('c')
  var G = (window.G = { listo: false, errores: [], tiempos: [], intervalos: [] })
  window.addEventListener('error', function (e) {
    G.errores.push(String(e.message))
  })
  var r = null
  var p = null
  var recursos = null
  var t = 0
  var sigId = 90000
  var paso = null

  function efectos() {
    return { congelado: 0, electrocutado: 0, guardiaRota: 0, critico: 0, aturdido: 0, mareado: 0, quemado: 0, lento: 0, curando: 0 }
  }
  function luchador(id, lado, x) {
    var f = PJ[id]
    return {
      id: id, lado: lado, x: x, y: 0, vx: 0, vy: 0, mira: lado === 0 ? 1 : -1, enSuelo: true, estado: 'quieto', anim: 'quieto',
      cuadro: 0, animTick: 0, movimiento: null, vida: f.vidaMax, vidaMax: f.vidaMax, guardia: 100, guardiaMax: 100, carga: 6,
      destello: 0, invulnerable: false, efectos: efectos(), combo: 0,
    }
  }
  function stats() {
    return { danioHecho: 0, danioRecibido: 0, golpesAcertados: 0, golpesIntentados: 0, golpesBloqueados: 0, criticos: 0, especialesUsados: 0, especialesAcertados: 0, comboMax: 0, guardiasRotas: 0, congelamientos: 0, rondasPerfectas: 0, finalAlCero: false, curado: 0 }
  }
  function nCuadros(id, anim) {
    var a = recursos.atlas[id] && recursos.atlas[id].datos.animaciones[anim]
    return a && a.cuadros ? a.cuadros.length : 1
  }

  /**
   * ids: 'nico_u' o 'luciano=nico_u' (un barbero sin hoja todavía, dibujado con la de otro: sirve
   * para mirar sus efectos de especial con su ficha, sus colores y sus iconos).
   */
  G.crear = async function (ids, arena, calidad) {
    if (r) r.destruir()
    var reales = ids.map(function (x) { return x.split('=').pop() })
    recursos = await R.cargarRecursos(reales, arena)
    ids = ids.map(function (x, i) {
      var partes = x.split('=')
      if (partes.length === 2) {
        recursos.atlas[partes[0]] = recursos.atlas[reales[i]]
        recursos.caras[partes[0]] = recursos.caras[reales[i]]
      }
      return partes[0]
    })
    r = R.crearRenderizador(canvas, recursos, { calidad: calidad || 'alta', fuentes: { titulo: 'Impact', numeros: 'Impact' }, numerosDeDanio: true })
    r.redimensionar(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1))
    p = {
      config: { personajes: ids.slice(0, 2), cpu: [false, true], dificultad: 'normal', arena: arena, rondasParaGanar: 2, segundosPorRound: 60, animaciones: [{}, {}], semilla: 1 },
      fase: 'pelea', ticksFase: 0, tick: 0, round: 1, tiempoRestante: 3600, turbo: false, rondasGanadas: [0, 0],
      luchadores: [luchador(ids[0], 0, 330), luchador(ids[1] || ids[0], 1, 630)],
      proyectiles: [], eventos: [], escalaTiempo: 1, congelamientoGolpe: 0, ganadorRound: null, ganadorPartida: null,
      estadisticas: [stats(), stats()],
    }
    paso = null
    G.p = p
    G.listo = true
    return true
  }
  addEventListener('resize', function () {
    if (r) r.redimensionar(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1))
  })

  function ev(e) {
    p.eventos.push(e)
  }
  function proyectil(tipo, duenio, x, y, vx, vy, ancho, alto, extra) {
    var pr = { id: ++sigId, tipo: tipo, duenio: duenio, x: x, y: y, vx: vx, vy: vy, mira: vx < 0 ? -1 : 1, rot: 0, edad: 0, golpesRestantes: 1, vuelta: false, ancho: ancho, alto: alto }
    if (extra) for (var k in extra) pr[k] = extra[k]
    p.proyectiles.push(pr)
    return pr
  }
  function quitar(pr) {
    var i = p.proyectiles.indexOf(pr)
    if (i >= 0) p.proyectiles.splice(i, 1)
  }

  /** Un tick de la «física» de mentira de cada proyectil. Devuelve false si se va. */
  function mover(pr) {
    pr.edad++
    var l0 = p.luchadores[pr.duenio]
    switch (pr.tipo) {
      case 'trago': case 'botella': case 'mate': case 'panal':
        pr.x += pr.vx; pr.y += pr.vy; pr.vy -= 0.45; pr.rot += 0.32 * pr.mira
        if (pr.y < pr.alto / 2) {
          if (pr.tipo === 'panal') {
            var nube = proyectil('nube', pr.duenio, pr.x, 35, 0, 0, 150, 70)
            nube.vida = 200
            ev({ tipo: 'nube', quien: pr.duenio, x: pr.x })
          }
          return false
        }
        return true
      case 'bombo':
        pr.x += pr.vx; pr.y = pr.alto / 2; pr.rot += pr.vx / 30
        return pr.x > -60 && pr.x < 1020
      case 'bala': case 'pelota': case 'guante':
        pr.x += pr.vx; pr.rot += 0.4 * pr.mira
        return pr.x > -60 && pr.x < 1020 && Math.abs(pr.x - pr.x0) < (pr.tipo === 'guante' ? 360 : 2000)
      case 'graffiti':
        if (pr.edad >= 30) { pr.ancho = 230; pr.alto = 230 }
        return pr.edad < 40
      case 'onda':
        pr.x += pr.vx
        return pr.x > -80 && pr.x < 1040
      case 'gorro':
        pr.x += pr.vx; pr.vx -= 0.22 * pr.mira; pr.rot += 0.5
        if (!pr.vuelta && pr.vx * pr.mira < 0) pr.vuelta = true
        return !(pr.vuelta && Math.abs(pr.x - l0.x) < 30)
      case 'leche': case 'agua':
        pr.ancho = Math.min(230, 40 + pr.edad * 7)
        pr.x = l0.x + l0.mira * (52 + pr.ancho / 2)
        pr.mira = l0.mira; pr.vx = 0.01 * l0.mira
        return pr.edad < 70
      case 'nube':
        return pr.edad < (pr.vida || 200)
      case 'sismo':
        pr.x += pr.vx
        return pr.x > -60 && pr.x < 1020
      default:
        return pr.edad < 120
    }
  }

  var ESCENAS = {}
  /** Todos los proyectiles del arsenal, repartidos y re-lanzándose. */
  ESCENAS.arsenal1 = function () {
    var l0 = p.luchadores[0], l1 = p.luchadores[1]
    l0.x = 180; l1.x = 800
    var reloj = 0
    return function () {
      reloj++
      if (reloj % 90 === 1) { proyectil('bombo', 0, 230, 30, 4.2, 0, 60, 60); ev({ tipo: 'proyectil', quien: 0, proyectil: 'bombo' }) }
      if (reloj % 90 === 20 || reloj % 90 === 28 || reloj % 90 === 36) { var ba = proyectil('bala', 0, 240, 140, 15, 0, 24, 12); ba.x0 = 240; ev({ tipo: 'disparo', quien: 0, x: 236, y: 140 }) }
      if (reloj % 60 === 5) { proyectil('graffiti', 1, 520, 170, 0, 0, 150, 150); ev({ tipo: 'proyectil', quien: 1, proyectil: 'graffiti' }) }
      if (reloj % 80 === 10) { proyectil('trago', 1, 760, 150, -5, 7, 34, 34); ev({ tipo: 'proyectil', quien: 1, proyectil: 'trago' }) }
      if (reloj % 80 === 30 || reloj % 80 === 38 || reloj % 80 === 46) proyectil('botella', 1, 760, 160, -3.5 - (reloj % 80 - 30) * 0.15, 8, 34, 34)
      if (reloj % 70 === 15 || reloj % 70 === 21 || reloj % 70 === 27 || reloj % 70 === 33) proyectil('mate', 0, 220, 170, 3 + (reloj % 70 - 15) * 0.12, 7.5, 34, 34)
    }
  }
  ESCENAS.arsenal2 = function () {
    var l0 = p.luchadores[0], l1 = p.luchadores[1]
    l0.x = 200; l1.x = 780
    var reloj = 0
    return function () {
      reloj++
      if (reloj % 160 === 1) { proyectil('onda', 1, 700, 115, -3, 0, 120, 230); ev({ tipo: 'proyectil', quien: 1, proyectil: 'onda' }) }
      if (reloj % 120 === 10) { proyectil('gorro', 0, 250, 160, 9, 0, 64, 32); ev({ tipo: 'proyectil', quien: 0, proyectil: 'gorro' }) }
      if (reloj % 70 === 40) { var pe = proyectil('pelota', 0, 260, 80, 13, 0, 34, 34); pe.x0 = 260; ev({ tipo: 'proyectil', quien: 0, proyectil: 'pelota' }) }
      if (reloj % 100 === 50) { proyectil('panal', 1, 740, 160, -4.5, 6, 46, 46); ev({ tipo: 'proyectil', quien: 1, proyectil: 'panal' }) }
      if (reloj % 110 === 5) { var g = proyectil('guante', 0, 260, 120, 11, 0, 56, 48); g.x0 = 260; ev({ tipo: 'proyectil', quien: 0, proyectil: 'guante' }) }
      if (reloj % 130 === 70) { proyectil('sismo', 1, 720, 30, -5, 0, 90, 60); ev({ tipo: 'sismo', quien: 1, x: 720 }) }
    }
  }
  ESCENAS.chorros = function () {
    var l0 = p.luchadores[0], l1 = p.luchadores[1]
    l0.x = 300; l1.x = 660
    var reloj = 0
    return function () {
      reloj++
      if (reloj % 90 === 1) { proyectil('leche', 0, l0.x + 72, 120, 0.01, 0, 40, 40); ev({ tipo: 'proyectil', quien: 0, proyectil: 'leche' }) }
      if (reloj % 90 === 1) { proyectil('agua', 1, l1.x - 72, 100, -0.01, 0, 40, 40); ev({ tipo: 'proyectil', quien: 1, proyectil: 'agua' }) }
    }
  }
  /** Estados: aturdido + quemado a la izquierda, mareado + lento a la derecha (cambian cada 3 s). */
  ESCENAS.estados = function () {
    var l0 = p.luchadores[0], l1 = p.luchadores[1]
    l0.x = 330; l1.x = 630
    var reloj = 0
    return function () {
      reloj++
      var fase = Math.floor(reloj / 180) % 3
      var e0 = l0.efectos, e1 = l1.efectos
      e0.aturdido = e0.quemado = e0.mareado = e0.lento = e0.curando = 0
      e1.aturdido = e1.quemado = e1.mareado = e1.lento = e1.curando = 0
      l0.estado = 'quieto'; l1.estado = 'quieto'; l1.anim = 'quieto'; l1.y = 0; l1.enSuelo = true
      if (fase === 0) { e0.aturdido = 60; e0.quemado = 60; e1.mareado = 60; e1.lento = 60; l0.estado = 'aturdido' }
      else if (fase === 1) { e0.curando = 60; if (reloj % 12 === 0) ev({ tipo: 'curacion', quien: 0, cantidad: 18 }); e1.quemado = 60 }
      else {
        l1.estado = 'agarrado'; l1.anim = 'danio'; l1.y = 70; l1.enSuelo = false; l1.x = l0.x + 95
        if (reloj % 180 === 0) ev({ tipo: 'agarre', atacante: 0, victima: 1 })
      }
      if (reloj % 180 === 1) {
        if (fase === 0) { ev({ tipo: 'aturdido', quien: 0 }); ev({ tipo: 'quemado', quien: 0 }); ev({ tipo: 'mareado', quien: 1 }) }
      }
    }
  }
  /** El graffiti solo, para ver sus fases (pintado, a punto, estallido). */
  ESCENAS.graffiti = function () {
    var l0 = p.luchadores[0], l1 = p.luchadores[1]
    l0.x = 300; l1.x = 700
    var reloj = 0
    return function () {
      reloj++
      if (reloj % 50 === 1) { proyectil('graffiti', 0, 520, 140, 0, 0, 150, 150); ev({ tipo: 'proyectil', quien: 0, proyectil: 'graffiti' }) }
    }
  }
  /** El guante solo (sin la onda atrás). */
  ESCENAS.guante = function () {
    var l0 = p.luchadores[0], l1 = p.luchadores[1]
    l0.x = 220; l1.x = 760
    var reloj = 0
    return function () {
      reloj++
      if (reloj % 50 === 1) { var g = proyectil('guante', 0, 280, 120, 9, 0, 56, 48); g.x0 = 280; ev({ tipo: 'proyectil', quien: 0, proyectil: 'guante' }) }
    }
  }
  /** Un especial: el luchador 0 hace la animación en bucle y se repite el evento de especial. */
  ESCENAS.especial = function (n) {
    var l0 = p.luchadores[0], l1 = p.luchadores[1]
    l0.x = 300; l1.x = 680
    var anim = n === 1 ? 'especial1' : 'especial2'
    var total = nCuadros(l0.id, anim)
    var reloj = 0
    return function () {
      reloj++
      var ciclo = Math.max(36, total * 6) + 30
      var k = reloj % ciclo
      if (k === 1) {
        l0.x = 300
        ev({ tipo: 'especial', quien: 0, numero: n, nombre: PJ[l0.id].especiales[n - 1].nombre })
      }
      l0.anim = anim
      l0.estado = 'atacando'
      l0.cuadro = Math.min(total - 1, Math.floor(k / 6))
      l0.animTick = k
      var icono = PJ[l0.id].especiales[n - 1].icono
      // lo que en el juego pone el motor: la curación y el agarre de la víctima
      if (icono === 'cura') {
        l0.efectos.curando = k < ciclo - 30 ? 20 : 0
        if (k % 12 === 6 && k < ciclo - 30) ev({ tipo: 'curacion', quien: 0, cantidad: 30 })
      }
      if (icono === 'agarre') {
        if (k === 14) ev({ tipo: 'agarre', atacante: 0, victima: 1 })
        var agarrado = k >= 14 && k < 70
        l1.estado = agarrado ? 'agarrado' : k >= 70 && k < 100 ? 'derribado' : 'quieto'
        l1.anim = agarrado ? 'danio' : k >= 70 && k < 100 ? 'ko' : 'quieto'
        l1.y = agarrado ? 70 : 0
        l1.enSuelo = !agarrado
        l1.x = agarrado ? l0.x + 92 : 680
        if (k === 70) {
          ev({ tipo: 'golpe', atacante: 0, victima: 1, x: l1.x, y: 40, danio: 160, critico: false, bloqueado: false, fuerza: 'especial', herramienta: 'agarre' })
          ev({ tipo: 'derribo', quien: 1 })
        }
      }
      if (icono === 'sismo' && k === 24) ev({ tipo: 'sismo', quien: 0, x: l0.x + 50 })
      var corre = icono === 'moto' || icono === 'dragon' || icono === 'chilena' || icono === 'break' || icono === 'baile' || icono === 'navaja'
      l0.vx = corre && k > 6 && k < ciclo - 30 ? (icono === 'moto' ? 9 : icono === 'baile' || icono === 'break' ? 2 : 6) : 0
      l0.x = Math.min(860, l0.x + l0.vx)
    }
  }
  /**
   * Dos especiales casi juntos (el del jugador y, 100 ms después, el del rival): tienen que verse
   * las dos bandas, una arriba y otra abajo, y los dos encendidos (render/pantalla.ts).
   */
  ESCENAS.dosEspeciales = function () {
    var l0 = p.luchadores[0], l1 = p.luchadores[1]
    l0.x = 330; l1.x = 630
    var reloj = 0
    return function () {
      reloj++
      var k = reloj % 120
      if (k === 1) ev({ tipo: 'especial', quien: 0, numero: 2, nombre: PJ[l0.id].especiales[1].nombre })
      if (k === 7) ev({ tipo: 'especial', quien: 1, numero: 1, nombre: PJ[l1.id].especiales[0].nombre })
      l0.anim = 'especial2'; l0.estado = 'atacando'; l0.cuadro = Math.min(nCuadros(l0.id, 'especial2') - 1, Math.floor(k / 6))
      l1.anim = 'especial1'; l1.estado = 'atacando'; l1.cuadro = Math.min(nCuadros(l1.id, 'especial1') - 1, Math.floor(k / 6))
    }
  }
  /** Golpes de cada herramienta nueva sobre el luchador 1. */
  ESCENAS.golpes = function () {
    var HERR = ['bombo', 'navaja', 'celular', 'anteojos', 'guante', 'moto', 'bala', 'graffiti', 'break', 'trago', 'botella', 'baile', 'onda', 'gorro', 'dragon', 'pelota', 'leche', 'panal', 'mate', 'agua', 'sismo', 'agarre', 'pesado']
    var l0 = p.luchadores[0], l1 = p.luchadores[1]
    l0.x = 420; l1.x = 540
    var reloj = 0, i = 0
    return function () {
      reloj++
      if (reloj % 14 === 0) {
        var h = HERR[i++ % HERR.length]
        l1.destello = (l1.destello || 0) + 6
        ev({ tipo: 'golpe', atacante: 0, victima: 1, x: 500, y: 130, danio: 40 + (i % 5) * 20, critico: i % 4 === 0, bloqueado: false, fuerza: i % 3 === 0 ? 'fuerte' : 'medio', herramienta: h })
      }
    }
  }
  /** Todo junto (para medir el costo): dos arsenales, chorros y estados. */
  ESCENAS.todo = function () {
    var a = ESCENAS.arsenal1(), b = ESCENAS.arsenal2(), c = ESCENAS.estados()
    var l0 = p.luchadores[0], l1 = p.luchadores[1]
    return function () {
      a(); b(); c()
      l0.x = 330; l1.x = 630
      l0.efectos.quemado = 60; l1.efectos.mareado = 60; l1.efectos.lento = 60; l0.efectos.aturdido = 60
    }
  }

  G.escena = function (nombre, a1, a2) {
    p.proyectiles.length = 0
    p.eventos.length = 0
    var l0 = p.luchadores[0], l1 = p.luchadores[1]
    l0.anim = l1.anim = 'quieto'; l0.estado = l1.estado = 'quieto'; l0.cuadro = l1.cuadro = 0; l0.vx = l1.vx = 0
    l0.y = l1.y = 0
    l0.efectos = efectos(); l1.efectos = efectos()
    paso = ESCENAS[nombre](a1, a2)
    G.tiempos.length = 0
    G.intervalos.length = 0
    return true
  }

  var ultimo = -1
  var acum = 0
  function cuadro(ahora) {
    requestAnimationFrame(cuadro)
    if (!p || !r) return
    var dt = ultimo < 0 ? 16.7 : Math.min(100, ahora - ultimo)
    if (ultimo >= 0) G.intervalos.push(ahora - ultimo)
    ultimo = ahora
    acum += dt
    while (acum >= 1000 / 60) {
      acum -= 1000 / 60
      p.tick++
      t++
      var l0 = p.luchadores[0], l1 = p.luchadores[1]
      if (l0.anim === 'quieto') l0.cuadro = Math.floor(t / 8) % nCuadros(l0.id, 'quieto')
      if (l1.anim === 'quieto') l1.cuadro = Math.floor(t / 8) % nCuadros(l1.id, 'quieto')
      if (l1.anim === 'danio') l1.cuadro = Math.floor(t / 8) % nCuadros(l1.id, 'danio')
      if (l0.destello > 0) l0.destello--
      if (l1.destello > 0) l1.destello--
      if (paso) paso()
      for (var i = p.proyectiles.length - 1; i >= 0; i--) if (!mover(p.proyectiles[i])) quitar(p.proyectiles[i])
    }
    var eventos = p.eventos.splice(0)
    var t0 = performance.now()
    r.dibujar(p, eventos, dt)
    G.tiempos.push(performance.now() - t0)
    if (G.tiempos.length > 2000) G.tiempos.splice(0, 1000)
    if (G.intervalos.length > 2000) G.intervalos.splice(0, 1000)
  }
  requestAnimationFrame(cuadro)

  G.medir = function () {
    var ts = G.tiempos.slice().sort(function (a, b) { return a - b })
    var iv = G.intervalos.slice()
    var prom = iv.reduce(function (a, b) { return a + b }, 0) / Math.max(1, iv.length)
    var pct = function (arr, q) { return arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] : 0 }
    return {
      cuadros: iv.length,
      fps: +(1000 / prom).toFixed(1),
      dibujoMedioMs: +(ts.reduce(function (a, b) { return a + b }, 0) / Math.max(1, ts.length)).toFixed(2),
      dibujoP95Ms: +pct(ts, 0.95).toFixed(2),
      dibujoMaxMs: +(ts[ts.length - 1] || 0).toFixed(2),
      intervaloP95Ms: +pct(iv.slice().sort(function (a, b) { return a - b }), 0.95).toFixed(1),
      proyectiles: p.proyectiles.length,
    }
  }
})()
