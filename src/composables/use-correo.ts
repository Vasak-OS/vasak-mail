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

	async function cargarCuentas() {
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
		// Uno por vez y por mensaje. El botón sigue activo mientras el comando
		// viaja, así que dos clics rápidos mandan el mismo `uid` dos veces; el
		// servidor lo aguanta —marcar dos veces lo leído no hace nada— pero acá
		// se restaba uno al contador de la cuenta cada vez, y la cuenta quedaba
		// diciendo menos correo sin leer del que tiene.
		const enCurso = `${elegida.value}:${uid}`;
		if (marcando.has(enCurso)) {
			return;
		}
		marcando.add(enCurso);

		try {
			await invoke('marcar_leido', { accountId: elegida.value, uid });
			const mensaje = mensajes.value.find((m) => m.uid === uid);
			if (mensaje) {
				mensaje.sin_leer = false;
			}
			if (abierto.value?.uid === uid) {
				abierto.value = { ...abierto.value, sin_leer: false };
			}
			// El contador de la cuenta también, para que no quede diciendo un
			// número que ya no es. La próxima vuelta del servicio lo confirma.
			const cuenta = cuentas.value.find((c) => c.account_id === elegida.value);
			if (cuenta && cuenta.sin_leer > 0) {
				cuenta.sin_leer -= 1;
			}
		} catch (e) {
			error.value = String(e);
		} finally {
			marcando.delete(enCurso);
		}
	}

	return {
		cuentas,
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
