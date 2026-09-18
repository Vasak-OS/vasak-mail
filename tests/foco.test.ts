import { describe, expect, test } from 'bun:test';
import { aQuienEnfocar } from '../src/tools/foco';

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
