import { describe, expect, test } from 'bun:test';
import { type Accion, Atajos, GMAIL, teclasPorAccion } from '../src/tools/atajos';

/**
 * Las pruebas del módulo que traduce teclas a acciones.
 *
 * Se puede probar entero sin navegador porque el módulo no toca el DOM: recibe
 * un objeto con lo que hace falta de un evento y devuelve qué se pidió. Los
 * casos que importan no son los atajos que funcionan —ésos se ven al usarlos—
 * sino los que **no tienen que dispararse**.
 */

/** Un evento de teclado, con lo mínimo. */
function tecla(key: string, extra: Record<string, unknown> = {}) {
	return { key, ...extra };
}

describe('atajos', () => {
	test('las teclas del juego de Gmail hacen lo suyo', () => {
		const a = new Atajos();
		expect(a.apretar(tecla('j'))).toBe('siguiente');
		expect(a.apretar(tecla('k'))).toBe('anterior');
		expect(a.apretar(tecla('Enter'))).toBe('abrir');
		expect(a.apretar(tecla('u'))).toBe('volver');
		expect(a.apretar(tecla('r'))).toBe('responder');
		expect(a.apretar(tecla('c'))).toBe('redactar');
		expect(a.apretar(tecla('?'))).toBe('ayuda');
	});

	test('las flechas hacen lo mismo que j y k', () => {
		// Siempre, no como alternativa que hay que descubrir: quien no sabe que
		// existen los atajos igual aprieta las flechas.
		const a = new Atajos();
		expect(a.apretar(tecla('ArrowDown'))).toBe('siguiente');
		expect(a.apretar(tecla('ArrowUp'))).toBe('anterior');
	});

	/**
	 * El caso que hace inservible un juego de atajos de una sola tecla: escribir
	 * una «r» en el cuerpo de un correo y que se abra una respuesta.
	 */
	test('no se disparan mientras se escribe', () => {
		const a = new Atajos();
		for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
			expect(a.apretar(tecla('r', { target: { tagName } }))).toBeNull();
		}

		// Y lo editable, que es lo que usan los editores enriquecidos.
		expect(
			a.apretar(tecla('r', { target: { tagName: 'DIV', isContentEditable: true } }))
		).toBeNull();
	});

	test('fuera de un campo, la misma tecla sí', () => {
		const a = new Atajos();
		expect(a.apretar(tecla('r', { target: { tagName: 'DIV' } }))).toBe('responder');
		expect(a.apretar(tecla('r', { target: null }))).toBe('responder');
	});

	/**
	 * Tomar las combinaciones con modificador rompe copiar, pegar y cerrar la
	 * ventana. No son nuestras.
	 */
	test('las combinaciones con modificador no se tocan', () => {
		const a = new Atajos();
		expect(a.apretar(tecla('c', { ctrlKey: true }))).toBeNull();
		expect(a.apretar(tecla('c', { metaKey: true }))).toBeNull();
		expect(a.apretar(tecla('r', { altKey: true }))).toBeNull();
		// Shift no: `?` es Shift+/ en casi todos los teclados.
		expect(a.apretar(tecla('?', { shiftKey: true }))).toBe('ayuda');
	});

	test('una secuencia se completa con su segunda tecla', () => {
		const a = new Atajos();
		expect(a.apretar(tecla('g'), 0)).toBeNull();
		expect(a.esperando()).toBe(true);
		expect(a.apretar(tecla('i'), 100)).toBe('irALaEntrada');
		expect(a.esperando()).toBe(false);
	});

	/**
	 * Sin vencimiento, una `g` apretada sin querer espera para siempre y la
	 * próxima `i` —en cualquier momento del día— dispara algo que nadie pidió.
	 */
	test('una secuencia a medias vence', () => {
		const a = new Atajos();
		a.apretar(tecla('g'), 0);
		expect(a.apretar(tecla('i'), 5000)).toBeNull();
		expect(a.esperando()).toBe(false);
	});

	test('una secuencia que no lleva a nada se olvida entera', () => {
		const a = new Atajos();
		a.apretar(tecla('g'), 0);
		// La `x` no completa nada.
		expect(a.apretar(tecla('x'), 10)).toBeNull();
		expect(a.esperando()).toBe(false);
		// Y la `i` siguiente no completa la secuencia vieja.
		expect(a.apretar(tecla('i'), 20)).toBeNull();
	});

	test('escribir en un campo borra la secuencia a medias', () => {
		const a = new Atajos();
		a.apretar(tecla('g'), 0);
		a.apretar(tecla('i', { target: { tagName: 'INPUT' } }), 10);
		expect(a.esperando()).toBe(false);
	});

	test('una tecla que no está en el mapa no hace nada', () => {
		const a = new Atajos();
		for (const t of ['z', 'F5', 'Escape', ' ', 'Tab']) {
			expect(a.apretar(tecla(t))).toBeNull();
		}
	});

	/**
	 * La ayuda sale del mismo mapa que ejecuta, así que una ayuda que miente es
	 * imposible. Si no fuera así, la lista y las teclas se separarían en cuanto
	 * alguien cambie una.
	 */
	test('la ayuda se arma con el mapa de verdad', () => {
		const lista = teclasPorAccion();
		const acciones = new Set(lista.map((l) => l.accion));

		// Cada acción del mapa aparece una vez, con todas sus teclas juntas.
		expect(acciones.size).toBe(lista.length);
		const siguiente = lista.find((l) => l.accion === 'siguiente');
		expect(siguiente?.teclas.sort()).toEqual(['ArrowDown', 'j']);

		// Y no hay ninguna acción declarada que el mapa no tenga.
		for (const { accion } of lista) {
			expect(Object.values(GMAIL)).toContain(accion);
		}
	});

	/**
	 * Lo que el issue pide explícitamente: no declarar atajos que no hacen nada.
	 * Archivar, borrar y buscar son del juego de Gmail y todavía no existen acá.
	 */
	test('no se prometen teclas que no contestan', () => {
		const sinHacer = ['archivar', 'borrar', 'destacar', 'buscar', 'marcarNoLeido'];
		for (const accion of Object.values(GMAIL)) {
			expect(sinHacer).not.toContain(accion as string);
		}
	});

	test('un mapa distinto es otro juego de teclas, no otro código', () => {
		// Es lo que después permite el juego estilo Vim sin duplicar nada.
		const vim: Record<string, Accion> = { h: 'volver', l: 'abrir', 'g g': 'irALaEntrada' };
		const a = new Atajos(vim);
		expect(a.apretar(tecla('l'))).toBe('abrir');
		expect(a.apretar(tecla('j'))).toBeNull();
		expect(a.apretar(tecla('g'), 0)).toBeNull();
		expect(a.apretar(tecla('g'), 10)).toBe('irALaEntrada');
	});
});
