import { invoke } from '@tauri-apps/api/core';
import { ref } from 'vue';

/** Una cuenta con correo. */
export interface Cuenta {
	account_id: string;
	display_name: string;
	sin_leer: number;
	/** Vacío si la cuenta anda. Si no, qué pasó. */
	error: string;
}

/** Un mensaje en la lista, sin su cuerpo. */
export interface Resumen {
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
	const elegida = ref('');
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

			// Si no hay ninguna elegida, o la que estaba ya no está, se toma la
			// primera: abrir en una lista vacía cuando hay correo es peor que
			// elegir por la persona.
			if (!nuevas.some((c) => c.account_id === elegida.value)) {
				const primera = nuevas[0]?.account_id ?? '';
				if (primera) {
					await elegir(primera);
				} else {
					elegida.value = '';
					mensajes.value = [];
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

	async function cargarMensajes() {
		if (!elegida.value) {
			mensajes.value = [];
			return;
		}

		const mio = ++listaVigente;
		cargandoLista.value = true;
		try {
			const lista = await invoke<Resumen[]>('listar_mensajes', {
				accountId: elegida.value,
			});
			if (mio !== listaVigente) {
				return;
			}
			mensajes.value = lista;

			// Si el que estaba abierto ya no está en la casilla, se cierra el
			// panel: dejarlo mostraría un mensaje que se borró desde otro
			// dispositivo como si siguiera ahí.
			if (abierto.value && !lista.some((m) => m.uid === abierto.value?.uid)) {
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

	async function elegir(accountId: string) {
		elegida.value = accountId;
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
			const traido = await invoke<Abierto>('abrir_mensaje', {
				accountId: elegida.value,
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
	async function marcarLeido(uid: number) {
		// **La cuenta se captura acá y no se vuelve a leer.** Entre el pedido y
		// su respuesta la persona puede haber cambiado de casilla, y usar
		// `elegida.value` del otro lado del `await` marcaba como leído el
		// mensaje 7 de la cuenta que quedó a la vista en vez del de la cuenta a
		// la que se le pidió — y le restaba uno a su contador.
		const cuentaId = elegida.value;

		// Uno por vez y por mensaje. El botón sigue activo mientras el comando
		// viaja, así que dos clics rápidos mandan el mismo `uid` dos veces; el
		// servidor lo aguanta —marcar dos veces lo leído no hace nada— pero acá
		// se restaba uno al contador cada vez, y la cuenta quedaba diciendo
		// menos correo sin leer del que tiene.
		const enCurso = `${cuentaId}:${uid}`;
		if (marcando.has(enCurso)) {
			return;
		}
		marcando.add(enCurso);

		try {
			await invoke('marcar_leido', { accountId: cuentaId, uid });

			// El contador de **esa** cuenta, esté a la vista o no: el mensaje se
			// leyó igual.
			const cuenta = cuentas.value.find((c) => c.account_id === cuentaId);
			if (cuenta && cuenta.sin_leer > 0) {
				cuenta.sin_leer -= 1;
			}

			// Lo que se ve, en cambio, sólo si sigue siendo lo que se ve. La
			// lista de mensajes es la de la casilla abierta ahora.
			if (elegida.value !== cuentaId) {
				return;
			}
			const mensaje = mensajes.value.find((m) => m.uid === uid);
			if (mensaje) {
				mensaje.sin_leer = false;
			}
			if (abierto.value?.uid === uid) {
				abierto.value = { ...abierto.value, sin_leer: false };
			}
		} catch (e) {
			error.value = String(e);
		} finally {
			marcando.delete(enCurso);
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
		salientes,
		enviando,
		enviar,
		descartarSaliente,
		cargarSalida,
		elegida,
		mensajes,
		abierto,
		cuerpo,
		cargandoLista,
		cargandoMensaje,
		error,
		cargarCuentas,
		cargarMensajes,
		elegir,
		abrir,
		cerrar,
		marcarLeido,
	};
}
