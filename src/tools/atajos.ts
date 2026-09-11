/**
 * Tecla → acción, en un solo lugar.
 *
 * Los únicos atajos de la aplicación eran los dos de la ventana de redacción,
 * escritos como `@keydown` en el componente. Repartirlos así funciona hasta el
 * tercero: después nadie sabe qué teclas están tomadas, dos componentes
 * responden a la misma, y no hay de dónde sacar la lista para mostrarla.
 *
 * Acá está la traducción y nada más — no toca el DOM, no conoce Vue y no sabe
 * qué hace cada acción. Eso es lo que permite probarla entera sin un navegador,
 * y es también lo que va a permitir que el día de mañana haya un segundo juego
 * de teclas (el estilo Vim que pide el issue): es **otro mapa**, no otro código.
 */

/** Lo que se puede pedir con el teclado. */
export type Accion =
	| 'siguiente'
	| 'anterior'
	| 'abrir'
	| 'volver'
	| 'responder'
	| 'redactar'
	| 'actualizar'
	| 'irALaEntrada'
	| 'ayuda';

/**
 * Lo mínimo de un evento de teclado que hace falta para decidir.
 *
 * Estructural y no `KeyboardEvent`: así las pruebas pasan objetos comunes y no
 * hace falta un DOM para comprobar la parte que decide.
 */
export interface Pulsacion {
	key: string;
	ctrlKey?: boolean;
	altKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
	target?: EventTarget | null;
}

/**
 * El juego por omisión, estilo Gmail.
 *
 * Gmail y no Vim porque es el que más gente ya conoce: quien nunca vio un atajo
 * de correo no gana nada con ninguno de los dos, y quien vio alguno vio éste.
 *
 * **Sólo están las que hacen algo.** Archivar, borrar, destacar y buscar son
 * del juego de Gmail y todavía no existen acá; declararlas haría que la ayuda
 * prometa teclas que no contestan, que es peor que no tener ayuda.
 */
export const GMAIL: Readonly<Record<string, Accion>> = Object.freeze({
	j: 'siguiente',
	ArrowDown: 'siguiente',
	k: 'anterior',
	ArrowUp: 'anterior',
	Enter: 'abrir',
	u: 'volver',
	r: 'responder',
	c: 'redactar',
	'.': 'actualizar',
	'g i': 'irALaEntrada',
	'?': 'ayuda',
});

/**
 * Cuánto vive una secuencia a medias.
 *
 * `g` sola no hace nada: espera la segunda tecla. Sin vencimiento, una `g`
 * apretada sin querer se queda esperando para siempre y la próxima tecla suelta
 * —una `i` en cualquier momento del día— dispara una acción que nadie pidió.
 */
const VENCIMIENTO_MS = 1500;

/**
 * Si el foco está donde se escribe.
 *
 * Se mira por las propiedades y no con `instanceof HTMLElement`, que es lo
 * primero que sale. Con `instanceof` esto sólo se puede probar dentro de un
 * navegador, y entonces la comprobación que evita que escribir una «r» abra una
 * respuesta queda sin prueba — justo la que más falta hace.
 */
export function seEstaEscribiendo(destino: EventTarget | null | undefined): boolean {
	const elemento = destino as { tagName?: unknown; isContentEditable?: unknown } | null;
	if (!elemento) {
		return false;
	}
	if (elemento.isContentEditable === true) {
		return true;
	}
	return (
		typeof elemento.tagName === 'string' &&
		['INPUT', 'TEXTAREA', 'SELECT'].includes(elemento.tagName)
	);
}

/**
 * Traduce pulsaciones a acciones, acordándose de las secuencias a medias.
 *
 * El reloj entra por parámetro para que las pruebas puedan adelantarlo sin
 * esperar de verdad.
 */
export class Atajos {
	private pendiente = '';
	private desde = 0;

	constructor(private readonly mapa: Readonly<Record<string, Accion>> = GMAIL) {}

	/**
	 * Qué acción corresponde, o `null` si ninguna.
	 *
	 * Devuelve `null` también cuando la tecla **empieza** una secuencia: todavía
	 * no se sabe qué se pidió. Quien llama tiene que evitar el comportamiento por
	 * omisión igual en ese caso, y para eso está `esperando()`.
	 */
	apretar(evento: Pulsacion, ahora: number = Date.now()): Accion | null {
		// Las combinaciones con modificador son del sistema o del navegador.
		// Tomarlas rompe copiar, pegar y cerrar la ventana.
		if (evento.ctrlKey || evento.altKey || evento.metaKey) {
			this.olvidar();
			return null;
		}

		// Un atajo de una sola tecla dentro de un campo escribe la letra. Es la
		// forma más rápida de hacer inservible un juego de atajos.
		if (seEstaEscribiendo(evento.target)) {
			this.olvidar();
			return null;
		}

		// Una secuencia que venció no arrastra su primera tecla.
		if (this.pendiente && ahora - this.desde > VENCIMIENTO_MS) {
			this.olvidar();
		}

		const clave = this.pendiente ? `${this.pendiente} ${evento.key}` : evento.key;

		const accion = this.mapa[clave];
		if (accion) {
			this.olvidar();
			return accion;
		}

		// ¿Es el principio de algo? Se mira si alguna clave del mapa empieza así.
		if (!this.pendiente && this.empiezaAlgo(evento.key)) {
			this.pendiente = evento.key;
			this.desde = ahora;
			return null;
		}

		// Ni una cosa ni la otra: se olvida lo que había. Con `g` pendiente y una
		// tecla que no completa nada, guardar la `g` haría que la siguiente tecla
		// suelta complete una secuencia que nadie quiso.
		this.olvidar();
		return null;
	}

	/** Si hay una secuencia a medias esperando su segunda tecla. */
	esperando(): boolean {
		return this.pendiente !== '';
	}

	private olvidar() {
		this.pendiente = '';
		this.desde = 0;
	}

	private empiezaAlgo(tecla: string): boolean {
		return Object.keys(this.mapa).some((clave) => clave.startsWith(`${tecla} `));
	}
}

/**
 * Las teclas de cada acción, para mostrarlas.
 *
 * Sale del mismo mapa que las ejecuta, así que una ayuda que miente es
 * imposible: si una tecla cambia, cambia en los dos lados a la vez.
 */
export function teclasPorAccion(
	mapa: Readonly<Record<string, Accion>> = GMAIL
): Array<{ accion: Accion; teclas: string[] }> {
	const porAccion = new Map<Accion, string[]>();
	for (const [tecla, accion] of Object.entries(mapa)) {
		const lista = porAccion.get(accion) ?? [];
		lista.push(tecla);
		porAccion.set(accion, lista);
	}
	return [...porAccion].map(([accion, teclas]) => ({ accion, teclas }));
}
