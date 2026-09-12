/**
 * Las preferencias de la aplicación de correo.
 *
 * # Dónde viven, y por qué ahí
 *
 * En un archivo de `$XDG_CONFIG_HOME/vasak-mail/`, que **escribe sólo esta
 * ventana** y que el servicio lee cuando las necesita.
 *
 * La razón de que no alcance con `localStorage` —que es lo que usa el calendario
 * para su zona horaria, y está bien para lo que es— no es de comodidad:
 * `vasak-accounts-sync` corre con la ventana cerrada, que es de lo que se trata
 * el aviso de correo nuevo, y no puede leer nada de adentro del navegador. Media
 * preferencia de acá es suya.
 *
 * De los tres caminos que planteaba el issue se eligió el archivo compartido y
 * no un método de D-Bus, por dos motivos:
 *
 * - La mitad de las preferencias son **sólo de la ventana** —cuánto dura la
 *   ventana para deshacer, por ejemplo, que la calcula quien dibuja el botón—.
 *   Hacerlas pasar por el servicio serían idas y vueltas por algo que no le
 *   importa.
 * - El servicio ya sabe escribir archivos del usuario con cuidado y ya lee de su
 *   propio directorio; leer uno más no le agrega superficie. Un método nuevo en
 *   la interfaz de D-Bus, sí.
 *
 * **Un solo escritor**, que es esta ventana. El servicio nunca escribe: así no
 * hay dos procesos pisándose un archivo, y no hace falta ningún bloqueo.
 *
 * # Lo que no está acá
 *
 * Los remitentes a los que se les muestran las imágenes. Esa lista es **con
 * quién se cartea la persona**, guardada en claro y para siempre, y es la misma
 * discusión que tienen abierta los issues de modo sin conexión. Va a esperar a
 * que se decida el almacén cifrado, en vez de dejar el dato tirado acá porque
 * era el archivo que había a mano.
 */

/** Cuánto dice el cartel de correo nuevo. */
export type DetalleDelAviso =
	/** «Llegaron 3 mensajes», y a qué cuenta. */
	| 'cantidad'
	/** Y de quién. */
	| 'remitente'
	/** Y de qué. */
	| 'asunto';

export interface Preferencias {
	detalleDelAviso: DetalleDelAviso;
	/** Segundos para arrepentirse de un envío. `0` manda en el acto. */
	segundosParaDeshacer: number;
}

/**
 * Lo que vale cuando nadie tocó nada.
 *
 * **Lo conservador, y eso no es casual.** Las tres funciones que esperaban por
 * esto eligieron el valor que menos muestra y menos hace, y agregar la
 * preferencia no puede cambiar en silencio lo que ya pasaba: quien no abra esto
 * nunca tiene que seguir viendo exactamente lo de antes.
 */
export const POR_OMISION: Preferencias = Object.freeze({
	// El cartel no nombra a nadie: la pantalla puede estar bloqueada, compartida
	// o proyectada, y quién te escribe es un dato tan personal como lo que te
	// escribió.
	detalleDelAviso: 'cantidad',
	// Diez segundos: cinco alcanzan para el arrepentimiento inmediato y no para
	// leer el cartel; treinta hacen que el correo parezca trabado.
	segundosParaDeshacer: 10,
});

/** Hasta cuánto se puede estirar la ventana para deshacer. */
export const MAX_SEGUNDOS_PARA_DESHACER = 60;

const DETALLES: readonly DetalleDelAviso[] = ['cantidad', 'remitente', 'asunto'];

/**
 * Interpreta lo que había guardado.
 *
 * **Campo por campo y con respaldo en cada uno.** El archivo está en el disco de
 * la persona: lo puede haber editado a mano, lo puede haber escrito una versión
 * anterior que no tenía este campo, o puede haber quedado a medias. Nada de eso
 * puede impedir que la aplicación abra, y ningún valor raro puede convertirse en
 * una preferencia menos conservadora que la de omisión.
 */
export function leidas(crudo: unknown): Preferencias {
	if (typeof crudo !== 'object' || crudo === null) {
		return { ...POR_OMISION };
	}
	const guardado = crudo as Record<string, unknown>;

	return {
		detalleDelAviso: detalle(guardado.detalleDelAviso),
		segundosParaDeshacer: segundos(guardado.segundosParaDeshacer),
	};
}

function detalle(valor: unknown): DetalleDelAviso {
	return DETALLES.includes(valor as DetalleDelAviso)
		? (valor as DetalleDelAviso)
		: POR_OMISION.detalleDelAviso;
}

/**
 * Los segundos para deshacer, acotados.
 *
 * Sin tope, un número enorme guardado por error —o a mano— deja los mensajes
 * esperando para siempre y parece que el correo no manda. Y los negativos y lo
 * que no es un número caen al valor de omisión, no a cero: cero es una elección
 * válida —«mandá en el acto»— y no se llega a ella por accidente.
 */
function segundos(valor: unknown): number {
	if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) {
		return POR_OMISION.segundosParaDeshacer;
	}
	return Math.min(Math.round(valor), MAX_SEGUNDOS_PARA_DESHACER);
}
