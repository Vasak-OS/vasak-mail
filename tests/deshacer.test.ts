import { describe, expect, test } from 'bun:test';
import { noAntesDe, quedan, SEGUNDOS_PARA_DESHACER } from '../src/tools/deshacer';

describe('noAntesDe', () => {
	test('suma los segundos y devuelve una hora en UTC', () => {
		const desde = new Date('2026-09-12T10:00:00.000Z');
		expect(noAntesDe(desde, 10)).toBe('2026-09-12T10:00:10.000Z');
	});

	/**
	 * Mandar una hora local sin zona haría salir el mensaje con horas de
	 * diferencia según dónde esté el equipo.
	 */
	test('siempre termina en Z', () => {
		expect(noAntesDe(new Date())).toEndWith('Z');
	});

	test('por omisión usa la ventana para deshacer', () => {
		const desde = new Date('2026-09-12T10:00:00.000Z');
		const esperado = new Date(desde.getTime() + SEGUNDOS_PARA_DESHACER * 1000);
		expect(noAntesDe(desde)).toBe(esperado.toISOString());
	});
});

describe('quedan', () => {
	const hasta = '2026-09-12T10:00:10.000Z';

	test('cuenta hacia atrás', () => {
		expect(quedan(hasta, new Date('2026-09-12T10:00:00.000Z'))).toBe(10);
		expect(quedan(hasta, new Date('2026-09-12T10:00:07.000Z'))).toBe(3);
	});

	/**
	 * Se calcula contra el reloj y no con un contador que se decrementa: un
	 * contador se atrasa cuando la ventana está en segundo plano o el equipo
	 * suspende, y el cartel terminaría ofreciendo deshacer algo que ya salió.
	 */
	test('no baja de cero aunque haya pasado mucho', () => {
		expect(quedan(hasta, new Date('2026-09-12T10:00:10.000Z'))).toBe(0);
		expect(quedan(hasta, new Date('2026-09-12T18:00:00.000Z'))).toBe(0);
	});

	test('una hora que no se entiende no ofrece deshacer nada', () => {
		// Cero quiere decir «ya no se puede», que es lo seguro: ofrecer deshacer
		// algo que ya salió es prometer lo que no se puede cumplir.
		expect(quedan('el jueves', new Date())).toBe(0);
		expect(quedan('', new Date())).toBe(0);
	});
});
