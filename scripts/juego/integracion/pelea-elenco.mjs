// Pelea contra la CPU con dos barberos, con toques reales (CDP), hasta el resultado.
//   node scripts/juego/integracion/pelea-elenco.mjs <jugador> <rival> <arena> <anchoxalto> [puerto]
//   (todas-cpu.sh corre las 11 del elenco nuevo: cada uno una vez como jugador y otra como rival)
// - Entra con /juego?prueba=<jugador>,<rival>,<arena>,normal (sólo desarrollo).
// - 20 s de toques al azar (stick SOSTENIDO con el dedo 1 + GOLPE/MÁQUINA/GUARDIA/ESQUIVA + cartas con
//   el dedo 2). Después de cada toque: ningún botón ni carta queda apretado y el stick sigue tomado
//   (multitouch de verdad: cdp.mjs suelta sólo el dedo que se levanta).
// - Los dos especiales del jugador con la carta (la carga se llena por el gancho de pruebas para no
//   esperar): mide que salga el evento `especial`, lo que tira (proyectiles/estados/curación) y las
//   fuentes de sonido que se crean en los 1,2 s siguientes; saca una foto del efecto.
// - Apura el final (vida del rival a 1, como pelea-cpu.mjs) y espera la pantalla de resultado.
// - Consola: cero errores y avisos (incluidos los 404 de recursos).
// En el resultado NO se toca nada (los botones guardan en la base de producción).
import { writeFileSync } from 'node:fs'
import { abrirChrome, esperar, DIR, urlBase } from './cdp.mjs'

