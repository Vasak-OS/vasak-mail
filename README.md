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
mensajes de la casilla de entrada, abre uno y muestra su texto, y lo marca como
leído en el servidor cuando la persona lo pide.

**Todavía no hace:**

- **Escribir ni responder.** Mandar correo pasa por SMTP y por una cola que
  sobreviva a que se apague el equipo con algo sin mandar; es su propio trabajo.
- **Abrir adjuntos.** Se dice que el mensaje trae uno —quien lee un mensaje y no
  se entera de que traía un archivo, pierde el archivo— pero no se puede abrir.
- **Otras carpetas.** Sólo la casilla de entrada.
- **Buscar.**

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
