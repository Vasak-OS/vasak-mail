import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pickFocusTarget, ROW_SELECTORS } from '../src/tools/focus';

/**
 * A quién le toca el foco al salir del buscador con Escape.
 *
 * Tres valores y un orden. El orden es lo único que hay acá y es exactamente lo
 * que se rompe sin que nadie lo note: las tres variantes «funcionan», y dos de
 * ellas dejan el foco en el lugar equivocado.
 */
describe('pickFocusTarget', () => {
	test('el mensaje abierto gana', () => {
		// Es la decisión entera: salir del buscador devuelve donde estabas. Con el
		// orden al revés, buscar algo y arrepentirse te movía de mensaje.
		expect(pickFocusTarget({ open: 'abierto', first: 'primero', container: 'lista' })).toBe(
			'abierto'
		);
	});

	test('sin nada abierto, la primera fila', () => {
		expect(pickFocusTarget({ open: null, first: 'primero', container: 'lista' })).toBe(
			'primero'
		);
	});

	/**
	 * Una búsqueda sin resultados no tiene filas. Sin este último recurso el foco
	 * se quedaba en el campo y la tecla no hacía nada visible, que es
	 * indistinguible de estar rota.
	 */
	test('con la lista vacía, la lista', () => {
		expect(pickFocusTarget({ open: null, first: null, container: 'lista' })).toBe('lista');
	});

	test('y si no hay nada, nada', () => {
		// No puede pasar mientras el componente esté montado, pero devolver algo
		// inventado sería peor que devolver null: `?.focus()` no hace nada y eso
		// es exactamente lo correcto.
		expect(pickFocusTarget({ open: null, first: null, container: null })).toBeNull();
	});
});

/**
 * Que los selectores y la plantilla sigan hablando de lo mismo.
 *
 * `pickFocusTarget` fija el orden, que es la decisión. Esto cubre lo otro que
 * puede fallar y que ninguna prueba veía: que el selector **encuentre** la fila.
 * Mover el `aria-current` a otro elemento, o envolver el botón, deja el código
 * compilando, los tipos contentos y la tecla sin hacer nada.
 *
 * Es más flojo que montar el componente y apretar Escape, y se dice acá para
 * que nadie lo confunda con eso: no comprueba que `focus()` termine donde se
 * quiso, sólo que la forma del DOM sea la que los selectores suponen. Lo que
 * monta la lista y aprieta Escape es `list-focus.test.ts`.
 */
describe('los selectores de las filas', () => {
	const plantilla = readFileSync(
		fileURLToPath(new URL('../src/components/mail/MessageListComponent.vue', import.meta.url)),
		'utf8'
	);

	/** El bloque `<li>…</li>` de una fila, que es donde tienen que pasar las tres cosas. */
	const fila = plantilla.slice(plantilla.indexOf('<li v-for'), plantilla.indexOf('</li>'));

	test('la fila es una ListRow con rol de botón adentro de un li', () => {
		// Los dos selectores buscan `[role="button"]` dentro de un `li`: si la
		// fila deja de tener ese rol, los dos dejan de encontrar nada a la vez.
		expect(ROW_SELECTORS.open.startsWith('li [role="button"]')).toBe(true);
		expect(ROW_SELECTORS.first).toBe('li [role="button"]');
		expect(fila).toContain('<ListRow');
		expect(fila.slice(fila.indexOf('<ListRow'))).toMatch(/^<ListRow\s+role="button"/);
	});

	test('y la elegida la marca `selected`, que ListRow vuelve `aria-current`', () => {
		// El selector del abierto busca `aria-current="true"`, y quien lo pone es
		// `ListRow` cuando tiene `role="button"` y `selected`. Un `aria-current`
		// escrito a mano en el `<li>` sería igual de válido como HTML y dejaría de
		// encontrarse.
		const desdeLaFila = fila.slice(fila.indexOf('<ListRow'));
		expect(desdeLaFila).toContain(':selected=');
	});

	test('y es el mensaje abierto el que lo lleva', () => {
		// `esElMismo(mensaje, abierto)`: si alguien lo cambiara por «sin leer» o
		// por «el primero», el foco volvería a un mensaje que no es el que se
		// estaba leyendo, que es justo lo que `pickFocusTarget` decide evitar.
		expect(fila).toMatch(/:selected="esElMismo\(mensaje, abierto\)"/);
	});
});
