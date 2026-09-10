# vasak-mail

El correo de VasakOS. Muestra los mensajes de las cuentas conectadas —las que se
agregan desde Configuración— y deja leerlos.

Tauri 2 + Vue 3 + TypeScript + Tailwind 4, sobre la plantilla
[`vapp`](https://github.com/Vasak-OS/vapp).

---

## Esta aplicación no habla IMAP, y ése es el punto

No es una etapa pendiente: es lo que hace que sea segura de tener abierta.

El correo lo lee `vasak-accounts-sync`, un servicio del usuario que ya mantiene
una conexión abierta con el servidor esperando avisos. Esta ventana le pide la
lista y el texto por el bus de sesión. Con eso:

- **Nunca toca una credencial.** No pide `account.email`, no ve una contraseña y
  no manda un `LOGIN`. Un `vasak-mail` reemplazado no llega a la casilla de
  nadie: no tiene con qué.
- **No puede ni pedirla.** `vasak-permissions` declara el alcance de
  `/usr/bin/vasak-mail` como **vacío**, así que un pedido de `account.email` se
  niega sin que a la persona le aparezca ningún diálogo. Sin eso, la separación
  sería una convención del código.
- **No abre una segunda conexión** contra el servidor de la persona. Hay
  servidores que las cuentan y cortan.
- **El parser de MIME vive del otro lado**, en un proceso que no dibuja nada. Es
  la parte que muerde lo que escribió un desconocido.

Es la aplicación más expuesta del escritorio —lo que muestra lo escribió
cualquiera que sepa la dirección de la persona— y es la que menos tiene para
perder.

---

## Qué hace hoy, y qué no

**Hace:** lista las cuentas con su contador de sin leer, muestra los últimos 200
mensajes de la casilla de entrada, abre uno y muestra su texto, lo marca como
leído en el servidor cuando la persona lo pide, y **escribe y responde**.

**Todavía no hace:**

- **Adjuntar archivos**, ni abrir los que llegan. Se dice que el mensaje trae uno
  —quien lee un mensaje y no se entera de que traía un archivo, pierde el
  archivo— pero no se puede abrir.
- **Guardar copia en «Enviados».**
- **Otras carpetas.** Sólo la casilla de entrada.
- **Buscar.**

### Escribir

«Enviar» **no espera al servidor**: el mensaje queda guardado en el disco del
servicio y sale en cuanto se pueda. Se dice en la ventana, porque cambia lo que
la persona espera del botón — y es lo que hace que cerrar la ventana enseguida no
pierda nada. Lo que sí vuelve en el acto es el rechazo de un borrador que no se
puede armar, y ahí **la ventana no se cierra**: lo escrito sigue en pantalla con
el error a la vista.

**Lo que no salió se muestra al costado**, no escondido en una carpeta que hay
que ir a mirar. Un mensaje que la persona cree mandado y quedó trabado es de las
peores cosas que puede hacer un cliente de correo: la conversación del otro lado
nunca llega y nadie se entera hasta que es tarde. El motivo va con el mensaje —«no
se pudo enviar» a secas no dice si la dirección estaba mal escrita o si el
servidor estaba caído, que tienen arreglos distintos.

**El remitente no lo elige esta ventana.** El borrador viaja sin `De` y lo pone
el servicio con la dirección de la cuenta: mandar desde otra hace que el servidor
rechace, o peor, que el mensaje llegue y lo marquen como falsificado.

### Responder

La respuesta va al `Reply-To` si el mensaje lo trae, y al remitente si no. La
diferencia importa: las listas de correo y los sistemas de tickets ponen
`Reply-To` justamente para que la respuesta no le llegue sólo a quien apretó
mandar.

El asunto lleva un solo «Re:» —responder cinco veces en una conversación no puede
dejar «Re: Re: Re: Re: Re:»—, el original se cita con `>` y se recorta a cien
líneas, y el cursor arranca **arriba** de la cita, que es donde se escribe.

---

## Cómo se muestra un mensaje

Como **texto**, con `white-space: pre-wrap`, y nunca como HTML.

Un motor de HTML acá traería imágenes remotas —que le confirman al remitente que
se leyó, y desde qué dirección IP—, CSS que puede tapar cosas, y una superficie
enorme por nada. El sincronizador ya le saca las etiquetas a los mensajes que
sólo vienen en HTML; lo que llega es texto, y Vue escapa el contenido de una
interpolación, así que tampoco puede volver a convertirse en marcado.

**El nombre y la dirección del remitente se muestran los dos.** Un remitente que
se pone de nombre «soporte@banco.com» y escribe desde otra dirección es el fraude
más común que hay, y mostrar sólo el nombre es exactamente lo que lo hace
funcionar.

**Abrir un mensaje no lo marca como leído.** El sincronizador trae todo con
`BODY.PEEK`, que mira sin marcar, justamente para que sea una decisión: que pasar
por encima de un mensaje con las flechas te vacíe el contador de sin leer es de
los errores más molestos que puede tener un cliente de correo. Hay un botón.

---

## Cómo está armado

| archivo | qué resuelve |
|---|---|
| `src-tauri/src/correo.rs` | Habla con `vasak-accounts-sync` por el bus de sesión, y traduce sus señales a un evento de la ventana. |
| `src-tauri/src/comandos.rs` | Lo que la ventana puede pedir. Una capa fina: el trabajo lo hace el servicio. |
| `src/composables/use-correo.ts` | Qué cuenta se mira, qué mensaje está abierto, y qué se está cargando. |
| `src/tools/fecha.ts` | La hora si llegó hoy, el día si no. |

El correo nuevo aparece solo: el servicio manda una señal cuando cambia algo y la
ventana relee. Sin eso habría que apretar «Actualizar» para enterarse de algo que
el servicio ya sabe, o sondear cada tantos segundos — gastar batería para
enterarse más tarde.

---

## Desarrollo

```bash
bun install
bun test                                          # el frontend
cargo test --manifest-path src-tauri/Cargo.toml   # el backend
bun run lint
bunx --bun tauri dev
```

Para probar la ventana de verdad hace falta `--features custom-protocol`, o el
webview abre vacío:

```bash
bunx --bun tauri build --debug --features custom-protocol
```

Y hace falta `vasak-accounts-sync` corriendo con al menos una cuenta de correo
conectada. Sin eso la aplicación abre igual y lo dice: la lista de cuentas sale
vacía con la explicación de dónde conectar una.
