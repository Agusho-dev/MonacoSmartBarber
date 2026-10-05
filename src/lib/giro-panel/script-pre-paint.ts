import { CLAVE_GIRO } from './nucleo'

/**
 * Script inline que el layout de /barbero emite ANTES de #giro-raiz, así corre
 * antes del primer paint: sin él, cada carga de una tablet girada mostraría un
 * cuadro al revés hasta que React hidrata (en las tablets flojas, segundos).
 *
 * Espeja `necesitaCss()` de nucleo.ts, a mano y en ES5: no puede importar nada.
 * Si la regla cambia allá, cambia acá (y en el OFFLINE_HTML de public/sw.js).
 *   - sin preferencia, o sin objetivo         → no gira
 *   - sistemaGira (Android rota solo)         → no gira
 *   - sin API de orientación                  → gira (giro relativo)
 *   - orientación actual = opuesta(objetivo)  → gira
 *
 * Todo va en try: un localStorage bloqueado o un JSON roto dejan el panel
 * derecho, que es lo que había antes de que existiera el botón.
 *
 * Se emite SIEMPRE en /barbero: sin preferencia guardada no hace nada. Cuando se
 * entra a /barbero por navegación del cliente, React no ejecuta scripts; ahí lo
 * resuelve el store en el useLayoutEffect de GiroPanelRaiz.
 */
export const SCRIPT_GIRO_PRE_PAINT = `(function(){try{
var d=document.documentElement;
var raw=window.localStorage.getItem(${JSON.stringify(CLAVE_GIRO)});
if(!raw)return;
var p=JSON.parse(raw);
if(!p||typeof p!=='object')return;
var o=p.objetivo,re=/^(portrait|landscape)-(primary|secondary)$/;
if(typeof o!=='string'||!re.test(o)||p.sistemaGira===true)return;
var op=/-primary$/.test(o)?o.replace('-primary','-secondary'):o.replace('-secondary','-primary');
var t=window.screen&&screen.orientation?screen.orientation.type:null;
if(typeof t!=='string'||!re.test(t))t=null;
d.setAttribute('data-giro-objetivo',o);
if(!t||t===op)d.setAttribute('data-giro','css');
}catch(e){}})();`
