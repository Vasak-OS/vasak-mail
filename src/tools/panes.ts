/**
 * Qué panel se ve cuando no entran los tres.
 *
 * El diseño es de tres paneles fijos: en una ventana angosta se aplastan hasta
 * que ninguno sirve. Debajo del corte se ve **uno por vez** y se navega entre
 * ellos, que es el patrón de siempre para maestro-detalle —el de una aplicación
 * de teléfono—.
 *
 * Cuál se ve no es un estado aparte que haya que mantener sincronizado: se
 * deduce de lo que la aplicación ya sabe. Un estado paralelo sería uno que se
 * desincroniza —abrir un mensaje desde un atajo y que el panel no cambie— y la
 * forma de que eso no pase es que no exista.
 */
export type Pane = 'folders' | 'list' | 'message';

/** Los tres, en el orden en que van de izquierda a derecha. */
export const PANES: readonly Pane[] = Object.freeze(['folders', 'list', 'message']);

/**
 * Desde qué ancho de la fila entran los tres, en píxeles.
 *
 * Es `--container-three-panes` de `main.css`, que es lo que de verdad decide:
 * acá está para poder razonarlo en una prueba, y otra prueba comprueba que los
 * dos digan lo mismo. Vale lo que daba `md:` —768 px de ventana— medido en la
 * fila, que es 10 px más angosta (el canto del marco y su relleno).
 */
export const THREE_PANES_MIN_WIDTH = 758;

/**
 * La clase que esconde un panel **sólo** cuando no entran los tres.
 *
 * Una consulta de contenedor sobre la fila de la ventana (`@container/panes` en
 * `MailView.vue`) y no un punto de corte de la pantalla: en el WebView ni
 * `matchMedia` ni `resize` avisan al cambiar el ancho, y la pantalla no sabe si
 * la barra de la ventana va a un costado. Escrita entera, para que Tailwind la
 * encuentre al leer este archivo.
 */
export const HIDDEN_WHEN_NARROW = '@max-three-panes/panes:hidden';

/**
 * Las clases de visibilidad de un panel: nada si es el que toca, y escondido
 * en angosto si no. En ancho no esconden nada, así que se ven los tres.
 */
export function paneVisibility(pane: Pane, shown: Pane): string {
	return pane === shown ? '' : HIDDEN_WHEN_NARROW;
}

/**
 * Qué paneles quedan en pantalla con una fila de `rowWidth` píxeles.
 *
 * Es la misma regla que aplica el CSS, escrita para poder probarla: con la fila
 * ancha, los tres; con la angosta, sólo el que toca.
 */
export function panesOnScreen(rowWidth: number, shown: Pane): Pane[] {
	return rowWidth >= THREE_PANES_MIN_WIDTH ? [...PANES] : [shown];
}

/**
 * @param messageOpen si se está leyendo algo
 * @param foldersRequested si se apretó el nombre de la carpeta para cambiarla
 */
export function visiblePane(messageOpen: boolean, foldersRequested: boolean): Pane {
	// Las carpetas ganan: se acaban de pedir, y son un paso hacia atrás
	// deliberado sobre lo que se estaba mirando.
	if (foldersRequested) {
		return 'folders';
	}
	return messageOpen ? 'message' : 'list';
}

/**
 * A dónde lleva el botón de volver desde cada panel.
 *
 * Siempre a la lista, que es el centro de la aplicación. Desde la lista no hay
 * atrás: es el principio.
 */
export function backFrom(pane: Pane): Pane | null {
	return pane === 'list' ? null : 'list';
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
 * @param now el panel al que se acaba de llegar
 * @param before en cuál se estaba
 * @param focusAlreadyInList si el foco cayó adentro del panel de la lista
 */
export function shouldRescueFocus(now: Pane, before: Pane, focusAlreadyInList: boolean): boolean {
	if (now !== 'list' || before === 'list') {
		return false;
	}
	return !focusAlreadyInList;
}
