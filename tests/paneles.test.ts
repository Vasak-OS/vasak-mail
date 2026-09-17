import { describe, expect, test } from 'bun:test';
import { atrasDesde, hayQueRescatarElFoco, panelVisible } from '../src/tools/paneles';

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

/**
 * El rescate del foco al volver a la lista, y por qué tiene que mirar dónde
 * está el foco antes de moverlo.
 */
describe('hayQueRescatarElFoco', () => {
	test('al volver de un mensaje, sí', () => {
		// Es para lo que existe: el foco quedó en algo que ya no se dibuja.
		expect(hayQueRescatarElFoco('lista', 'mensaje', false)).toBe(true);
		expect(hayQueRescatarElFoco('lista', 'carpetas', false)).toBe(true);
	});

	/**
	 * La que importa. Con la tecla de buscar en una ventana angosta se vuelve a
	 * la lista **para** poder enfocar el buscador, y las dos cosas pasan en el
	 * mismo cambio de panel: sin esto, cuál gana depende de en qué orden Vue
	 * resuelva dos `nextTick`, y la mitad de las veces la tecla de buscar
	 * terminaba con el foco en el botón de la carpeta.
	 */
	test('pero no si el foco ya está adentro de la lista', () => {
		expect(hayQueRescatarElFoco('lista', 'mensaje', true)).toBe(false);
	});

	test('y no se hace nada si no se llegó a la lista', () => {
		expect(hayQueRescatarElFoco('mensaje', 'lista', false)).toBe(false);
		expect(hayQueRescatarElFoco('carpetas', 'lista', false)).toBe(false);
	});

	test('ni si ya se estaba en la lista', () => {
		// No hubo transición: nadie perdió el foco, no hay nada que rescatar.
		expect(hayQueRescatarElFoco('lista', 'lista', false)).toBe(false);
	});
});
