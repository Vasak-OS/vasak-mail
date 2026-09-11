import { describe, expect, test } from 'bun:test';
import { atrasDesde, panelVisible } from '../src/tools/paneles';

/**
 * Qué se ve en una ventana angosta.
 *
 * La regla que importa es que el panel visible **se deduce** y no se guarda:
 * un estado paralelo sería uno que se desincroniza —abrir un mensaje con un
 * atajo y que el panel no cambie— y estas pruebas fijan que se deduzca bien.
 */
describe('panelVisible', () => {
	test('sin nada abierto se ve la lista', () => {
		expect(panelVisible(false, false)).toBe('lista');
	});

	test('con un mensaje abierto se ve el mensaje', () => {
		// Y eso vale venga de un clic o de la tecla `j`: es la misma condición.
		expect(panelVisible(true, false)).toBe('mensaje');
	});

	test('las carpetas ganan mientras se están eligiendo', () => {
		// Se acaban de pedir: son un paso atrás deliberado sobre lo que se
		// estaba mirando, incluso si había un mensaje abierto.
		expect(panelVisible(false, true)).toBe('carpetas');
		expect(panelVisible(true, true)).toBe('carpetas');
	});
});

describe('atrasDesde', () => {
	test('todo vuelve a la lista', () => {
		expect(atrasDesde('mensaje')).toBe('lista');
		expect(atrasDesde('carpetas')).toBe('lista');
	});

	test('desde la lista no hay atrás', () => {
		// Es el principio: dibujar un botón que no lleva a ningún lado es peor
		// que no dibujarlo.
		expect(atrasDesde('lista')).toBeNull();
	});
});
