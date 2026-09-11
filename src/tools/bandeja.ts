/**
 * La bandeja combinada: juntar el correo de varias cuentas en una sola lista.
 *
 * Aparte y con pruebas porque tiene la trampa que hace fallar a esta función en
 * todos lados: **el `uid` no identifica un mensaje**. Es el número que le puso
 * su servidor dentro de su carpeta, así que el 7 de una cuenta y el 7 de otra
 * son dos mensajes distintos con el mismo número — y cualquier cosa que busque
 * por `uid` termina abriendo, marcando o cerrando el que no era.
 *
 * Lo que identifica un mensaje es `(cuenta, carpeta, uid)`. Eso es [`claveDe`], y
 * es lo único que hay que usar para compararlos.
 */

/** Lo mínimo de un mensaje que hace falta para identificarlo y ordenarlo. */
export interface Identificable {
	account_id: string;
	casilla: string;
	uid: number;
	/** ISO 8601, o vacío si la fecha del mensaje no se entendió. */
	fecha: string;
}

/**
 * Qué cuenta está elegida cuando están todas.
 *
 * Un asterisco y no la cadena vacía, que ya quiere decir «no hay ninguna cuenta
 * conectada»: son dos estados distintos, y confundirlos deja la ventana
 * mostrando «no tenés correo» cuando lo que pasa es que se está cargando todo.
 *
 * No puede chocar con el identificador de una cuenta de verdad: los da el
 * servicio de cuentas y son alfanuméricos.
 */
export const TODAS = '*';

/**
 * Lo que identifica a un mensaje entre todos los de todas las cuentas.
 *
 * **Armada con `JSON.stringify` y no pegando los campos con un separador.** Un
 * nombre de carpeta de IMAP puede tener espacios, dos puntos y barras —«Todos
 * los mensajes», «[Gmail]/Enviados»— así que no hay carácter suelto que sirva de
 * separador: con cualquiera de ellos, `a` + `b:c` y `a:b` + `c` dan la misma
 * clave, y dos mensajes distintos se vuelven el mismo.
 */
export function claveDe(mensaje: Identificable): string {
	return JSON.stringify([mensaje.account_id, mensaje.casilla, mensaje.uid]);
}

/** Si dos referencias apuntan al mismo mensaje. */
export function esElMismo(a: Identificable | null, b: Identificable | null): boolean {
	return a !== null && b !== null && claveDe(a) === claveDe(b);
}

/**
 * Junta las listas de varias cuentas en una sola, de lo más nuevo a lo más
 * viejo.
 *
 * ── Las fechas que no se entienden van al final ─────────────────────────────
 *
 * Un mensaje puede llegar sin `Date`, o con una fecha que no se pudo
 * interpretar; el servicio la manda vacía. Ponerlos primero —que es lo que pasa
 * si se los trata como el año cero— llena el tope de la bandeja con lo que menos
 * se sabe. Van al fondo, que es donde molestan menos.
 *
 * ── Y el desempate está escrito ─────────────────────────────────────────────
 *
 * Dos mensajes pueden tener exactamente la misma fecha: una lista de correo los
 * manda en el mismo segundo. Sin un desempate, el orden depende de en qué orden
 * contestaron las cuentas, y la lista se reordena sola entre una actualización y
 * la siguiente.
 */
export function combinados<T extends Identificable>(listas: T[][]): T[] {
	return listas.flat().sort((a, b) => {
		const cuandoA = momento(a.fecha);
		const cuandoB = momento(b.fecha);

		if (cuandoA !== cuandoB) {
			// Sin fecha usable, siempre al final, venga de donde venga.
			if (cuandoA === null) {
				return 1;
			}
			if (cuandoB === null) {
				return -1;
			}
			return cuandoB - cuandoA;
		}
		return claveDe(a).localeCompare(claveDe(b));
	});
}

/** El instante de una fecha, o `null` si no se entiende. */
function momento(fecha: string): number | null {
	if (!fecha) {
		return null;
	}
	const cuando = Date.parse(fecha);
	return Number.isNaN(cuando) ? null : cuando;
}
