# 06 · Manual de usuario del simulador

> **Última actualización:** 2026-11-21
> **Para:** supervisores, calidad, operadores y cualquier persona que quiera entender el sistema antes de instalarlo en planta.
> **No necesita** saber programar. Para el detalle técnico vea [05_DOCUMENTACION_TECNICA.md](05_DOCUMENTACION_TECNICA.md).

## 1. ¿Qué es esto?

Es una planta de inyección "de mentira" que funciona igual que funcionará la real: 51 inyectoras en tres líneas (L1: 22, L2: 20, L3: 9) que comparten el almacén de materia prima, la mezanina, cuatro mesas de SM1, dos puestos de producto terminado y la cámara de embarque. Cada estación tiene una terminal con lector de códigos que manda sus escaneos por radio (LoRa) a un servidor.

Sirve para:

- Ver cómo se registra cada paso (CP 01 a CP 16) y qué pasa cuando algo sale mal.
- Ser operador: escanear etiquetas en una inyectora y ver el viaje de cada mensaje.
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

**Líneas.** Junto al título "Inyectoras" están los botones **Toda la planta**, **Línea 1 · 22**, **Línea 2 · 20** y **Línea 3 · 9**. El panel recuerda cuál eligió.

- **Toda la planta:** una fila por línea con una luz por máquina, del color de su torreta (con rayas si está sin señal), y cuántas están produciendo, esperando, en falla o sin OT. Pase el mouse sobre una luz para ver la máquina, su OT y lo que dice su pantalla. Si hace clic en ella, sigue su OT; con **Ver tarjetas** entra a la línea.
- **Una línea:** las tarjetas completas solo de esa línea.

Si sigue una OT mientras ve una línea, el panel salta a la línea de esa OT. Las estaciones de la derecha siempre se ven, porque las comparten las tres líneas. En los menús de fallas, señal y Terminal, las máquinas vienen agrupadas por línea.

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

Aquí usted controla una inyectora. Las demás siguen trabajando solas.

### 5.1 Empezar

1. Elija la inyectora y presione **Tomar el control**. Su ciclo automático se pausa.
2. Si no tiene OT, presione **Pedir OT nueva**. Planeación la crea, el almacén sube la resina, la mezanina la carga y la OT se libera. Espere a que la pantalla diga *Escanee gafete, OT y QR*. Si el botón está apagado es porque ya viene una OT en camino.
3. Escanee haciendo clic en las **etiquetas a la mano**, escribiendo el código en el **lector** y presionando Enter, o con un lector USB real (funciona como teclado).
4. Para terminar, presione **Regresar a automático**.

### 5.2 La terminal

- **Pantalla y torreta:** lo mismo que vería el operador en la máquina.
- **Gafete · OT · QR:** se marcan conforme los escanea. Los tres en orden arrancan la máquina (CP 06).
- **Báscula:** mueva el deslizador para elegir el peso y presione **Poner bolsa en la báscula**. Dice si el peso está dentro de tolerancia. Después escanee la etiqueta de la bolsa (CP 07).
- **Memoria de la terminal:** cada cuadrito es un mensaje que todavía no recibe confirmación del servidor. Normalmente aparece y desaparece en un segundo. Sin señal, se acumulan (en rojo).
- **Cortar la señal LoRa / Restablecer la señal:** simula que la máquina queda fuera de alcance.
- **Llamar al supervisor:** solo se activa cuando la terminal está bloqueada.

### 5.3 Las etiquetas

Las que están marcadas en rojo son incorrectas a propósito: un gafete no habilitado, una OT de otra máquina, una etiqueta que se salta una. Úselas para ver cómo responde el sistema.

### 5.4 Misiones

A la derecha de la terminal se muestra una misión a la vez, con las etiquetas a la mano justo debajo. La misión se marca sola cuando la terminal registra lo que pide: aparece "¡Lograda!" con lo que aprendió y, a los 5 segundos, pasa sola a la siguiente. Los puntos de arriba muestran el avance (verde = completada); con ellos o con las flechas puede ver cualquier misión. **Ir a la misión pendiente** lo regresa a la que sigue. Son siete:

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

**No encuentro cómo tomar el control.** Está en la pestaña *Terminal*, arriba a la izquierda. Si no aparece, recargue con `Ctrl + F5`.

**"Pedir OT nueva" está apagado.** La máquina ya tiene una OT en curso o en preparación. Lea el texto de ayuda debajo de los botones.

**La terminal está en rojo y no acepta escaneos.** Está bloqueada por un error de arranque. Presione *Llamar al supervisor*.

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
