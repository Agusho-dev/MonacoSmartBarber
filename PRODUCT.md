# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Barberos** — usuarios del panel `/barbero`. Unos 20 entre las sucursales de Monaco (Caseros, Paraná, Pueyrredón, Rondeau). **Cada uno trabaja con su propia tablet en su puesto** (confirmado por el dueño), casi siempre en **vertical** y a veces apaisada; algunas están montadas al revés (giro 180°). La miran desde la silla mientras cortan y la tocan entre corte y corte. Entran con su PIN después de fichar en el kiosko.
- **El cliente sentado en la silla** ve la tablet del barbero: es público pasivo del panel.
- **Dueño y encargados** — dashboard `/dashboard`: configuran sucursales, precios, fidelización, sueldos y miran resultados.
- **Clientes** — kiosko de check-in, TV de la fila, turnero público y app Flutter "Monaco".

## Product Purpose

Manejar el día de una barbería que trabaja por orden de llegada: quién espera, quién atiende a quién, cuánto dura cada corte, cómo se cobra y qué ve el dueño después.

Para el panel del barbero, el éxito es que el barbero sepa siempre **qué hora es, a quién le toca y cuánto lleva el corte**, y que pueda empezar y cobrar con un toque **sin salir de pantalla completa**.

## Positioning

Una fila dinámica compartida ("Mi fila" de cada barbero + el pool de "Menor espera") en lugar de una agenda de turnos; los turnos conviven con la fila sin reemplazarla. El ritmo del corte se comunica con un semáforo de color que el barbero lee de reojo.

## Operating Context

- Medido en los últimos 30 días (al 19/oct/2026): entre 10 y 55 ingresos por día según la sucursal; normalmente esperan de 2 a 5 personas (máximo 13); el corte dura una mediana de 31 a 37 min; cada barbero hace unos 8 cortes por día; la espera promedio va de 4 a 21 min. Ningún turno pasó por la fila en ese período: las sucursales en modo `hybrid` operan como walk-in.
- El panel corre como app instalada (TWA) en pantalla completa y en modo kiosko. **La pantalla completa esconde la barra de Android con la hora, y los barberos salían de pantalla completa sólo para verla.**
- Local muy iluminado, con espejos.
- Hora de pared: `America/Argentina/Buenos_Aires` (la de la sucursal).

## Capabilities and Constraints

- Panel del barbero: Fila (Mi fila / General, atender, iniciar turno, cobrar, ausente, descansos y su aprobación, venta de productos, entregar premio, ocultarse del check-in, gestionar barberos), Metas, Asistencia, Historial, Caja (cerrar turno) y login por PIN.
- La lógica de la fila y del cobro no cambia con un rediseño: `claim_next_for_barber`, `completeService`, la ventana de protección de turnos, el auto-arranque de descansos y los avisos de asesoría y de Menor espera.
- Restricciones técnicas del panel (CLAUDE.md): estructura del giro 180° siempre montada, nada se portalea a `document.body`, sin `touchmove`, la fila no se re-lee con consultas pesadas (Known Risks #9/#10), la anon key sólo lee columnas explícitas.
- Vocabulario de color que ya significa algo en todo el sistema: **violeta** turnos, **ámbar** descansos y demoras, **fucsia** asesoría, **verde** corte en curso y primer corte, **azul** Menor espera, **rojo** crítico.
- El barbero nunca ve la facturación total del día: sólo cortes, su comisión y propinas.

## Brand Commitments

- **Semáforo del corte** (vinculante, confirmado por el dueño): blanco 0–25 min → celeste 25–30 → azul 30–35 → amarillo 35–45 → rojo 45+. Se comunica sólo con color, nunca con palabras que hagan ver apurado al barbero frente al cliente.
- **Fondo claro** en el panel del barbero (vinculante, confirmado por el dueño).
- **Arriba, sólo la hora** (confirmado por el dueño): nada más al lado.
- Sin emojis en la interfaz: íconos (lucide).
- Textos en español rioplatense (vos).
- Marca "Monaco Barber Studio".

## Evidence on Hand

- Datos de uso reales en la base de producción (fila, visitas, fichajes). No hay fotos de los locales ni de los puestos en el repo.
- El horario de trabajo (`staff_schedules`) está cargado para 10 de 21 barberos: no sirve como fuente para "cuánto falta para irse".

## Product Principles

1. **Fácil de entender y de ver todo** (palabras del dueño): lo importante se lee desde la silla, a uno o dos metros.
2. **Un toque a la próxima acción**: atender, cobrar y terminar el descanso nunca están escondidos.
3. **Nunca dejar mal parado al barbero frente al cliente**: el estado se dice con color, no con reproches.
4. **Una falla se dice**: nada de errores silenciosos ni pantallas que parecen andar.
