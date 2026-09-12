import { describe, expect, test } from 'bun:test';
import { elegida, momentos, paraElServicio } from '../src/tools/programar';

/**
 * Las horas que se ofrecen para programar.
 *
 * Se prueba con un reloj de mentira porque lo que puede salir mal son las
 * horas: una opción que ya pasó, un cambio de día, un fin de semana. Todo con
 * fechas locales, que es como las construye el módulo y como las piensa quien
 * elige.
 */
function local(texto: string): Date {
	return new Date(texto);
}

describe('momentos', () => {
	/**
	 * «Esta tarde» a las nueve de la noche es una hora anterior a ahora: el
	 * mensaje saldría en el acto, que es lo contrario de lo que se pidió.
	 */
	test('lo que ya pasó no se ofrece', () => {
		const deNoche = local('2026-09-15T21:00:00');
		const claves = momentos(deNoche).map((m) => m.clave);
		expect(claves).not.toContain('programar.estaTarde');
	});

	test('a la mañana se ofrece esta tarde', () => {
		const temprano = local('2026-09-15T09:00:00');
		const opciones = momentos(temprano);
		const tarde = opciones.find((m) => m.clave === 'programar.estaTarde');
		expect(tarde).toBeDefined();
		expect(tarde?.cuando.getHours()).toBe(18);
		expect(tarde?.cuando.getDate()).toBe(15);
	});

	test('mañana temprano se ofrece siempre', () => {
		for (const cuando of ['2026-09-15T09:00:00', '2026-09-15T23:59:00']) {
			const manana = momentos(local(cuando)).find(
				(m) => m.clave === 'programar.mananaTemprano'
			);
			expect(manana).toBeDefined();
			expect(manana?.cuando.getHours()).toBe(8);
		}
	});

	test('mañana temprano cruza el cambio de mes', () => {
		// El 30 de septiembre + 1 día es el 1 de octubre, no el 31 de septiembre.
		const finDeMes = momentos(local('2026-09-30T23:00:00')).find(
			(m) => m.clave === 'programar.mananaTemprano'
		);
		expect(finDeMes?.cuando.getMonth()).toBe(9); // octubre
		expect(finDeMes?.cuando.getDate()).toBe(1);
	});

	/** Es cuando alguien quiere que un correo de trabajo no llegue un sábado. */
	test('el lunes se ofrece desde el viernes', () => {
		// 2026-09-18 es viernes.
		const viernes = momentos(local('2026-09-18T15:00:00')).find(
			(m) => m.clave === 'programar.elLunes'
		);
		expect(viernes).toBeDefined();
		// Y cae en lunes de verdad: `getDay()` 1.
		expect(viernes?.cuando.getDay()).toBe(1);
		expect(viernes?.cuando.getDate()).toBe(21);
	});

	test('el lunes no se ofrece un martes', () => {
		// 2026-09-15 es martes.
		const claves = momentos(local('2026-09-15T15:00:00')).map((m) => m.clave);
		expect(claves).not.toContain('programar.elLunes');
	});

	test('un domingo, el lunes es mañana', () => {
		// 2026-09-20 es domingo.
		const lunes = momentos(local('2026-09-20T15:00:00')).find(
			(m) => m.clave === 'programar.elLunes'
		);
		expect(lunes?.cuando.getDay()).toBe(1);
		expect(lunes?.cuando.getDate()).toBe(21);
	});

	test('todas las opciones son futuras', () => {
		for (const cuando of [
			'2026-09-15T00:30:00',
			'2026-09-18T17:59:00',
			'2026-09-19T23:00:00',
			'2026-09-20T08:00:00',
		]) {
			const ahora = local(cuando);
			for (const m of momentos(ahora)) {
				expect(m.cuando.getTime()).toBeGreaterThan(ahora.getTime());
			}
		}
	});
});

describe('paraElServicio', () => {
	test('siempre en UTC', () => {
		// Mandar una hora local sin zona haría salir el mensaje con horas de
		// diferencia según dónde esté el equipo.
		expect(paraElServicio(new Date('2026-09-15T18:00:00Z'))).toBe('2026-09-15T18:00:00.000Z');
		expect(paraElServicio(local('2026-09-15T18:00:00'))).toEndWith('Z');
	});
});

describe('elegida', () => {
	const ahora = local('2026-09-15T12:00:00');

	test('lee lo que da el control de fecha y hora', () => {
		const cuando = elegida('2026-09-15T18:30', ahora);
		expect(cuando?.getHours()).toBe(18);
		expect(cuando?.getMinutes()).toBe(30);
	});

	/** Una hora anterior a ahora hace salir el mensaje en el acto. */
	test('una hora que ya pasó no vale', () => {
		expect(elegida('2026-09-15T08:00', ahora)).toBeNull();
		expect(elegida('2026-09-15T12:00', ahora)).toBeNull();
	});

	test('lo que no se entiende no vale', () => {
		expect(elegida('', ahora)).toBeNull();
		expect(elegida('el jueves', ahora)).toBeNull();
	});
});
