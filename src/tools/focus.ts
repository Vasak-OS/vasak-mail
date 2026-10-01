/**
 * A quién le toca el foco al volver del buscador.
 *
 * Es una decisión de tres líneas y vive acá igual, por la misma razón que
 * `shouldRescueFocus`: el componente no puede probarse sin un navegador y
 * esto sí. Lo que importa no es el código sino el orden, y el orden es lo que
 * se rompe sin que nadie lo note.
 */

/**
 * Los tres lugares donde puede quedar el foco, de mejor a peor.
 *
 * @param open la fila del mensaje que se está leyendo
 * @param first la primera fila de la lista
 * @param container la lista entera, que puede estar vacía
 */
export interface FocusCandidates<T> {
	open: T | null;
	first: T | null;
	container: T | null;
}

/**
 * El primero que exista, en ese orden.
 *
 * **El abierto antes que el primero**, y esa es toda la decisión: salir del
 * buscador tiene que devolverte donde estabas, no al principio de la lista.
 * Con el orden al revés, buscar algo y arrepentirse te movía de mensaje — un
 * efecto que nadie pidió y que sólo se nota cuando ya perdiste el lugar.
 *
 * El contenedor es el último recurso y existe para la lista vacía: sin él, una
 * búsqueda sin resultados dejaba el foco en el campo y la tecla no hacía nada
 * visible, que es indistinguible de estar rota.
 */
export function pickFocusTarget<T>({ open, first, container }: FocusCandidates<T>): T | null {
	return open ?? first ?? container;
}

/**
 * Con qué se buscan las filas en el DOM de la lista.
 *
 * Están acá, y no escritos adentro del componente, para que una prueba los
 * pueda confrontar con la plantilla. Un selector es la clase de cosa que se
 * rompe en silencio: mover el `aria-current` al `<li>`, o envolver la fila en
 * otro elemento, deja el código compilando, los tipos contentos y la tecla sin
 * hacer nada.
 *
 * La fila es la `ListRow` de la librería con `role="button"`: un elemento con
 * ese rol y no un `<button>`, y es `ListRow` la que le pone el `aria-current`
 * cuando está elegida. Por eso se busca por el rol: el día que la fila vuelva a
 * ser un `<button>` de verdad, esto deja de encontrarla y la prueba que monta la
 * lista lo dice.
 */
export const ROW_SELECTORS = Object.freeze({
	/** La fila del mensaje que se está leyendo. */
	open: 'li [role="button"][aria-current="true"]',
	/** La primera fila que haya. */
	first: 'li [role="button"]',
});
