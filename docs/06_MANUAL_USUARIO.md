# 06 · Manual de usuario del simulador

> **Última actualización:** 2026-11-23
> **Para:** supervisores, calidad, operadores y cualquier persona que quiera entender el sistema antes de instalarlo en planta.
> **No necesita** saber programar. Para el detalle técnico vea [05_DOCUMENTACION_TECNICA.md](05_DOCUMENTACION_TECNICA.md).

## 1. ¿Qué es esto?

Es una planta de inyección "de mentira" que funciona igual que funcionará la real: 51 inyectoras en tres líneas (L1: 22, L2: 20, L3: 9) que comparten el almacén de materia prima, la mezanina, cuatro mesas de SM1, dos puestos de producto terminado y la cámara de embarque. Cada estación tiene una terminal con lector de códigos que manda sus escaneos por radio (LoRa) a un servidor.

Sirve para:

- Ver cómo se registra cada paso (CP 01 a CP 16) y qué pasa cuando algo sale mal.
- Ser operador: llevar una OT completa con el recorrido guiado, provocar errores y ver el viaje de cada mensaje.
- Rastrear cualquier bolsa, caja o tarima hasta el lote de resina.

Nada de lo que haga aquí afecta a la planta. Puede provocar todas las fallas que quiera.

## 2. Cómo abrirlo

1. Abra una terminal en la carpeta `simulador` y escriba `npm start`. (La primera vez, antes: `npm install`.)
2. Abra el navegador en **http://localhost:8080**.
3. Para apagarlo, presione `Ctrl + C` en la terminal.

Cada vez que se inicia, la planta empieza vacía. Las primeras bolsas aparecen en unos segundos.

## 3. La pantalla

**Barra superior.** Hora de la planta simulada y cuatro indicadores:

| Indicador | Qué significa | Valor normal |
|---|---|---|
| Canal LoRa más ocupado | Porcentaje del tiempo que alguna terminal está transmitiendo, en el canal más cargado. Cada línea tiene su canal | Menos de 15 % |
| Tramas con colisión | Mensajes que chocaron con otro y se reenviaron | Menos de 20 % |
| Eventos en MES | Escaneos guardados en la base de datos | Sube sin parar |
| Tarimas despachadas | Tarimas que pasaron CP 16 | Sube cada pocos minutos |

**Velocidad.** 10× quiere decir que un minuto de planta dura 6 segundos. Bájela a 1× para verlo en tiempo real.

**Línea de checkpoints.** Debajo de las pestañas, los 16 CP en orden. Se iluminan cuando ocurre un escaneo en ese paso.

## 4. Pestaña Planta

**Seguir una OT.** Arriba de las inyectoras. Elija una OT en la lista o haga clic en la tarjeta de una inyectora para seguir la OT que está produciendo. Todo lo que no tiene que ver con esa OT se atenúa y queda resaltado en morado:

- En la línea de checkpoints, los CP por los que ya pasó (rayita morada; roja si hubo falla) y la marca **llegó hasta aquí** en el CP más avanzado. Una OT puede estar en varios CP a la vez: unas bolsas se siguen moldeando mientras otras ya están en caja.
- Las estaciones que la han tocado (materia prima, mezanina, su inyectora, la mesa de SM1, PT, cámara). Las estaciones de la derecha son compartidas: atienden a todas las inyectoras, por eso se resaltan aunque no sean "de" esa máquina. Cada estación resaltada muestra una nota morada con los CP que hizo con esa OT (por ejemplo, `CP 11, 12` en SM1). La que tuvo la última actividad parpadea.
- Sus alertas y sus líneas de la bitácora.
- Un resumen: máquina, producto, bolsas, cajas, tarimas, fallas, hasta qué CP llegó y la última actividad.
- **Ahora:** en palabras, en qué parte va y qué espera. Por ejemplo: "2 de 3 cajas en pre-envío… la tarima se arma cuando estén todas". Una OT se queda en pre-envío (CP 13) hasta que llegan **todas** sus cajas, porque la tarima se arma con la OT completa.

Se actualiza solo cada 2 segundos. **Ver genealogía** abre su árbol completo en la pestaña Trazabilidad; **Dejar de seguir** quita el resaltado.

