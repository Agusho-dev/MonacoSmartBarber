# Design

Sistema visual del **panel del barbero** (`/barbero/*`). El dashboard, el kiosko, la TV y el turnero tienen mundos propios y no se rigen por este archivo.

## El mundo: un reloj fichador

La tablet de cada puesto es un reloj de fichar:

- **La hora vive en su visor**, arriba, en todas las pantallas (`BandaReloj` en el layout). Sólo la hora: decisión del dueño.
- **El cliente en la silla es la ficha que se está marcando.** La cartulina de esa ficha cambia de color con el semáforo del corte.
- **La fila es el tarjetero**: fichas de cartulina blanca, una debajo de la otra, sin pestañas.
- **La máquina es grafito; todo lo demás es cartulina.** Hay exactamente dos piezas oscuras: el visor de la hora y la ranura de la que cuelga la ficha de la silla. El visor también muestra la plata cuando es LA cifra de la pantalla: en Caja, el efectivo a entregar; en el cobro, lo que hay que cobrar.

Rechaza el dashboard genérico de pestañas y tarjetas grises: la pestaña "General" escondía a los clientes sin barbero.

## Escena

Cada barbero tiene su tablet en el puesto, casi siempre vertical (~800×1280), a veces apaisada o montada al revés (giro 180°). La lee de reojo desde la silla, a 1–2 m, con el cliente sentado mirándola también; la toca entre corte y corte. Local muy iluminado y con espejos: el fondo es claro (decisión del dueño).

## Color

Estrategia: **neutros + color semántico**. El único campo grande de color es la ficha de la silla, y su color es información (el semáforo), no decoración.

