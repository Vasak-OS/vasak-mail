import { invoke } from '@tauri-apps/api/core';
import { computed, ref } from 'vue';
import { claveDe, combinados, esElMismo, TODAS } from '@/tools/bandeja';

/**
 * La carpeta de entrada, que es la única que tienen todas las cuentas con el
 * mismo nombre.
 *
 * Es lo que se muestra en la bandeja combinada: las demás carpetas son de cada
 * cuenta, y «Enviados» de una no es «Enviados» de la otra — puede ni existir.
 */
const ENTRADA = 'INBOX';

/** Una cuenta con correo. */
export interface Cuenta {
	account_id: string;
	display_name: string;
	sin_leer: number;
	/** Vacío si la cuenta anda. Si no, qué pasó. */
	error: string;
}

/** Una carpeta del servidor. */
export interface Casilla {
	/** El nombre que se le manda al servidor. */
	ruta: string;
	/** El nombre que se muestra, ya decodificado. */
	nombre: string;
	/** `entrada`, `enviados`, `papelera`, `spam`, `borradores`, `archivo`,
	 *  `todo` o `ninguno`. Lo calcula el sincronizador, que es quien habla IMAP. */
	uso: string;
	/** Si se puede abrir. Las que no, existen sólo como rama de la jerarquía. */
	seleccionable: boolean;
}

/**
 * Un mensaje en la lista, sin su cuerpo.
 *
 * `account_id` y `casilla` **no vienen del servicio**: se los pone esta ventana
 * al traerlos, porque es la que sabe a quién se los pidió. Van pegados a cada
 * mensaje y no leídos de la cuenta elegida en el momento de usarlos, que es lo
 * que hace que abrir, marcar y responder no puedan equivocarse de cuenta cuando
 * la lista es la combinada — o cuando alguien cambia de carpeta mientras un
 * pedido viaja. Ver `tools/bandeja.ts`.
 */
export interface Resumen {
	account_id: string;
	casilla: string;
	uid: number;
	/** Cómo se firma quien lo mandó. */
	de: string;
	/** Su dirección de verdad. Se muestra **junto al nombre**, no en su lugar. */
	direccion: string;
	asunto: string;
	/** ISO 8601, o vacío si la fecha del mensaje no se entendió. */
	fecha: string;
	sin_leer: boolean;
	con_adjuntos: boolean;
}

/** Un mensaje abierto. */
export interface Abierto {
	texto: string;
	recortado: boolean;
	adjuntos: boolean;
	/** El identificador del original, para enganchar la respuesta al hilo. */
	message_id: string;
	referencias: string[];
	/** A dónde va la respuesta: el `Reply-To` si lo hay, el remitente si no. */
	responder_a: string;
	nombre: string;
}

/** Lo que se escribe. **Sin el remitente**: lo pone el servicio. */
export interface Borrador {
	para: string[];
	cc: string[];
	asunto: string;
	cuerpo: string;
	en_respuesta_a: string;
	referencias: string[];
}

/** Un mensaje esperando salir. */
export interface Saliente {
	id: string;
	account_id: string;
	borrador: Borrador;
	intentos: number;
	/** `pendiente` o `trabado`. */
	estado: string;
	ultimo_error: string;
}

/**
 * El correo que hay y el que se está leyendo.
 *
 * ── Nada de esto habla IMAP ─────────────────────────────────────────────────
 *
 * Todo sale de `vasak-accounts-sync`, que ya tiene la conexión abierta. Esta
 * ventana no ve una contraseña ni abre una conexión propia; ver `correo.rs`.
 */