**Líneas.** Junto al título "Inyectoras" hay dos grupos de botones. El panel recuerda lo que eligió.

- **Líneas:** **Todas**, **Línea 1 · 22**, **Línea 2 · 20** y **Línea 3 · 9**. Cada línea se prende y se apaga con un clic (la palomita ✓ indica que está prendida), así puede ver una sola o varias. Siempre queda al menos una prendida. **Todas** prende las tres. Al lado del título dice qué está viendo, por ejemplo "líneas 2 y 3".
- **Ver como:**
  - **Resumen:** una fila por línea con una luz por máquina, del color de su torreta (con rayas si está sin señal), y cuántas están produciendo, esperando, en falla o sin OT. Pase el mouse sobre una luz para ver la máquina, su OT y lo que dice su pantalla; si hace clic, sigue su OT. **Ver tarjetas** abre solo esa línea en tarjetas.
  - **Tarjetas:** la pantalla completa de cada máquina de las líneas prendidas.

Si sigue una OT de una línea que tiene apagada, el panel la prende. Las estaciones de la derecha siempre se ven, porque las comparten las tres líneas. En los menús de fallas, señal y Terminal, las máquinas vienen agrupadas por línea.

**Inyectoras.** Cada tarjeta es la pantalla de una terminal. El color es el de su torreta Andon:

| Color | Significado |
|---|---|
| Verde | Produciendo, último escaneo correcto |
| Ámbar | Esperando algo (OT, resina, supervisor) o un aviso que no detiene la línea |
| Rojo | Falla: la terminal está bloqueada hasta que llegue el supervisor |
| Gris | Sin OT |

Si una tarjeta dice **sin señal** o muestra un número en **búfer**, la terminal está guardando mensajes en su memoria porque no alcanza al gateway. Los mandará cuando vuelva la señal.

**Estaciones.** Almacén MP, mezanina, las mesas de SM1 (con la pantalla AV de cada una), los puestos de almacén PT y la cámara de embarque. Las comparten las tres líneas.

**Alertas** (debajo de las inyectoras). Cada falla detectada, con la hora, el CP y la estación. "Pendientes" son reglas que el servidor está esperando confirmar porque falta un escaneo de otra estación.

**Provocar una falla** (junto a las alertas). Elija una falla y, si quiere, la inyectora. La falla ocurre en la próxima oportunidad:

| Falla | CP | Qué debería ver |
|---|---|---|
| Certificado de análisis inválido | 01 | Lote a cuarentena; no se usa para ninguna OT |
| Resina incorrecta en el embudo | 04 | La mezanina rechaza la carga; la OT no se libera |
| Operador no habilitado | 06 | Inyectora en rojo hasta que el supervisor la libera |
| QR de otra máquina | 06 | Igual que el anterior |
| Bolsa fuera de tolerancia | 07 | Ámbar; la bolsa se vuelve a pesar |
| Salto en etiqueta correlativa | 07 | Rojo; se exige la etiqueta correcta |
| Defecto crítico en TEP | 08 | La charola queda retenida |
| Charola sin registrar CP 10 | 10 | La caja avanza, pero el servidor levanta una alerta roja a los 10 minutos de planta |
| Bolsa de otra OT en la caja | 11 | La pantalla AV de SM1 la rechaza |
| Bolsa escaneada dos veces | 11 | Rechazo por duplicado |
| Caja sin encintar | 12 | No se puede cerrar la caja |
| Caja de otro número de parte | 14 | No entra a la tarima |
| La cámara no confirma una cara | 15 | Se repite la foto; la tarima no sale hasta tener 4/4 |

También puede **cortar la señal LoRa** de cualquier nodo por unos minutos, subir la **pérdida por ruido** o cambiar **cada cuánto sale una bolsa** para saturar la planta.

## 5. Pestaña Terminal: sea el operador

Aquí usted controla una inyectora. Las demás siguen trabajando solas. Arriba hay dos modos:

- **Recorrido guiado de una OT** (abre por defecto): un botón **Siguiente** lleva una OT de principio a fin. Es el modo para presentar.
- **Modo libre y misiones:** usted escanea a mano y sigue siete misiones. Es el modo para practicar.

