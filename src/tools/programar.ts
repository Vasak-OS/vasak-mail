/**
 * Las horas que se ofrecen para programar un envío.
 *
 * Se calculan sobre el reloj local, que es el único que la persona tiene en la
 * cabeza: quien elige «mañana a la mañana» quiere las ocho de **su** mañana. Lo
 * que se le manda al servicio es UTC, que es lo que espera.
 *
 * Aparte del componente y sin nada de Vue adentro: lo que puede salir mal acá
 * son las horas —una opción que ya pasó, un cambio de día, un fin de semana— y
 * eso se prueba con un reloj de mentira, no mirando la pantalla.
 */

/** Una opción del menú. */
export interface Momento {
	/** Con qué clave se muestra: `programar.estaTarde`, etc. */
	clave: string;
	/** Cuándo, en hora local. */
	cuando: Date;
}

/** Las horas de referencia, en hora local. */
const ESTA_TARDE = 18;
const A_LA_MANANA = 8;

function aLas(base: Date, hora: number, diasDespues = 0): Date {
	const fecha = new Date(base);
	fecha.setDate(fecha.getDate() + diasDespues);
	fecha.setHours(hora, 0, 0, 0);
	return fecha;
}

/**
 * Qué ofrecer, según la hora que sea.
 *
 * **Lo que ya pasó no se ofrece.** «Esta tarde» a las nueve de la noche es una
 * hora anterior a ahora: el mensaje saldría en el acto, que es lo contrario de
 * lo que se pidió, y nadie entendería por qué.
 *
 * El lunes se ofrece desde el viernes: es cuando alguien quiere que un correo
 * de trabajo no llegue un sábado.
 */
export function momentos(ahora: Date): Momento[] {
	const opciones: Momento[] = [];

	const estaTarde = aLas(ahora, ESTA_TARDE);
	if (estaTarde.getTime() > ahora.getTime()) {
		opciones.push({ clave: 'programar.estaTarde', cuando: estaTarde });
	}

	opciones.push({ clave: 'programar.mananaTemprano', cuando: aLas(ahora, A_LA_MANANA, 1) });

	// `getDay()`: 0 es domingo, 5 es viernes.
	const dia = ahora.getDay();
	if (dia === 5 || dia === 6 || dia === 0) {
		const hastaElLunes = (8 - dia) % 7 || 7;
		opciones.push({ clave: 'programar.elLunes', cuando: aLas(ahora, A_LA_MANANA, hastaElLunes) });
	}

	return opciones;
}

/**
 * Pasa una hora local a lo que el servicio espera.
 *
 * En UTC y con zona: mandar una hora local sin zona haría salir el mensaje con
 * horas de diferencia según dónde esté el equipo.
 */
export function paraElServicio(cuando: Date): string {
	return cuando.toISOString();
}

/**
 * Lee lo que devuelve un `<input type="datetime-local">`.
 *
 * Ese control da `2026-09-12T18:30` **sin zona**, y `new Date()` lo interpreta
 * como hora local, que es lo correcto: la persona escribió la hora de su reloj.
 *
 * Devuelve `null` si no se entiende o si ya pasó. Programar para una hora
 * anterior a ahora hace salir el mensaje en el acto, que es lo contrario de lo
 * que se pidió.
 */
export function elegida(texto: string, ahora: Date): Date | null {
	if (!texto) {
		return null;
	}
	const cuando = new Date(texto);
	if (Number.isNaN(cuando.getTime()) || cuando.getTime() <= ahora.getTime()) {
		return null;
	}
	return cuando;
}