| Token (`.barber-theme`, globals.css) | Valor | Uso |
|---|---|---|
| `--background` | `oklch(0.958 0.004 250)` (#eff1f4) | Esmalte del panel |
| `--card` | blanco | Cartulina de las fichas |
| `--foreground` / `--primary` | `oklch(0.2–0.22 0.012 260)` | Tinta grafito; botones principales |
| `--muted-foreground` | `oklch(0.45 0.012 260)` | Texto secundario (≥4.5:1 sobre esmalte) |
| `--visor-bg` / `--visor-fg` | grafito / marfil | Visor de la hora, ranura, visor de Caja |
| `--timer-*` | sin cambios | Semáforo del corte (vinculante) |
| ámbar anaranjado `oklch(0.86–0.9 0.085–0.12 70)` | — | Cartulina del descanso y alarma de "tu cliente te está esperando": a propósito NO es el amarillo 35–45 min del semáforo |

**Semáforo del corte (no se toca):** blanco 0–25 min → celeste 25–30 → azul 30–35 → amarillo 35–45 → rojo 45+ (pulsa). Sólo color: nunca palabras que hagan ver apurado al barbero frente al cliente.

**Vocabulario de color del sistema (no se reasigna):** violeta = turnos · fucsia = asesoría (la ficha entera se tiñe) · azul = Menor espera y "sin barbero" · verde = primer corte, meta lograda · ámbar = descansos (pedido, aprobado, en curso) y demoras (espera ≥ 40 min) · rojo = crítico (espera ≥ 70 min, ausente). Las propinas y la plata a favor van en tinta, nunca en rojo.

**Contraste pendiente (decisión del dueño):** sobre la etapa azul del semáforo el texto blanco da 3,5:1. Alcanza para el texto grande (nombre, minutos, servicio en negrita), no para el chico (observaciones del cliente). Arreglarlo es oscurecer apenas el azul (`--timer-focus-bg` a L≈0,56) o pasar el texto de esa etapa a negro; las dos cosas tocan el semáforo, que es intocable sin su visto bueno.

## Tipografía

Una sola familia de texto (Geist) y **Geist Mono sólo para medir**: la hora, los minutos del corte, las esperas, las llegadas, los conteos y la plata del ticket. Las unidades ("min", "h") van en la letra del texto, chicas, al lado del número (`CifraEspera`).

**El único "HH:MM" de la pantalla es la hora.** Lo que dura algo se dice en minutos ("32 min", "1 h 05"), nunca "32:01": con el visor arriba, un cronómetro m:ss se leía como otra hora (en los primeros minutos, "8:01" ES una hora válida) y sus segundos se movían todo el tiempo frente al cliente.

| Rol | Tamaño (tablet) |
|---|---|
| Hora en la banda | 48px mono semibold (24px en celular) |
| Hora en el PIN (pantalla de bloqueo) | 92px |
| Minutos de la silla ("32 min") | 88px mono + unidad al 30% (52px en celular) |
| Nombre en la silla | 36px bold |
| Nombre en la fila | 22px semibold |
| Título de pantalla | 26px bold |
| Título de tramo ("Tu fila") | 17px semibold + cantidad en mono |
| Sello | 11px bold mayúsculas, tracking 0.07em |

Sin rótulos chicos arriba de un título (eyebrows): el título habla solo.

## Componentes

- **Banda del reloj** (`reloj/banda-reloj.tsx`, `reloj/visor-hora.tsx`): pegajosa, alto `--alto-banda`. Hora del dispositivo, se actualiza al borde de cada minuto y al volver de reposo; en el servidor no se pinta hora. Los dos puntos laten 1 vez por segundo (quietos con reduced-motion). Oculta en el PIN.
- **Cabecera de la fila** (`fila/cabecera-fila.tsx`): quién sos (foto o iniciales, sucursal, cortes de hoy, sello "Oculto") + Descanso y Vender a la vista; lo ocasional va en "Más".
- **Ranura + silla** (`fila/silla.tsx`): la boca grafito recorta sólo hacia arriba; lo que entra a la silla baja desde ahí (`silla-entra`, 320 ms). Estados: corte (semáforo, cartulina llena), descanso (ámbar), el que sigue, descanso próximo, vacía, cargando. **Punteado = todavía no se marcó; cartulina llena = corre el reloj**: el que sigue, la silla vacía y el descanso próximo van con filete punteado; el que sigue además en cartulina gris, con el sello "Sigue" y Atender a todo el ancho. Con tu fila vacía, sube a la silla el primero del local sin barbero que puedas atender.
- **Ficha de espera** (`fila/tarjeta-espera.tsx`): tres tamaños — `silla`, `propia` (Tu fila, con el número de orden; "sigue" en el 1) y `local` (renglón compacto). La espera es un sello mono que se pone ámbar a los 40 min y rojo a los 70. La X de "no vino" siempre confirma.
- **Minutos en vivo** (`fila/minutos-en-vivo.tsx`): los minutos del corte o del descanso; se redibuja justo al cumplirse cada minuto y al volver de reposo. Mide con `computeMinutes`, la misma cuenta que el semáforo.
- **Regla del descanso** (`fila/regla-minutos.tsx`): de 0 a la duración del descanso, con una aguja y los minutos de referencia. **Sólo en el descanso.** En el corte no hay ninguna línea de progreso: el dueño la sacó porque el cliente sentado siente que el barbero se apura; ahí el color del semáforo alcanza.
- **Sello** (`fila/sello.tsx`): la marca chica de la ficha; un tono por palabra del vocabulario de color.
- **Encabezado de pantalla** (`encabezado-pantalla.tsx`): Metas, Asistencia, Historial, Caja; se pega debajo de la banda.
- **Cobro** (`complete-service-dialog.tsx` + `cobro/`): el título es el nombre del cliente y debajo va el paso ("Paso 1 de 2 · Qué se hizo" / "Cómo paga"). Todo se elige con un toque —servicio, extras, medio de pago, propina— y lo elegido queda en grafito lleno, sin agrandarse (`CLASE_OPCION` + `claseEstadoOpcion`). El monto va en el visor (`VisorMonto`). Una barra fija abajo tiene siempre el total y el paso siguiente: con transferencia y comprobante obligatorio, el paso siguiente es "Confirmar con escaneo". El alias es un ticket punteado (la plata todavía no entró) que se parte en los puntos, nunca con guion. El cobro también se abre en el dashboard, que es oscuro: los avisos de color van con `claseAviso(color, tono)` (`cobro/tono.ts`), **nunca con `dark:`** (el `@custom-variant dark` exige un `.dark` que la app no pone: un `dark:` no se aplica nunca).
- **Barra de secciones** (`barber-nav.tsx`): la sección activa es una pastilla grafito llena (se ve desde la silla); "Pantalla" comparte el estilo pero nunca queda activa.

## Pantallas

- **Fila**: vertical = una columna (silla arriba, tarjetero abajo: Tu fila · En el local · Cortando ahora). Apaisada (≥1024px) = silla y "Cortando ahora" a la izquierda, tarjetero a la derecha, cada uno con su scroll. En la ficha del corte no van ni la duración del servicio ni el número de la TV.
- **PIN**: pantalla de bloqueo — la hora grande, la marca, sucursales como botones de un toque, teclado de 72px.
- **Metas**: tarjeta perforada — un agujero por corte hasta 60; más, una barra. **Sin el total de cortes del mes** (decisión del dueño): cada meta llega del servidor con su avance ya acotado a su umbral y dice cuánto falta para ella. La sección se apaga por sucursal (Rondeau y Paraná, desde el dashboard): sin ella la barra queda con cuatro.
- **Asistencia**: la tarjeta de fichaje del mes — un renglón por día con sus marcas de entrada y salida.
- **Historial**: libro de marcas por día (hora · cliente y servicio · duración · cobro), sin conteo por día: sumados, daban el total del mes.
- **Caja**: el efectivo a entregar en el visor grafito; el detalle como ticket con renglones punteados.

## Movimiento

150–320 ms, ease-out exponencial. Movimiento sólo para estado: la ficha que entra a la silla, una ficha nueva en el tarjetero (`ficha-asoma`), el latido de los dos puntos (cada 2 s, suave: está a la vista todo el día), el pulso del rojo. Todo se apaga con `prefers-reduced-motion`.

## Tacto y distancia

Botones de 44–72px; acciones de la silla de 64px. Nada importante por debajo de 15px. Lo que se lee desde la silla (hora, cronómetro, color, nombre del que sigue) va de 36px para arriba.

## Restricciones técnicas (no negociables)

Giro 180°: nada se portalea a `document.body`, sin `touchmove`, estructura del giro estable en el layout. La fila mide `100dvh − --alto-banda − --alto-nav − área segura` y el documento no scrollea. Ver `MonacoSmartBarber/CLAUDE.md`.