Los dos usan la misma terminal y hacen lo mismo que haría el operador. Si cambia de modo a la mitad, la máquina sigue donde iba.

### 5.1 La terminal

A la izquierda está todo lo que se instala junto a la máquina:

- **Torreta:** gris sin OT, ámbar esperando el arranque, verde produciendo, rojo bloqueada.
- **Placa ESP32 LoRa:** es la terminal. Arriba dice qué máquina es y la señal de radio (en dBm). La **pantalla** muestra lo mismo que vería el operador; la última línea dice la señal y cuántos mensajes tiene en memoria. El **LED** parpadea en rojo cuando la placa transmite y en verde cuando le llega una respuesta.
- **Gafete · OT · QR:** se marcan conforme se escanean. Los tres en orden arrancan la máquina (CP 06).
- **QR fijo:** el código pegado en la máquina. Cada máquina tiene el suyo. Se ilumina en verde cuando se escanea.
- **Lector de códigos:** puede escribir un código y presionar Enter, o usar un lector USB real (funciona como teclado). La luz roja del lector se enciende al leer.
- **Báscula:** mueva el deslizador para elegir el peso y presione **Poner bolsa en la báscula**. Después escanee la etiqueta de la bolsa (CP 07).
- **Memoria de la terminal:** cada cuadrito es un mensaje que todavía no recibe confirmación del servidor. Normalmente aparece y desaparece en un segundo. Sin señal, se acumulan.

Botones de arriba:

- **Elegir una máquina libre** (modo guiado): escoge una inyectora sin OT para empezar desde cero.
- **Tomar el control / Regresar a automático:** pausa o reanuda el ciclo automático de la máquina.
- **Pedir OT nueva** (modo libre).
- **Llamar al supervisor:** solo se activa cuando la terminal está bloqueada.
- **Cortar la señal LoRa / Restablecer la señal:** simula que la máquina queda fuera de alcance.

### 5.2 Recorrido guiado de una OT

A la derecha se ven los 9 pasos, la explicación del paso actual y el botón **Siguiente**, que dice exactamente lo que va a hacer (por ejemplo, *Escanear gafete E1142*). El recorrido se fija en el estado real de la máquina: si alguien escanea a mano, sigue desde donde quedó.

Una **OT** (orden de trabajo) es: "haga 12 bolsas de esta pieza en esta máquina".

1. **Tomar la máquina.** Use antes **Elegir una máquina libre** para ver la OT completa desde el principio.
2. **Solicitar la OT.** Planeación la programa (CP 03), el almacén sube la resina (CP 01–02), en la mezanina la vacían en el embudo (CP 04) y el supervisor entrega el **sobre con las etiquetas numeradas** B1 a B12 (CP 05). Los checkpoints se encienden uno por uno y aparece la **ficha de la OT que se generó**: número, máquina, molde, producto, resina, lote, bolsas y peso permitido. Cuando la OT llega por radio a la terminal, presione **Continuar**.
3. **Gafete**, 4. **Carpeta de la OT** y 5. **QR de la máquina.** Al leer el QR, la terminal revisa los tres juntos y, si cuadran, la máquina arranca y la torreta pasa a verde.
6. **Bolsa 1: pesar y etiquetar.** La máquina va soltando piezas en una bolsa. Llena, el operador la pone en la báscula (confirma que trae las piezas correctas), le pega la siguiente etiqueta del sobre y la escanea. Las etiquetas van en orden: no se puede saltar ninguna.
7. **Bolsas 2–4: charola 1.** La **charola** es la bandeja donde se juntan las bolsas junto a la máquina; le caben 4. No es un paso distinto: es repetir el paso 6 hasta juntar 4 bolsas, y el botón lo hace de corrido. Con 4 bolsas, inspección la recoge, revisa una de muestra (CP 08), el supervisor la libera (CP 09) y se lleva a la mesa de empaque SM1 (CP 10). Mientras, la máquina llena la siguiente.
8. **Bolsas 5–12.** Lo mismo: dos charolas más. Con la última bolsa la OT queda completa en la máquina.
9. **Recorre la planta.** Ya no depende de la máquina: las bolsas se meten en cajas (CP 11–12), pasan a pre-envío (CP 13), se arma la tarima (CP 14), la cámara confirma que están todas (CP 15) y se despacha (CP 16). Los checkpoints se encienden solos. **Ver la genealogía completa** abre la pestaña Trazabilidad con esa OT. **Empezar otra OT** reinicia el recorrido.