export function useCorreo() {
	const cuentas = ref<Cuenta[]>([]);
	/**
	 * Qué se está mirando: una cuenta, o [`TODAS`] si es la bandeja combinada.
	 *
	 * Vacío quiere decir otra cosa —que no hay ninguna cuenta conectada— y por eso
	 * «todas» tiene su propio valor y no reusa el vacío.
	 */
	const elegida = ref('');
	const casillas = ref<Casilla[]>([]);
	/**
	 * La carpeta abierta, como ruta.
	 *
	 * Arranca en `INBOX` y no vacía: es la que el sincronizador mantiene al día
	 * con IDLE, o sea la única que aparece al instante. Las demás se traen del
	 * servidor cuando alguien las abre.
	 */
	const casilla = ref(ENTRADA);

	/** Si lo que se está mirando es la bandeja combinada. */
	const combinada = computed(() => elegida.value === TODAS);

	/**
	 * Cuánto correo sin leer hay en total.
	 *
	 * Se suma acá y no lo manda el servicio: la cuenta que falló trae cero, y
	 * sumarlo igual es correcto — no es que no tenga correo, es que no se sabe, y
	 * eso ya lo dice su propio aviso de error.
	 */
	const sinLeerEnTotal = computed(() => cuentas.value.reduce((total, c) => total + c.sin_leer, 0));
	const mensajes = ref<Resumen[]>([]);
	const abierto = ref<Resumen | null>(null);
	const cuerpo = ref<Abierto | null>(null);

	const salientes = ref<Saliente[]>([]);
	const enviando = ref(false);
	const cargandoLista = ref(false);
	const cargandoMensaje = ref(false);
	/** Lo que impidió leer algo, en el idioma de lo que la persona puede hacer. */
	const error = ref('');

	/**
	 * Cuál es la carga vigente, para la lista y para el mensaje por separado.
	 *
	 * Sin esto, hacer clic en tres mensajes seguidos deja tres pedidos en el aire
	 * y gana el que conteste último: el panel termina mostrando el cuerpo de un
	 * mensaje con el encabezado de otro, que es la peor forma posible de
	 * equivocarse en un cliente de correo.
	 */
	let listaVigente = 0;
	let mensajeVigente = 0;
	/** Los «marcar como leído» que todavía están viajando. */
	const marcando = new Set<string>();

	/**
	 * Lo que está esperando salir.
	 *
	 * Aparte de las cuentas y sin tirar la lista si falla: la cola es del
	 * servicio y no de una cuenta, y no poder leerla no puede impedir leer el
	 * correo que sí llegó.
	 */
	async function cargarSalida() {
		try {
			salientes.value = await invoke<Saliente[]>('listar_salientes');
		} catch (e) {
			console.error('no se pudo leer la cola de salida', e);
		}
	}

	async function cargarCuentas() {
		await cargarSalida();
		try {
			const nuevas = await invoke<Cuenta[]>('listar_cuentas');
			cuentas.value = nuevas;
			error.value = '';

			// Qué mostrar si lo que estaba elegido ya no vale.
			//
			// **Con más de una cuenta, la combinada**: es lo que la gente espera
			// de un cliente de correo con varias casillas, y elegir una por ella
			// esconde el correo de las otras sin decirlo. Con una sola, esa
			// cuenta, porque «todas» de una sola es lo mismo con un clic de más.
			const sigueValiendo =
				(elegida.value === TODAS && nuevas.length > 1) ||
				nuevas.some((c) => c.account_id === elegida.value);

			if (!sigueValiendo) {
				if (nuevas.length > 1) {
					await elegir(TODAS);
				} else if (nuevas.length === 1) {
					await elegir(nuevas[0].account_id);
				} else {
					elegida.value = '';
					mensajes.value = [];
					casillas.value = [];
					cerrar();
				}
			} else {
				await cargarMensajes();
			}
		} catch (e) {
			// Que no esté el sincronizador no es un fallo de esta ventana:
			// simplemente no hay correo que mostrar todavía.
			cuentas.value = [];
			mensajes.value = [];
			cerrar();
			error.value = String(e);
		}
	}

	/**
	 * Los mensajes de una cuenta y una carpeta, con de dónde salieron pegados.
	 *
	 * El sello va acá, en el único lugar que sabe a quién se los pidió. De ahí en
	 * adelante nada vuelve a mirar la cuenta elegida para saber de quién es un
	 * mensaje.
	 */
	async function traerDe(accountId: string, ruta: string): Promise<Resumen[]> {
		const lista = await invoke<Resumen[]>('listar_mensajes', {
			accountId,
			casilla: ruta,
		});
		return lista.map((m) => ({ ...m, account_id: accountId, casilla: ruta }));
	}

	async function cargarMensajes() {
		if (!elegida.value) {
			mensajes.value = [];
			return;
		}

		const mio = ++listaVigente;
		cargandoLista.value = true;
		const fallos: string[] = [];

		try {
			let lista: Resumen[];

			if (combinada.value) {
				// **Una cuenta que falla no puede vaciar la bandeja de las otras.**
				// Se trae lo que se pueda y se dice lo que no, con el nombre de la
				// cuenta adelante: «no se pudo leer» no le dice a nadie cuál de sus
				// dos casillas está rota.
				//
				// Siempre la de entrada: las carpetas son de cada cuenta y
				// «Enviados» de una no es «Enviados» de la otra.
				const listas = await Promise.all(
					cuentas.value.map(async (c) => {
						try {
							return await traerDe(c.account_id, ENTRADA);
						} catch (e) {
							fallos.push(`${c.display_name}: ${e}`);
							return [];
						}
					})
				);
				lista = combinados(listas);
			} else {
				lista = await traerDe(elegida.value, casilla.value);
			}

			if (mio !== listaVigente) {
				return;
			}
			mensajes.value = lista;
			error.value = fallos.join(' · ');

			// Si el que estaba abierto ya no está, se cierra el panel: dejarlo
			// mostraría un mensaje que se borró desde otro dispositivo como si
			// siguiera ahí.
			//
			// **Por la clave entera y no por el `uid`**: en la combinada, el 7 de
			// una cuenta no es el 7 de la otra, y comparar números dejaba abierto
			// un mensaje que ya no estaba porque otra cuenta tenía uno con el
			// mismo número.
			if (abierto.value && !lista.some((m) => esElMismo(m, abierto.value))) {
				cerrar();
			}
		} catch (e) {
			if (mio === listaVigente) {
				error.value = String(e);
			}
		} finally {
			if (mio === listaVigente) {
				cargandoLista.value = false;
			}
		}
	}

	/**
	 * Las carpetas de la cuenta elegida.
	 *
	 * Si falla, la lista queda vacía y el resto sigue andando: sin carpetas se
	 * ve la de entrada, que es lo que se veía antes de que existieran. Un
	 * servidor que no contesta el `LIST` no puede dejar a nadie sin su correo.
	 */
	async function cargarCasillas() {
		// En la combinada no se listan: las carpetas son de cada cuenta y una
		// lista mezclada no se podría abrir.
		if (!elegida.value || combinada.value) {
			casillas.value = [];
			return;
		}
		try {
			casillas.value = await invoke<Casilla[]>('listar_casillas', {
				accountId: elegida.value,
			});
		} catch (e) {
			casillas.value = [];
			console.error('no se pudieron leer las carpetas', e);
		}
	}

	/** Muestra una cuenta, o [`TODAS`] para la bandeja combinada. */
	async function elegir(accountId: string) {
		elegida.value = accountId;
		// Volver a la de entrada al cambiar de cuenta. La carpeta que estaba
		// abierta es de la cuenta anterior: «Enviados» de una no es «Enviados»
		// de la otra, y puede no existir.
		casilla.value = ENTRADA;
		cerrar();
		casillas.value = [];
		await cargarMensajes();
		await cargarCasillas();
	}

	/** Abre una carpeta de la cuenta que ya está elegida. */
	async function elegirCasilla(ruta: string) {
		// En la combinada no hay carpetas que elegir: son de cada cuenta.
		if (combinada.value || casilla.value === ruta) {
			return;
		}
		casilla.value = ruta;
		cerrar();
		await cargarMensajes();
	}

	async function abrir(resumen: Resumen) {
		const mio = ++mensajeVigente;
		abierto.value = resumen;
		cuerpo.value = null;
		cargandoMensaje.value = true;
		error.value = '';

		try {
			// **De dónde salió el mensaje, no de lo que está elegido ahora.** En
			// la combinada eso serían dos cosas distintas, y el panel mostraría el
			// cuerpo de un mensaje con el encabezado de otro.
			const traido = await invoke<Abierto>('abrir_mensaje', {
				accountId: resumen.account_id,
				casilla: resumen.casilla,
				uid: resumen.uid,
			});
			if (mio !== mensajeVigente) {
				return;
			}
			cuerpo.value = traido;
		} catch (e) {
			if (mio === mensajeVigente) {
				error.value = String(e);
			}
		} finally {
			if (mio === mensajeVigente) {
				cargandoMensaje.value = false;
			}
		}
	}

	function cerrar() {
		mensajeVigente++;
		abierto.value = null;
		cuerpo.value = null;
		cargandoMensaje.value = false;
	}

	/**
	 * Marca como leído, sólo cuando la persona lo pide.
	 *
	 * **No al abrir el mensaje.** El sincronizador trae todo con `BODY.PEEK`, que
	 * mira sin marcar, justamente para que esto sea una decisión: que pasar por
	 * encima de un mensaje con las flechas te vacíe el contador de sin leer es de
	 * los errores más molestos que puede tener un cliente de correo.
	 */
	async function marcarLeido(mensaje: Resumen) {
		// **Todo sale del mensaje y nada de lo que está elegido ahora.** Entre el
		// pedido y su respuesta la persona puede cambiar de cuenta o de carpeta,
		// y leerlo del otro lado del `await` marcaba como leído el mensaje 7 de
		// la que quedó a la vista en vez del de la que se le pidió — y le restaba
		// uno a su contador. En la bandeja combinada eso deja de ser hipotético:
		// los dos «7» están en la misma lista.
		const clave = claveDe(mensaje);

		// Uno por vez y por mensaje. El botón sigue activo mientras el comando
		// viaja, así que dos clics rápidos mandan lo mismo dos veces; el servidor
		// lo aguanta —marcar dos veces lo leído no hace nada— pero acá se restaba
		// uno al contador cada vez, y la cuenta quedaba diciendo menos correo sin
		// leer del que tiene.
		if (marcando.has(clave)) {
			return;
		}
		marcando.add(clave);

		try {
			await invoke('marcar_leido', {
				accountId: mensaje.account_id,
				casilla: mensaje.casilla,
				uid: mensaje.uid,
			});

			// El contador de **esa** cuenta, esté a la vista o no: el mensaje se
			// leyó igual.
			const cuenta = cuentas.value.find((c) => c.account_id === mensaje.account_id);
			if (cuenta && cuenta.sin_leer > 0) {
				cuenta.sin_leer -= 1;
			}

			// Lo que se ve, en cambio, se busca por la clave entera: en la
			// combinada hay varios mensajes con el mismo `uid`, y marcar por
			// número ponía en negrita normal al de otra cuenta.
			const enLaLista = mensajes.value.find((m) => esElMismo(m, mensaje));
			if (enLaLista) {
				enLaLista.sin_leer = false;
			}
			if (esElMismo(abierto.value, mensaje) && abierto.value) {
				abierto.value = { ...abierto.value, sin_leer: false };
			}
		} catch (e) {
			error.value = String(e);
		} finally {
			marcando.delete(clave);
		}
	}

	/**
	 * Pone el mensaje en la cola.
	 *
	 * Vuelve `true` si quedó guardado. El envío pasa después: lo que este
	 * `await` espera es que el mensaje esté a salvo en el disco del servicio, no
	 * que el servidor lo haya aceptado. Por eso la ventana se puede cerrar
	 * enseguida sin perder nada.
	 */
	async function enviar(accountId: string, borrador: Borrador): Promise<boolean> {
		// **La cuenta viene por argumento y no de `elegida`.** Entre abrir la
		// ventana de redacción y apretar «Enviar» se puede cambiar de casilla, y
		// leer la elegida acá mandaría desde la otra: el mensaje sale con una
		// dirección que no es la que se estaba mirando al escribirlo, y una
		// respuesta se va con la identidad equivocada.
		if (!cuentas.value.some((c) => c.account_id === accountId)) {
			error.value = String(new Error('la cuenta desde la que escribiste ya no está'));
			return false;
		}

		enviando.value = true;
		error.value = '';
		try {
			await invoke<string>('enviar_mensaje', { accountId, borrador });
			await cargarSalida();
			return true;
		} catch (e) {
			// Un borrador que no se puede armar —una dirección mal escrita—
			// vuelve en el acto, que es cuando la persona todavía lo tiene en
			// pantalla. Se muestra y **la ventana no se cierra**.
			error.value = String(e);
			return false;
		} finally {
			enviando.value = false;
		}
	}

	/** Saca un mensaje de la cola. Se pierde lo escrito. */
	async function descartarSaliente(id: string) {
		try {
			await invoke('descartar_saliente', { id });
			await cargarSalida();
		} catch (e) {
			error.value = String(e);
		}
	}

	return {
		cuentas,
		combinada,
		sinLeerEnTotal,
		salientes,
		enviando,
		enviar,
		descartarSaliente,
		cargarSalida,
		elegida,
		casillas,
		casilla,
		mensajes,
		abierto,
		cuerpo,
		cargandoLista,
		cargandoMensaje,
		error,
		cargarCuentas,
		cargarMensajes,
		elegir,
		elegirCasilla,
		abrir,
		cerrar,
		marcarLeido,
	};
}
