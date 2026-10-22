// Las pocas animaciones propias de la conciliación. Van en un <style> que React
// 19 sube al <head> una sola vez (href + precedence lo deduplican), así no se
// toca globals.css por tres keyframes de una pantalla. Todo se apaga con
// prefers-reduced-motion.
//
//   cmp-crece    las barras de la balanza crecen desde la izquierda (700 ms),
//                una vez al aparecer. Es CSS puro: corre con el HTML del
//                servidor, sin esperar a que hidrate.
//   cmp-pliegue  una fila resuelta se pliega (220 ms).
//   cmp-hormigas el borde punteado que corre mientras se espera la autorización
//                (1,2 s, lineal): está atado a ese estado, no es un loop suelto.
//   cmp-llena    y al conectarse el borde se llena (300 ms).
//   cmp-barrido  la línea fina que avisa que se está recalculando, sin tapar nada.

const CSS = `
@keyframes cmp-crece { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes cmp-hormigas { to { stroke-dashoffset: -12; } }
@keyframes cmp-llena { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes cmp-barrido { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
.cmp-crece { transform-origin: left center; }
.cmp-pliegue { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 220ms ease; }
.cmp-pliegue > * { min-height: 0; overflow: hidden; }
.cmp-pliegue[data-plegado='true'] { grid-template-rows: 0fr; opacity: 0; pointer-events: none; }
@media (prefers-reduced-motion: no-preference) {
  .cmp-crece { animation: cmp-crece 700ms cubic-bezier(0.22, 1, 0.36, 1) both; }
  .cmp-hormigas { animation: cmp-hormigas 1.2s linear infinite; }
  .cmp-llena { animation: cmp-llena 300ms cubic-bezier(0.4, 0, 0.2, 1) both; }
  .cmp-barrido { animation: cmp-barrido 1.1s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
}
@media (prefers-reduced-motion: reduce) {
  .cmp-pliegue { transition: none; }
}
`

export function EstilosConciliacion() {
  return (
    <style href="msb-conciliacion-mp" precedence="default">
      {CSS}
    </style>
  )
}