Las charolas dibujadas debajo de la explicación muestran cuántas bolsas van y cuáles ya salieron a SM1.

### 5.3 Mostrar errores

Debajo del botón Siguiente, **Mostrar un error** ofrece los errores que aplican al paso actual. Cada uno hace mal el paso a propósito y explica, en una tarjeta, qué se hizo mal, qué mostró la terminal y cómo se corrige.

| Error | Cuándo aparece | Qué pasa | Cómo se corrige |
|---|---|---|---|
| Gafete no habilitado | Arranque | La terminal se **bloquea**: torreta roja, no acepta más escaneos | **Llamar al supervisor** (el botón Siguiente cambia a eso). Luego se repite el arranque |
| Carpeta de otra máquina | Arranque | Igual: bloqueo | Igual |
| QR de la máquina vecina | Arranque | Igual: bloqueo | Igual |
| Bolsa fuera de peso | Bolsas | La bolsa se **rechaza**; la máquina sigue y el contador no avanza | Siguiente: se vuelve a pesar y se usa la misma etiqueta |
| Saltarse una etiqueta | Bolsas | Rechazo: "salto en la secuencia" | Siguiente: se escanea la etiqueta que tocaba |
| Etiqueta de otra OT | Bolsas | Rechazo: la etiqueta es de otro sobre | Siguiente: se usa la etiqueta de esta OT |
| Cortar la señal LoRa | Arranque y bolsas | La terminal sigue validando; los mensajes se guardan en su memoria | **Devolver la señal LoRa**: reenvía todo en orden, sin perder nada |

Diferencia importante para explicar: un **error de arranque bloquea** la máquina (no debe producir con el operador, la OT o la máquina equivocados); un **error de bolsa solo rechaza esa bolsa** y la producción sigue. En los dos casos el rechazo queda guardado en el MES.

### 5.4 Modo libre: etiquetas y misiones

**Etiquetas a la mano:** haga clic en una para escanearla. Las marcadas en rojo son incorrectas a propósito: un gafete no habilitado, una OT de otra máquina, una etiqueta que se salta una.

**Misiones:** se muestra una misión a la vez. Se marca sola cuando la terminal registra lo que pide: aparece "¡Lograda!" con lo que aprendió y, a los 5 segundos, pasa a la siguiente. Los puntos de arriba muestran el avance (verde = completada); con ellos o con las flechas puede ver cualquier misión. **Ir a la misión pendiente** lo regresa a la que sigue. Son siete:

1. **Arranque la máquina:** gafete, OT y QR.
2. **Registre una bolsa:** pesar y escanear.
3. **Bolsa fuera de peso:** ver el rechazo y corregir.
4. **Etiqueta fuera de orden:** el correlativo no se puede saltar.
5. **Trabaje sin señal:** la línea sigue y los mensajes llegan después, marcados como atrasados.
6. **Error de arranque y supervisor:** bloqueo y desbloqueo remoto por radio.
7. **Complete una charola:** 4 bolsas que siguen solas hasta SM1.

El avance se guarda en el navegador. **Reiniciar misiones** las borra.

### 5.5 Viaje del mensaje

Cada vez que escanea algo, un cuadrito recorre el camino real del mensaje:

**Terminal → Aire LoRa → Gateway → Puente → Broker MQTT → MES**, y de regreso un círculo verde (el ACK, la confirmación).

Cada parada muestra el dato real (tamaño de la trama, tiempo en el aire, señal, tópico MQTT) y abajo se explica en palabras simples qué está pasando. Si la trama choca con otra o se pierde, verá el cuadrito rojo y el reintento.

