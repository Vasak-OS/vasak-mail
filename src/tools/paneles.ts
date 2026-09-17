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

/**
 * Si al llegar a la lista hay que llevarle el foco al botón de la carpeta.
 *
 * El botón es el punto de entrada de la lista en una ventana angosta, y sin
 * esto, al volver de un mensaje el foco se queda en algo que ya no se dibuja y
 * quien navega con el teclado empieza de nuevo desde arriba de todo.
 *
 * Pero es un **rescate, no una política**: si el foco ya está adentro de la
 * lista, moverlo es robárselo a quien lo puso ahí a propósito. Eso pasa de
 * verdad con la tecla de buscar en una ventana angosta, que vuelve a la lista
 * justamente para poder enfocar el buscador — y las dos cosas ocurren en el
 * mismo cambio de panel, así que cuál termina ganando depende de en qué orden
 * Vue resuelva dos `nextTick`. Preguntando dónde está el foco, las dos órdenes
 * terminan igual y no hay carrera que perder.
 *
 * @param ahora el panel al que se acaba de llegar
 * @param antes en cuál se estaba
 * @param elFocoYaEstaEnLaLista si el foco cayó adentro del panel de la lista
 */
export function hayQueRescatarElFoco(
	ahora: Panel,
	antes: Panel,
	elFocoYaEstaEnLaLista: boolean
): boolean {
	if (ahora !== 'lista' || antes === 'lista') {
		return false;
	}
	return !elFocoYaEstaEnLaLista;
}
