/**
 * Qué panel se ve cuando no entran los tres.
 *
 * El diseño es de tres paneles fijos: en una ventana angosta se aplastan hasta
 * que ninguno sirve. Debajo del punto de corte se ve **uno por vez** y se
 * navega entre ellos, que es el patrón de siempre para maestro-detalle.
 *
 * Cuál se ve no es un estado aparte que haya que mantener sincronizado: se
 * deduce de lo que la aplicación ya sabe. Un estado paralelo sería uno que se
 * desincroniza —abrir un mensaje desde un atajo y que el panel no cambie— y la
 * forma de que eso no pase es que no exista.
 */
export type Panel = 'carpetas' | 'lista' | 'mensaje';

/**
 * @param hayMensajeAbierto si se está leyendo algo
 * @param pidieronCarpetas si se apretó el nombre de la carpeta para cambiarla
 */
export function panelVisible(hayMensajeAbierto: boolean, pidieronCarpetas: boolean): Panel {
	// Las carpetas ganan: se acaban de pedir, y son un paso hacia atrás
	// deliberado sobre lo que se estaba mirando.
	if (pidieronCarpetas) {
		return 'carpetas';
	}
	return hayMensajeAbierto ? 'mensaje' : 'lista';
}

/**
 * A dónde lleva el botón de volver desde cada panel.
 *
 * Siempre a la lista, que es el centro de la aplicación. Desde la lista no hay
 * atrás: es el principio.
 */
export function atrasDesde(panel: Panel): Panel | null {
	return panel === 'lista' ? null : 'lista';
}