const [jugador, rival, arena = 'rondeau', tam = '844x390', puerto = '9381'] = process.argv.slice(2)
const [ancho, alto] = tam.split('x').map(Number)
const URL = `${urlBase()}/juego?prueba=${jugador},${rival},${arena},normal`
const nombre = `${jugador}_vs_${rival}_${tam}`
let semilla = 7
const rnd = () => { semilla = (semilla * 1103515245 + 12345) & 0x7fffffff; return semilla / 0x7fffffff }
const log = []
const anotar = (t) => { log.push(t); console.log(t) }
let fallas = 0
const verificar = (cond, t) => { anotar(`${cond ? 'OK   ' : 'FALLA'} ${t}`); if (!cond) fallas++ }
const c = await abrirChrome({ ancho, alto, movil: true, puerto: Number(puerto), prefs: { tutorialVisto: true, dificultad: 'normal' } })
try {
  await c.cdp('Page.navigate', { url: URL })
  if (!(await c.esperarQue(`window.__corteFinal?.partida?.fase === 'pelea'`, 90000))) throw new Error('no arrancó la pelea')
  const cfg = await c.evaluar(`(() => { const k = window.__corteFinal.partida.config; return { personajes: k.personajes, cpu: k.cpu, arena: k.arena, dificultad: k.dificultad } })()`)
  verificar(cfg.personajes[0] === jugador && cfg.personajes[1] === rival && cfg.cpu[1] && !cfg.cpu[0], `${nombre}: pelea ${JSON.stringify(cfg)}`)
  // Observa los eventos del motor sin tocarlos (envuelve el push del arreglo que el loop vacía).
  await c.evaluar(`(() => {
    const p = window.__corteFinal.partida
    window.__evs = []
    const push = p.eventos.push.bind(p.eventos)
    p.eventos.push = (...a) => { for (const e of a) window.__evs.push({ t: p.tick, e }); return push(...a) }
    return true
  })()`)
  const g = await c.evaluar(`(() => { const z = document.querySelector('[data-zona="joystick"]').getBoundingClientRect(); const cs = getComputedStyle(document.querySelector('.cf-pelea')); return { zx: z.left, zy: z.top, jx: parseFloat(cs.getPropertyValue('--joy-x')), jy: parseFloat(cs.getPropertyValue('--joy-y')), R: parseFloat(cs.getPropertyValue('--joy-r')) } })()`)
  const P0 = [g.zx + g.jx, g.zy + g.jy]
  const btn = {}
  for (const b of ['golpe', 'herramienta', 'guardia', 'dash']) btn[b] = await c.centro(`[data-boton="${b}"]`)
  const carta = [await c.centro('[data-carta="1"]'), await c.centro('[data-carta="2"]')]
  // Multitouch: después de levantar el dedo 2 no puede quedar ningún botón ni carta con data-activo
  // y, mientras el pulgar sigue en el stick, el joystick tiene que seguir tomado.
  const multitouch = { toques: 0, colgados: [], stickSuelto: 0 }
  const tocarEn = async (b, ms = 40, conStick = false) => {
    await c.dedo.bajar(2, b[0], b[1])
    await esperar(ms)
    await c.dedo.subir(2)
    multitouch.toques++
    const e = await c.evaluar(`({ colgados: [...document.querySelectorAll('[data-boton][data-activo], [data-carta][data-activo]')].map((x) => x.dataset.boton || 'carta ' + x.dataset.carta), stick: !!document.querySelector('[data-zona="joystick"][data-activo]') })`)
    if (e.colgados.length) multitouch.colgados.push(e.colgados.join('+'))
    if (conStick && !e.stick) multitouch.stickSuelto++
  }
  const tick0 = await c.evaluar('window.__corteFinal.partida.tick')
  const t0 = Date.now()
  // 1) Toques al azar.
  await c.dedo.bajar(1, P0[0], P0[1])
  let ang = 0
  while (Date.now() - t0 < 20000) {
    const fase = await c.evaluar('window.__corteFinal.partida.fase')
    if (fase === 'terminada') break
    ang = rnd() < 0.15 ? [0, 180, 45, 135, -90, 0, 180][Math.floor(rnd() * 7)] : ang
    const r = 0.4 + rnd() * 1.0
    c.dedo.moverYa(1, P0[0] + Math.cos((ang * Math.PI) / 180) * r * g.R, P0[1] - Math.sin((ang * Math.PI) / 180) * r * g.R)
    const q = rnd()
    if (q < 0.45) await tocarEn(btn.golpe, 40, true)
    else if (q < 0.55) await tocarEn(btn.herramienta, 40, true)
    else if (q < 0.62) await tocarEn(btn.guardia, 300, true)
    else if (q < 0.68) await tocarEn(btn.dash, 40, true)
    else if (q < 0.74) await tocarEn(carta[Math.floor(rnd() * 2)], 60, true)
    await esperar(80 + rnd() * 120)
  }
  await c.dedo.subir(1)
  verificar(
    multitouch.toques >= 10 && multitouch.colgados.length === 0 && multitouch.stickSuelto === 0,
    `${nombre}: multitouch, ${multitouch.toques} toques con el stick sostenido → ${multitouch.colgados.length} con algo colgado${multitouch.colgados.length ? ' (' + [...new Set(multitouch.colgados)].join(', ') + ')' : ''}, ${multitouch.stickSuelto} con el stick suelto`,
  )
  const tick1 = await c.evaluar('window.__corteFinal.partida.tick')
  const tps = (tick1 - tick0) / ((Date.now() - t0) / 1000)
  const est = await c.evaluar(`(() => { const p = window.__corteFinal.partida; return { fase: p.fase, round: p.round, vida: p.luchadores.map((l) => Math.round(l.vida)), intentados: p.estadisticas[0].golpesIntentados, acertados: p.estadisticas[0].golpesAcertados, especiales: [p.estadisticas[0].especialesUsados, p.estadisticas[1].especialesUsados] } })()`)
  verificar(tps >= 54 && est.intentados >= 8, `${nombre}: 20 s de toques al azar → ${tps.toFixed(1)} ticks/s · ${JSON.stringify(est)}`)
  await c.foto(`${DIR}/${nombre}_1_pelea.png`)

  // 2) Los dos especiales con la carta: evento, lo que tira y el sonido.
  for (const n of [1, 2]) {
    // Hasta 3 intentos: si la CPU le pega justo cuando toca la carta, el especial no sale (está
    // aturdido) y eso es el juego funcionando, no una falla.
    for (let intento = 1; intento <= 3; intento++) {
      // espera un momento en que el jugador pueda actuar (en pelea, sin estar tirado ni agarrado)
      let listo = false
      for (let i = 0; i < 60 && !listo; i++) {
        listo = await c.evaluar(`(() => { const p = window.__corteFinal.partida; const l = p.luchadores[0]; if (p.fase !== 'pelea') return false; const libre = ['quieto', 'caminando', 'agachado', 'guardia'].includes(l.estado) && l.enSuelo; if (libre) { l.carga = 10; const r = p.luchadores[1]; if (Math.abs(r.x - l.x) > 260) l.x = r.x - 200 * Math.sign(r.x - l.x || 1) } return libre })()`)
        if (!listo) await esperar(100)
      }
      if (!listo) { verificar(false, `${nombre}: el jugador nunca quedó libre para el especial ${n}`); continue }
      const f0 = await c.evaluar('window.__fuentes ?? -1')
      const e0 = await c.evaluar('window.__evs.length')
      await tocarEn(carta[n - 1], 60)
      await esperar(380)
      await c.foto(`${DIR}/${nombre}_2_especial${n}_a.png`)
      await esperar(820)
      await c.foto(`${DIR}/${nombre}_2_especial${n}_b.png`)
      const f1 = await c.evaluar('window.__fuentes ?? -1')
      const r = await c.evaluar(`(() => {
        const evs = window.__evs.slice(${e0}).map((x) => x.e)
        const esp = evs.find((e) => e.tipo === 'especial' && e.quien === 0)
        const cuenta = {}
        for (const e of evs) { const k = e.tipo === 'golpe' ? 'golpe:' + e.herramienta + (e.atacante === 0 ? '' : '(cpu)') : e.tipo === 'proyectil' ? 'proyectil:' + e.proyectil : e.tipo; cuenta[k] = (cuenta[k] || 0) + 1 }
        return { especial: esp ? { numero: esp.numero, nombre: esp.nombre } : null, eventos: cuenta }
      })()`)
      const ficha = await c.evaluar(`(() => { const p = window.__corteFinal.partida; return p.luchadores[0].id })()`)
      if (!r.especial && intento < 3) {
        anotar(`      ${nombre}: el especial ${n} no salió en el intento ${intento} (${JSON.stringify(r.eventos)}): otra vez`)
        await esperar(900)
        continue
      }
      verificar(!!r.especial && r.especial.numero === n && f1 - f0 >= 8,
        `${nombre}: ${ficha} especial ${n} «${r.especial?.nombre ?? '—'}»: ${f1 - f0} fuentes de sonido nuevas · eventos ${JSON.stringify(r.eventos)}${intento > 1 ? ` (intento ${intento})` : ''}`)
      await esperar(900)
      break
    }
  }

  // 3) Apurar el final: el rival a 1 de vida y GOLPE hasta el resultado.
  const tF = Date.now()
  while (Date.now() - tF < 90000) {
    const fase = await c.evaluar(`(() => { const p = window.__corteFinal.partida; if (p.fase === 'pelea') { p.luchadores[1].vida = 1; if (Math.abs(p.luchadores[1].x - p.luchadores[0].x) > 90) p.luchadores[0].x = p.luchadores[1].x - 80 * Math.sign(p.luchadores[1].x - p.luchadores[0].x || 1) } return p.fase })()`)
    const pantalla = await c.evaluar(`document.querySelector('.cf-juego')?.dataset.pantalla`)
    if (pantalla === 'resultado') break
    if (fase === 'pelea' || fase === 'final') await tocarEn(btn.golpe)
    await esperar(120)
  }
  const llego = await c.esperarQue(`document.querySelector('.cf-juego')?.dataset.pantalla === 'resultado'`, 20000)
  const fin = await c.evaluar(`(() => { const evs = window.__evs.map((x) => x.e); return { alCero: evs.some((e) => e.tipo === 'final_al_cero'), finPartida: evs.find((e) => e.tipo === 'fin_partida')?.ganador ?? null, titulo: document.querySelector('.cf-resultado__titulo')?.textContent ?? null } })()`)
  verificar(llego, `${nombre}: resultado en ${((Date.now() - tF) / 1000).toFixed(1)} s · ${JSON.stringify(fin)}`)
  await esperar(1800)
  await c.foto(`${DIR}/${nombre}_3_resultado.png`)
  const pedidos404 = await c.evaluar(`performance.getEntriesByType('resource').filter((r) => r.responseStatus >= 400).map((r) => r.responseStatus + ' ' + r.name)`)
  const juego = await c.evaluar(`performance.getEntriesByType('resource').filter((r) => /\\/juego\\/personajes\\//.test(r.name)).map((r) => r.name.split('/juego/personajes/')[1])`)
  anotar(`      recursos de personajes pedidos: ${JSON.stringify(juego)}`)
  verificar(multitouch.colgados.length === 0, `${nombre}: en toda la pelea (${multitouch.toques} toques) ningún botón ni carta quedó apretado`)
  verificar(pedidos404.length === 0, `${nombre}: ningún pedido con error (${pedidos404.length ? pedidos404.join(' | ') : 'ninguno'})`)
  verificar(c.consola.length === 0, `${nombre}: consola ${c.consola.length ? c.consola.slice(0, 8).join(' | ') : 'sin errores ni avisos'}`)
  anotar(fallas === 0 ? `${nombre} TODO OK` : `${nombre} ${fallas} FALLAS`)
} catch (e) {
  fallas++
  anotar('FALLÓ ' + (e && e.stack || e))
  try {
    await c.foto(`${DIR}/${nombre}_x_error.png`)
  } catch {
    // sin captura: la pestaña ya no está
  }
} finally {
  writeFileSync(`${DIR}/${nombre}.txt`, log.join('\n') + '\n')
  process.exitCode = fallas === 0 ? 0 : 1
  await c.cerrar()
}
