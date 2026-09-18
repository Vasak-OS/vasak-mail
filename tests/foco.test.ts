import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aQuienEnfocar, SELECTORES } from '../src/tools/foco';

/**
 * A quién le toca el foco al salir del buscador con Escape.
 *
 * Tres valores y un orden. El orden es lo único que hay acá y es exactamente lo
 * que se rompe sin que nadie lo note: las tres variantes «funcionan», y dos de
 * ellas dejan el foco en el lugar equivocado.
 */
describe('aQuienEnfocar', () => {
	test('el mensaje abierto gana', () => {
		// Es la decisión entera: salir del buscador devuelve donde estabas. Con el
		// orden al revés, buscar algo y arrepentirse te movía de mensaje.
		expect(aQuienEnfocar({ abierto: 'abierto', primero: 'primero', contenedor: 'lista' })).toBe(
			'abierto'
		);
	});

	test('sin nada abierto, la primera fila', () => {
		expect(aQuienEnfocar({ abierto: null, primero: 'primero', contenedor: 'lista' })).toBe(
			'primero'
		);
	});

	/**
	 * Una búsqueda sin resultados no tiene filas. Sin este último recurso el foco
	 * se quedaba en el campo y la tecla no hacía nada visible, que es
	 * indistinguible de estar rota.
	 */
	test('con la lista vacía, la lista', () => {
		expect(aQuienEnfocar({ abierto: null, primero: null, contenedor: 'lista' })).toBe('lista');
	});

	test('y si no hay nada, nada', () => {
		// No puede pasar mientras el componente esté montado, pero devolver algo
		// inventado sería peor que devolver null: `?.focus()` no hace nada y eso
		// es exactamente lo correcto.
		expect(aQuienEnfocar({ abierto: null, primero: null, contenedor: null })).toBeNull();
	});
});

/**
 * Que los selectores y la plantilla sigan hablando de lo mismo.
 *
 * `aQuienEnfocar` fija el orden, que es la decisión. Esto cubre lo otro que
 * puede fallar y que ninguna prueba veía: que el selector **encuentre** la fila.
 * Mover el `aria-current` a otro elemento, o envolver el botón, deja el código
 * compilando, los tipos contentos y la tecla sin hacer nada.
 *
 * Es más flojo que montar el componente y apretar Escape, y se dice acá para
 * que nadie lo confunda con eso: no comprueba que `focus()` termine donde se
 * quiso, sólo que la forma del DOM sea la que los selectores suponen. Montar no
 * se puede todavía porque `bun test` no compila archivos `.vue`; hacerlo pide un
 * cargador de SFC o un segundo corredor de pruebas, que es una decisión del
 * repositorio y no de este cambio.
 */
describe('los selectores de las filas', () => {
	const plantilla = readFileSync(
		fileURLToPath(new URL('../src/components/correo/ListaComponent.vue', import.meta.url)),
		'utf8'
	);

	/** El bloque `<li>…</li>` de una fila, que es donde tienen que pasar las tres cosas. */
	const fila = plantilla.slice(plantilla.indexOf('<li v-for'), plantilla.indexOf('</li>'));

	test('la fila es un button adentro de un li', () => {
		// Los dos selectores empiezan por `li button`: si deja de ser así, los dos
		// dejan de encontrar nada a la vez.
		expect(SELECTORES.abierto.startsWith('li button')).toBe(true);
		expect(SELECTORES.primero).toBe('li button');
		expect(fila).toContain('<button');
	});

	test('y el aria-current está en el button, no en el li', () => {
		// El selector del abierto lo busca ahí. En el `<li>` sería igual de válido
		// como HTML y dejaría de encontrarse.
		expect(fila).toContain(':aria-current=');
		const desdeElBoton = fila.slice(fila.indexOf('<button'));
		expect(desdeElBoton).toContain(':aria-current=');
	});

	test('y es el mensaje abierto el que lo lleva', () => {
		// `esElMismo(mensaje, abierto)`: si alguien lo cambiara por «sin leer» o
		// por «el primero», el foco volvería a un mensaje que no es el que se
		// estaba leyendo, que es justo lo que `aQuienEnfocar` decide evitar.
		expect(fila).toMatch(/:aria-current="esElMismo\(mensaje, abierto\)/);
	});
});
