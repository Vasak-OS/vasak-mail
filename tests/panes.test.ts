import { describe, expect, test } from 'bun:test';
import { backFrom, shouldRescueFocus, visiblePane } from '../src/tools/panes';

/**
 * Qué se ve en una ventana angosta.
 *
 * La regla que importa es que el panel visible **se deduce** y no se guarda:
 * un estado paralelo sería uno que se desincroniza —abrir un mensaje con un
 * atajo y que el panel no cambie— y estas pruebas fijan que se deduzca bien.
 */
describe('visiblePane', () => {
	test('sin nada abierto se ve la lista', () => {
		expect(visiblePane(false, false)).toBe('list');
	});

	test('con un mensaje abierto se ve el mensaje', () => {
		// Y eso vale venga de un clic o de la tecla `j`: es la misma condición.
		expect(visiblePane(true, false)).toBe('message');
	});

	test('las carpetas ganan mientras se están eligiendo', () => {
		// Se acaban de pedir: son un paso atrás deliberado sobre lo que se
		// estaba mirando, incluso si había un mensaje abierto.
		expect(visiblePane(false, true)).toBe('folders');
		expect(visiblePane(true, true)).toBe('folders');
	});
});

describe('backFrom', () => {
	test('todo vuelve a la lista', () => {
		expect(backFrom('message')).toBe('list');
		expect(backFrom('folders')).toBe('list');
	});

	test('desde la lista no hay atrás', () => {
		// Es el principio: dibujar un botón que no lleva a ningún lado es peor
		// que no dibujarlo.
		expect(backFrom('list')).toBeNull();
	});
});

/**
 * El rescate del foco al volver a la lista, y por qué tiene que mirar dónde
 * está el foco antes de moverlo.
 */
describe('shouldRescueFocus', () => {
	test('al volver de un mensaje, sí', () => {
		// Es para lo que existe: el foco quedó en algo que ya no se dibuja.
		expect(shouldRescueFocus('list', 'message', false)).toBe(true);
		expect(shouldRescueFocus('list', 'folders', false)).toBe(true);
	});

	/**
	 * La que importa. Con la tecla de buscar en una ventana angosta se vuelve a
	 * la lista **para** poder enfocar el buscador, y las dos cosas pasan en el
	 * mismo cambio de panel: sin esto, cuál gana depende de en qué orden Vue
	 * resuelva dos `nextTick`, y la mitad de las veces la tecla de buscar
	 * terminaba con el foco en el botón de la carpeta.
	 */
	test('pero no si el foco ya está adentro de la lista', () => {
		expect(shouldRescueFocus('list', 'message', true)).toBe(false);
	});

	test('y no se hace nada si no se llegó a la lista', () => {
		expect(shouldRescueFocus('message', 'list', false)).toBe(false);
		expect(shouldRescueFocus('folders', 'list', false)).toBe(false);
	});

	test('ni si ya se estaba en la lista', () => {
		// No hubo transición: nadie perdió el foco, no hay nada que rescatar.
		expect(shouldRescueFocus('list', 'list', false)).toBe(false);
	});
});
