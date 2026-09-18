/**
 * A quién le toca el foco al volver del buscador.
 *
 * Es una decisión de tres líneas y vive acá igual, por la misma razón que
 * `hayQueRescatarElFoco`: el componente no puede probarse sin un navegador y
 * esto sí. Lo que importa no es el código sino el orden, y el orden es lo que
 * se rompe sin que nadie lo note.
 */

/**
 * Los tres lugares donde puede quedar el foco, de mejor a peor.
 *
 * @param abierto la fila del mensaje que se está leyendo
 * @param primero la primera fila de la lista
 * @param contenedor la lista entera, que puede estar vacía
 */
export interface Candidatos<T> {
	abierto: T | null;
	primero: T | null;
	contenedor: T | null;
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
export function aQuienEnfocar<T>({ abierto, primero, contenedor }: Candidatos<T>): T | null {
	return abierto ?? primero ?? contenedor;
}

/**
 * Con qué se buscan las filas en el DOM de la lista.
 *
 * Están acá, y no escritos adentro del componente, para que una prueba los
 * pueda confrontar con la plantilla. Un selector es la clase de cosa que se
 * rompe en silencio: mover el `aria-current` al `<li>`, o envolver el botón en
 * otro elemento, deja el código compilando, los tipos contentos y la tecla sin
 * hacer nada.
 *
 * Lo ideal sería montar el componente y apretar la tecla. No se puede todavía:
 * `bun test` no compila archivos `.vue`, así que hacer eso pide un cargador de
 * SFC o un segundo corredor de pruebas —una decisión del repositorio entera, no
 * un detalle de este cambio—. Mientras tanto, confrontar los selectores con la
 * plantilla cubre la forma en que esto se rompe de verdad.
 */
export const SELECTORES = Object.freeze({
	/** La fila del mensaje que se está leyendo. */
	abierto: 'li button[aria-current="true"]',
	/** La primera fila que haya. */
	primero: 'li button',
});
