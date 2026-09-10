/**
 * Cómo se escribe la fecha de un mensaje en la lista.
 *
 * Aparte de los componentes, sin nada de Vue adentro y con `hoy` por argumento:
 * si leyera el reloj, el test pasaría o fallaría según el día en que corriera.
 */

/**
 * La hora si el mensaje llegó hoy, el día y el mes si no.
 *
 * Es lo que hace útil esa columna. En una lista donde todo dice la fecha
 * completa, la fecha no distingue nada: lo que la persona quiere saber de un
 * correo de hoy es a qué hora, y de uno viejo, qué día.
 */
export function cuando(
	fecha: string,
	locale: string,
	sinFecha: string,
	hoy: Date = new Date()
): string {
	if (!fecha) {
		return sinFecha;
	}
	const momento = new Date(fecha);
	// Una fecha que no se entiende **no es la de hoy**: mostrar la hora actual
	// haría parecer recién llegado un mensaje de hace tres años.
	if (Number.isNaN(momento.getTime())) {
		return sinFecha;
	}

	return esDeHoy(momento, hoy)
		? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(momento)
		: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(momento);
}

/** Si dos momentos caen el mismo día local. */
export function esDeHoy(momento: Date, hoy: Date): boolean {
	return (
		momento.getFullYear() === hoy.getFullYear() &&
		momento.getMonth() === hoy.getMonth() &&
		momento.getDate() === hoy.getDate()
	);
}
