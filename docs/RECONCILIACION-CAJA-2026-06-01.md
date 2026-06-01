# Reconciliación de caja — transferencias duplicadas

**Fecha:** 1 de junio de 2026 · **Hora de aplicación:** 11:39 (hora Argentina)
**Para:** el dueño de la barbería · **Hecho por:** equipo de sistema

---

## En una frase

Durante un tiempo, algunos cortes pagados por **transferencia** quedaron anotados **2 o 3 veces** en el sistema. Eso **infló el reporte de "total transferido" en $272.000**, repartidos en **14 cortes**. **No es plata perdida ni se le cobró de más a ningún cliente** — el cliente transfirió **una sola vez** al banco; el problema era sólo cuántas veces lo **anotaba** nuestro sistema. Ya **corregimos los registros** (el reporte vuelve a coincidir con la realidad) y **cambiamos el sistema para que no se repita**.

---

## ¿Qué pasó, en criollo?

Cuando el barbero toca **"Finalizar"** al terminar un corte, el sistema:
1. cierra el corte,
2. anota el cobro (efectivo / tarjeta / **transferencia**),
3. suma la comisión, descuenta productos, etc.

Si la pantalla tardaba (internet lento) y el barbero tocaba **"Finalizar" otra vez**, o la app reintentaba sola tras una demora, el corte ya estaba cerrado **pero igual se volvía a anotar el cobro**. Para los pagos por **transferencia**, eso dejaba **2 o 3 anotaciones del mismo dinero** en nuestro registro interno (`transfer_logs`), que es lo que alimenta el reporte de "total transferido por cuenta".

**Importante:** el cliente **transfirió una sola vez** a la cuenta. El duplicado existía **sólo en nuestro reporte**, no en el banco. Por eso esto **no** significa:
- ❌ que falte plata,
- ❌ que se le haya cobrado dos veces a un cliente,
- ❌ que un barbero haya cobrado de más en su bolsillo.

Significa, simplemente, que el **número de "total transferido"** que mostraba el sistema estaba **más alto de lo real** por esas anotaciones repetidas.

---

## ¿Cuánto y dónde? (los 14 cortes afectados)

**Total inflado en el reporte: $272.000** (16 anotaciones repetidas sobre 14 cortes).

| # | Fecha | Sucursal | Barbero | Cuenta (a la que figuraba la transf.) | Monto del corte | Veces anotado | $ de más |
|---|---|---|---|---|---|---|---|
| 1 | 17/04 11:45 | Caseros | Gabriel Rodriguez | Maximo Tomas Zapata | $16.000 | 3 | $32.000 |
| 2 | 21/05 11:40 | Caseros | Tomas Zapata | Maximo Tomas Zapata | $32.000 | 2 | $32.000 |
| 3 | 21/03 17:54 | Rondeau | Tony Ramirez | NIco Maidana | $14.000 | 3 | $28.000 |
| 4 | 30/05 18:16 | Rondeau | Fabrizio Galeassi | NIco Maidana | $20.000 | 2 | $20.000 |
| 5 | 21/03 17:33 | Paraná | Tomi Quintana | Nahuel Vargas | $20.000 | 2 | $20.000 |
| 6 | 17/04 12:44 | Paraná | Nahuel Vargas | Nahuel Vargas | $16.000 | 2 | $16.000 |
| 7 | 21/03 17:28 | Paraná | Joaquin Llampa | Nahuel Vargas | $16.000 | 2 | $16.000 |
| 8 | 13/05 20:07 | Rondeau | Simón Bongeovanni | NIco Maidana | $16.000 | 2 | $16.000 |
| 9 | 15/05 21:05 | Rondeau | Simón Bongeovanni | NIco Maidana | $16.000 | 2 | $16.000 |
| 10 | 03/04 17:15 | Paraná | Rodrigo Chara | Antonio | $16.000 | 2 | $16.000 |
| 11 | 08/05 19:25 | Rondeau | Nico Ulloque | NIco Maidana | $16.000 | 2 | $16.000 |
| 12 | 17/04 13:43 | Paraná | Rodrigo Chara | Nahuel Vargas | $16.000 | 2 | $16.000 |
| 13 | 21/03 17:58 | Rondeau | Fabrizio Galeassi | NIco Maidana | $14.000 | 2 | $14.000 |
| 14 | 21/03 17:17 | Rondeau | Fabrizio Galeassi | NIco Maidana | $14.000 | 2 | $14.000 |

**$ inflado por cuenta:**
- **NIco Maidana** (Rondeau): **$124.000**
- **Nahuel Vargas** (Paraná): **$68.000**
- **Maximo Tomas Zapata** (Caseros): **$64.000**
- **Antonio** (Paraná): **$16.000**

> Dato de color: **5 de los 14** casos ocurrieron el **21/03** — fue un día con conexión inestable, justo el escenario que dispara el reintento. La mayoría de los duplicados se anotaron con segundos de diferencia (doble toque), y algunos a 1-6 minutos (reintento tras una demora).

---

## ¿Qué hicimos?

1. **Limpiamos los registros repetidos** (1/6/2026 11:39 hs ART): borramos las **16 anotaciones duplicadas** dejando, en cada corte, **la primera** (la verdadera). A partir de ahora el reporte de "total transferido por cuenta" **baja $272.000** y **coincide con lo que realmente entró**.
   - No se tocó ningún corte, ninguna comisión ni ningún cobro: **sólo** se quitaron las copias del registro de transferencias.

2. **Bloqueamos que vuelva a pasar**, con dos candados:
   - **En la app:** si se toca "Finalizar" dos veces (o la app reintenta), la segunda vez **no hace nada** — detecta que el corte ya estaba cerrado y corta antes de anotar cobros, comisiones o productos.
   - **En la base de datos:** ahora es **imposible** anotar dos transferencias para el mismo corte (regla `uq_transfer_logs_visit_id`). Si llegara un intento repetido, se ignora solo.

---

## ¿Tenés que hacer algo?

**No.** Los reportes ya reflejan los números correctos. Si exportaste o anotaste el "total transferido" de esas cuentas **antes del 1/6/2026**, tené en cuenta que ese total venía inflado por los montos de la tabla de arriba.

Si querés, podemos sacarte el reporte de caja **actualizado** de cualquier sucursal/cuenta para que lo compares.

---

*Detalle técnico completo de todos los cambios: ver `CHANGELOG-fila-dinamica-2026-06-01.md`.*