Con **Cámara lenta** apagada, el recorrido va a la velocidad de la animación más rápida. Debajo están **los bytes** que viajaron por radio, separados por color: cabecera, datos fijos, datos variables y firma.

### 5.6 Escaneos de esta sesión

Lista de todo lo que escaneó, con el estado de cada mensaje que se actualiza solo: *en memoria*, *viajando por radio*, *reintentando*, *publicado en MQTT*, *guardado en el MES*, *confirmado* o *entregado con retraso*.

## 6. Pestaña Radio y MQTT

Para quien quiera ver "las tripas":

- **Traducción de una trama:** una trama real en bytes y el JSON en que se convirtió. Marque *Detener* para estudiarla con calma.
- **Aire LoRa:** cada transmisión con su resultado (recibida, colisión, perdida, sin señal), tamaño y tiempo en el aire.
- **Broker MQTT:** todos los mensajes publicados. Filtre por `evento`, `cmd`, `alerta` o `erp`. Con un cliente MQTT (por ejemplo MQTT Explorer) puede conectarse a `localhost:1883` y ver lo mismo.

## 7. Pestaña Trazabilidad

Escriba cualquier código y presione **Rastrear**:

| Busca | Ejemplo | Muestra |
|---|---|---|
| OT | `OT-2611-001` | Resina usada, bolsas, cajas y tarimas |
| Bolsa | `OT-2611-001-B004` | Peso, operador, caja en que quedó y tarima |
| Caja | `CJ-000003` | Las bolsas que contiene y de qué OT y lote vienen |
| Tarima | `TR-0001` | Cajas, orden de embarque y despacho |
| Lote de resina | `LMP-2611-001` | Todas las OT que lo usaron (para un retiro de producto) |

Abajo aparecen todos los eventos de ese código en orden, con su CP, resultado y estación. Las OT recientes se pueden abrir con un clic.

## 8. Preguntas frecuentes

**No veo nada en la página.** El servidor no está encendido. Ejecute `npm start` y recargue.

**No encuentro cómo tomar el control.** En la pestaña *Terminal*, en el modo **Recorrido guiado**, el botón **Siguiente** lo hace por usted; en el modo libre está arriba a la izquierda. Si no aparece, recargue con `Ctrl + F5`.

**El botón Siguiente está apagado y dice "Esperando…".** La OT se está preparando (resina, mezanina, sobre). Se activa solo en unos segundos.

**"Pedir OT nueva" está apagado.** La máquina ya tiene una OT en curso o en preparación. Lea el texto de ayuda debajo de los botones.

**La terminal está en rojo y no acepta escaneos.** Está bloqueada por un error de arranque. Presione *Llamar al supervisor* (en el modo guiado, el botón Siguiente hace lo mismo).

**El escaneo dice correcto pero el mensaje sigue "en memoria".** La terminal ya validó; solo falta que la radio lo entregue. Si la señal está cortada, restablézcala.

**¿Por qué algunos mensajes dicen "entregado con retraso"?** Se generaron sin señal y llegaron después. El sistema guarda la hora real del escaneo, no la de llegada.

**¿Se pierden datos si se apaga el simulador?** La base de datos se guarda en `simulador/datos/`, pero cada inicio arranca una planta nueva.

## 9. Glosario

| Término | Significado |
|---|---|
| OT | Orden de trabajo |
| TEP | Trabajo en proceso |
| CP | Checkpoint: punto donde se escanea y se valida |
| Gate | Regla que decide si un paso es correcto (PASS) o no (FAIL) |
| LoRa | Radio de largo alcance y bajo consumo; no necesita cables ni WiFi |
| Gateway | Radio conectada al servidor que recibe a todas las terminales |
| MQTT | Sistema de mensajes que reparte cada evento a quien lo necesite |
| MES | Sistema de ejecución de manufactura: guarda todo y aplica las reglas |
| ACK | Confirmación de que un mensaje llegó |
| Búfer / memoria | Mensajes guardados en la terminal esperando confirmación |
| Andon | Torreta de luces que indica el estado de la estación |
| SM1 | Estación de empaque donde las bolsas se meten en cajas |
| Genealogía | Cadena completa: resina → OT → bolsa → caja → tarima → embarque |
