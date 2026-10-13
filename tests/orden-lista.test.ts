/**
 * El orden de la lista de una carpeta: lo más nuevo arriba (Vasak-OS/vasak-mail#73).
 *
 * La bandeja combinada siempre pasa por `combinados`, que ordena por fecha
 * descendente; la vista de una sola carpeta no lo hacía y mostraba lo que
 * llegara en el orden crudo. Cuando los mensajes salen del almacén del sistema
 * vienen ya ordenados (`ORDER BY sort_key DESC`), pero el camino en vivo —una
 * cuenta recién agregada, o el almacén apagado— devuelve el orden de IMAP, que
 * es por UID ascendente: lo más viejo primero. Ahí la carpeta única mostraba al
 * revés de lo que todo el mundo espera de un cliente de correo.
 *
 * Esta prueba fija una lista con fechas desordenadas —como la daría el camino en
 * vivo— y comprueba que la vista de carpeta única las muestra de la más nueva a
 * la más vieja, igual que la combinada.
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { type Cuenta, type Resumen, useCorreo } from '@/composables/use-correo';
import { TODAS } from '@/tools/bandeja';
import { contestar, olvidarTodo } from './dobles';

setDefaultTimeout(30_000);

const ANA: Cuenta = { account_id: 'ana', display_name: 'Ana', sin_leer: 0, error: '' };

function resumen(uid: number, fecha: string): Resumen {
	return {
		account_id: 'ana',
		casilla: 'INBOX',
		uid,
		de: 'Quien Sea',
		direccion: 'quien@ejemplo.org',
		asunto: `Mensaje ${uid}`,
		fecha,
		sin_leer: false,
		con_adjuntos: false,
	};
}

/** Las fechas de la lista, en el orden en que se ven. */
function fechasVisibles(correo: ReturnType<typeof useCorreo>): string[] {
	return correo.visibles.value.map((m) => m.fecha);
}

afterEach(() => {
	olvidarTodo();
});

describe('orden de la lista de una carpeta', () => {
	test('con una sola cuenta, los últimos emails van primero', async () => {
		// Como lo daría el camino en vivo (IMAP, por UID ascendente): lo más
		// viejo primero, justo al revés de lo que hay que mostrar.
		contestar('listar_cuentas', [ANA]);
		contestar('listar_mensajes', [
			resumen(1, '2026-01-10T08:00:00Z'),
			resumen(2, '2026-03-05T09:30:00Z'),
			resumen(3, '2026-02-20T12:00:00Z'),
			resumen(4, '2026-09-01T07:15:00Z'),
		]);

		const correo = useCorreo();
		await correo.cargarCuentas();

		// Una sola cuenta: es la vista de carpeta única, no la combinada.
		expect(correo.elegida.value).toBe('ana');
		expect(correo.combinada.value).toBe(false);

		expect(fechasVisibles(correo)).toEqual([
			'2026-09-01T07:15:00Z',
			'2026-03-05T09:30:00Z',
			'2026-02-20T12:00:00Z',
			'2026-01-10T08:00:00Z',
		]);
	});

	test('los mensajes sin fecha entendible quedan al fondo', async () => {
		contestar('listar_cuentas', [ANA]);
		contestar('listar_mensajes', [
			resumen(1, ''),
			resumen(2, '2026-04-01T10:00:00Z'),
			resumen(3, '2026-08-01T10:00:00Z'),
		]);

		const correo = useCorreo();
		await correo.cargarCuentas();

		expect(fechasVisibles(correo)).toEqual([
			'2026-08-01T10:00:00Z',
			'2026-04-01T10:00:00Z',
			'',
		]);
	});

	test('la combinada sigue mostrando lo más nuevo arriba', async () => {
		// La regresión no puede romper la vista que ya estaba bien.
		const LUIS: Cuenta = { account_id: 'luis', display_name: 'Luis', sin_leer: 0, error: '' };
		contestar('listar_cuentas', [ANA, LUIS]);
		contestar('listar_mensajes', [
			resumen(1, '2026-01-10T08:00:00Z'),
			resumen(2, '2026-09-05T09:30:00Z'),
		]);

		const correo = useCorreo();
		await correo.cargarCuentas();

		expect(correo.elegida.value).toBe(TODAS);
		expect(correo.combinada.value).toBe(true);
		// Cada cuenta trae la misma lista en vivo; lo que importa es que lo más
		// nuevo de todo quede arriba y lo más viejo al fondo.
		const fechas = fechasVisibles(correo);
		expect(fechas[0]).toBe('2026-09-05T09:30:00Z');
		expect(fechas[fechas.length - 1]).toBe('2026-01-10T08:00:00Z');
	});
});
