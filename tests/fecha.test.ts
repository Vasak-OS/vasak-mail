import { describe, expect, test } from 'bun:test';
import { cuando, esDeHoy } from '../src/tools/fecha';

/** Un jueves de septiembre a las seis de la tarde, hora local. */
const HOY = new Date(2026, 8, 10, 18, 0, 0);
const SIN_FECHA = 'Sin fecha';

describe('cuando', () => {
	test('un mensaje de hoy muestra la hora', () => {
		// Lo que la persona quiere saber de un correo de hoy es a qué hora.
		const alaMañana = new Date(2026, 8, 10, 9, 30, 0).toISOString();
		const salida = cuando(alaMañana, 'es', SIN_FECHA, HOY);

		expect(salida).toContain('9');
		expect(salida).toContain('30');
	});

	test('uno de otro día muestra el día y el mes', () => {
		// Y de uno viejo, qué día. En una lista donde todo dice la fecha
		// completa, la fecha no distingue nada.
		const ayer = new Date(2026, 8, 9, 9, 30, 0).toISOString();
		const salida = cuando(ayer, 'es', SIN_FECHA, HOY);

		expect(salida).toContain('9');
		expect(salida).not.toContain('30');
	});

	test('una fecha vacía o rota no se hace pasar por hoy', () => {
		// Mostrar la hora actual haría parecer recién llegado un mensaje de hace
		// tres años. El sincronizador manda la fecha vacía cuando el mensaje
		// traía una que no se entendió.
		for (const rota of ['', 'ayer', 'no es una fecha', '15/09/2026']) {
			expect(cuando(rota, 'es', SIN_FECHA, HOY)).toBe(SIN_FECHA);
		}
	});

	test('el mismo día del mes de otro mes no es hoy', () => {
		const mesPasado = new Date(2026, 7, 10, 18, 0, 0).toISOString();
		expect(cuando(mesPasado, 'es', SIN_FECHA, HOY)).not.toContain(':');
	});
});

describe('esDeHoy', () => {
	test('distingue la hora del día, del mes y del año', () => {
		expect(esDeHoy(new Date(2026, 8, 10, 0, 1), HOY)).toBe(true);
		expect(esDeHoy(new Date(2026, 8, 10, 23, 59), HOY)).toBe(true);
		expect(esDeHoy(new Date(2026, 8, 11), HOY)).toBe(false);
		expect(esDeHoy(new Date(2026, 9, 10), HOY)).toBe(false);
		expect(esDeHoy(new Date(2025, 8, 10), HOY)).toBe(false);
	});
});
