import { describe, expect, test } from 'bun:test';
import { claveDe, combinados, esElMismo, type Identificable, TODAS } from '../src/tools/bandeja';

function mensaje(account_id: string, uid: number, fecha: string, casilla = 'INBOX'): Identificable {
	return { account_id, casilla, uid, fecha };
}

describe('claveDe', () => {
	test('el mismo uid en dos cuentas son dos mensajes', () => {
		// **La trampa de toda esta función.** El `uid` es el número que le puso su
		// servidor dentro de su carpeta: el 7 de una cuenta y el 7 de otra son dos
		// mensajes distintos con el mismo número.
		expect(claveDe(mensaje('trabajo', 7, ''))).not.toBe(claveDe(mensaje('casa', 7, '')));
	});

	test('el mismo uid en dos carpetas también', () => {
		// Y pasa dentro de una sola cuenta: los `uid` se cuentan por carpeta.
		expect(claveDe(mensaje('casa', 7, '', 'INBOX'))).not.toBe(
			claveDe(mensaje('casa', 7, '', 'Sent'))
		);
	});

	test('dos referencias al mismo mensaje dan la misma clave', () => {
		// La fecha no entra en la clave: el mismo mensaje traído dos veces puede
		// venir con la fecha vacía una de ellas.
		expect(claveDe(mensaje('casa', 7, '2026-09-15T10:00:00+00:00'))).toBe(
			claveDe(mensaje('casa', 7, ''))
		);
	});

	test('los nombres de carpeta con separadores adentro no chocan', () => {
		// Una carpeta de IMAP puede llamarse «[Gmail]/Enviados» o «Todos los
		// mensajes»: no hay carácter suelto que sirva de separador, porque con
		// cualquiera de ellos `a` + `b:c` y `a:b` + `c` dan la misma clave.
		expect(claveDe(mensaje('a', 1, '', 'b:c'))).not.toBe(claveDe(mensaje('a:b', 1, '', 'c')));
		expect(claveDe(mensaje('a', 1, '', 'b c'))).not.toBe(claveDe(mensaje('a b', 1, '', 'c')));
		expect(claveDe(mensaje('a', 1, '', 'b/c'))).not.toBe(claveDe(mensaje('a/b', 1, '', 'c')));
	});
});

describe('esElMismo', () => {
	test('nada es el mismo que nada', () => {
		// Sin esto, «no hay ninguno abierto» se comparaba consigo mismo y daba
		// verdadero: la lista marcaba una fila como abierta sin que lo estuviera.
		expect(esElMismo(null, null)).toBe(false);
		expect(esElMismo(mensaje('casa', 1, ''), null)).toBe(false);
		expect(esElMismo(null, mensaje('casa', 1, ''))).toBe(false);
	});

	test('compara las tres partes y no sólo el número', () => {
		expect(esElMismo(mensaje('casa', 7, ''), mensaje('casa', 7, ''))).toBe(true);
		expect(esElMismo(mensaje('casa', 7, ''), mensaje('trabajo', 7, ''))).toBe(false);
		expect(esElMismo(mensaje('casa', 7, '', 'INBOX'), mensaje('casa', 7, '', 'Sent'))).toBe(false);
	});
});

describe('combinados', () => {
	test('junta las cuentas y ordena de lo más nuevo a lo más viejo', () => {
		const combinada = combinados([
			[
				mensaje('casa', 1, '2026-09-15T08:00:00+00:00'),
				mensaje('casa', 2, '2026-09-15T12:00:00+00:00'),
			],
			[mensaje('trabajo', 1, '2026-09-15T10:00:00+00:00')],
		]);

		expect(combinada.map((m) => `${m.account_id}/${m.uid}`)).toEqual([
			'casa/2',
			'trabajo/1',
			'casa/1',
		]);
	});

	test('los que no traen fecha van al final', () => {
		// Tratarlos como el año cero los pondría **primero**, que llena el tope de
		// la bandeja con lo que menos se sabe.
		const combinada = combinados([
			[mensaje('casa', 1, ''), mensaje('casa', 2, 'no es una fecha')],
			[mensaje('trabajo', 1, '2020-01-01T00:00:00+00:00')],
		]);

		expect(combinada[0].account_id).toBe('trabajo');
		expect(combinada.slice(1).every((m) => m.account_id === 'casa')).toBe(true);
	});

	test('dos mensajes del mismo segundo salen siempre en el mismo orden', () => {
		// Una lista de correo los manda en el mismo segundo. Sin desempate, el
		// orden depende de en qué orden contestaron las cuentas, y la lista se
		// reordena sola entre una actualización y la siguiente.
		const misma = '2026-09-15T10:00:00+00:00';
		const unOrden = combinados([[mensaje('casa', 1, misma)], [mensaje('trabajo', 1, misma)]]);
		const elOtro = combinados([[mensaje('trabajo', 1, misma)], [mensaje('casa', 1, misma)]]);

		expect(unOrden.map(claveDe)).toEqual(elOtro.map(claveDe));
	});

	test('una cuenta que no devolvió nada no rompe la lista', () => {
		// Es el caso de una cuenta recién conectada, o de una que falló: las otras
		// tienen que seguir viéndose.
		const combinada = combinados([[], [mensaje('trabajo', 1, '2026-09-15T10:00:00+00:00')], []]);
		expect(combinada).toHaveLength(1);
	});

	test('sin cuentas no hay nada que juntar', () => {
		expect(combinados([])).toEqual([]);
		expect(combinados([[], []])).toEqual([]);
	});
});

describe('TODAS', () => {
	test('no puede ser el identificador de una cuenta', () => {
		// Si lo fuera, elegir esa cuenta mostraría todas. Los identificadores los
		// da el servicio de cuentas y son alfanuméricos.
		expect(/^[A-Za-z0-9_-]+$/.test(TODAS)).toBe(false);
	});

	test('no es la cadena vacía', () => {
		// Vacío ya quiere decir «no hay ninguna cuenta conectada»: son dos estados
		// distintos, y confundirlos deja la ventana diciendo «no tenés correo»
		// cuando lo que pasa es que se está cargando todo.
		expect(TODAS).not.toBe('');
	});
});
