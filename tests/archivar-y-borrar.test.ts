/**
 * Archivar y borrar el mensaje abierto (Vasak-OS/vasak-accounts#16).
 *
 * Lo que se comprueba es **a qué carpeta y a qué mensaje** viaja el pedido, y
 * qué le queda a la ventana después: el doble de `invoke` contesta igual con
 * o sin los argumentos correctos, así que se mira lo que se le pidió.
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { type Casilla, type Resumen, useCorreo } from '@/composables/use-correo';
import { contestar, fallar, invocaciones, olvidarTodo } from './dobles';

setDefaultTimeout(30_000);

function resumen(account: string, uid: number, casilla = 'INBOX'): Resumen {
	return {
		account_id: account,
		casilla,
		uid,
		de: 'Quien Sea',
		direccion: 'quien@ejemplo.org',
		asunto: `Mensaje ${uid}`,
		fecha: '2026-09-01T07:15:00Z',
		sin_leer: false,
		con_adjuntos: false,
	};
}

function carpeta(ruta: string, uso: string, seleccionable = true): Casilla {
	return { ruta, nombre: ruta, uso, seleccionable } as Casilla;
}

const movidos = () => invocaciones.filter((i) => i.comando === 'move_message');
const borrados = () => invocaciones.filter((i) => i.comando === 'delete_message');

afterEach(() => {
	olvidarTodo();
	contestar('listar_casillas', []);
	contestar('move_message', undefined);
	contestar('delete_message', undefined);
});

describe('archivar', () => {
	test('mueve a la carpeta de archivo de la cuenta del mensaje, no a la que está a la vista', async () => {
		// En la combinada las carpetas a la vista no son de ninguna cuenta: se
		// pregunta por las de la cuenta del mensaje.
		contestar('listar_casillas', [carpeta('INBOX', 'entrada'), carpeta('[Gmail]/Todos', 'archivo')]);
		contestar('move_message', '"entero"');
		const correo = useCorreo();

		const r = await correo.removeFromMailbox(resumen('ana', 7, 'Facturas'), 'archive');

		expect(r).toBe('done');
		const pedidas = invocaciones.find((i) => i.comando === 'listar_casillas');
		expect(pedidas?.args).toEqual({ accountId: 'ana' });
		expect(movidos()).toHaveLength(1);
		expect(movidos()[0].args).toEqual({
			accountId: 'ana',
			mailbox: 'Facturas',
			uid: 7,
			destination: '[Gmail]/Todos',
		});
	});

	test('una carpeta de archivo que no se puede elegir no cuenta', async () => {
		contestar('listar_casillas', [carpeta('Archivo', 'archivo', false)]);
		const correo = useCorreo();

		expect(await correo.removeFromMailbox(resumen('ana', 1), 'archive')).toBe('noArchive');
		expect(movidos()).toHaveLength(0);
	});

	test('sin carpeta de archivo no mueve nada y lo dice', async () => {
		contestar('listar_casillas', [carpeta('INBOX', 'entrada'), carpeta('Sent', 'enviados')]);
		const correo = useCorreo();

		expect(await correo.removeFromMailbox(resumen('ana', 1), 'archive')).toBe('noArchive');
		expect(movidos()).toHaveLength(0);
	});

	test('si el servidor no pudo sacar el original, se avisa que quedó', async () => {
		contestar('listar_casillas', [carpeta('Archivo', 'archivo')]);
		contestar('move_message', 'sin_borrar_el_viejo');
		const correo = useCorreo();

		expect(await correo.removeFromMailbox(resumen('ana', 1), 'archive')).toBe('keptOriginal');
	});

	test('si el original quedó, el mensaje sigue en la lista y abierto', async () => {
		contestar('listar_cuentas', [{ account_id: 'ana', display_name: 'Ana', sin_leer: 0, error: '' }]);
		contestar('listar_mensajes', [resumen('ana', 1), resumen('ana', 2)]);
		contestar('listar_casillas', [carpeta('Archivo', 'archivo')]);
		contestar('move_message', 'sin_borrar_el_viejo');
		const correo = useCorreo();
		await correo.cargarCuentas();
		await correo.abrir(correo.mensajes.value.find((m) => m.uid === 1) as Resumen);

		await correo.removeFromMailbox(resumen('ana', 1), 'archive');

		expect(correo.mensajes.value.map((m) => m.uid)).toEqual([1, 2]);
		expect(correo.abierto.value?.uid).toBe(1);
	});
});

describe('borrar', () => {
	test('un pedido nuevo borra el error que dejó el anterior', async () => {
		contestar('delete_message', '"entero"');
		const correo = useCorreo();
		correo.error.value = 'lo de antes';

		await correo.removeFromMailbox(resumen('ana', 3), 'delete');

		expect(correo.error.value).toBe('');
	});

	test('pide la papelera con la cuenta, la carpeta y el uid del mensaje', async () => {
		contestar('delete_message', '"entero"');
		const correo = useCorreo();

		const r = await correo.removeFromMailbox(resumen('ana', 9, 'Facturas'), 'delete');

		expect(r).toBe('done');
		expect(borrados()).toHaveLength(1);
		expect(borrados()[0].args).toEqual({ accountId: 'ana', mailbox: 'Facturas', uid: 9 });
		expect(movidos()).toHaveLength(0);
	});

	test('una cuenta sin papelera falla y deja el motivo a la vista', async () => {
		fallar('delete_message', 'la cuenta no tiene papelera');
		const correo = useCorreo();
		const m = resumen('ana', 9);

		expect(await correo.removeFromMailbox(m, 'delete')).toBe('failed');
		expect(correo.error.value).toContain('la cuenta no tiene papelera');
	});
});

describe('después de sacarlo', () => {
	async function conAbierto() {
		contestar('listar_cuentas', [{ account_id: 'ana', display_name: 'Ana', sin_leer: 0, error: '' }]);
		contestar('listar_mensajes', [resumen('ana', 1), resumen('ana', 2)]);
		const correo = useCorreo();
		await correo.cargarCuentas();
		await correo.abrir(correo.mensajes.value.find((m) => m.uid === 1) as Resumen);
		return correo;
	}

	test('sale de la lista y, si estaba abierto, se cierra', async () => {
		contestar('delete_message', '"entero"');
		const correo = await conAbierto();
		expect(correo.abierto.value?.uid).toBe(1);

		await correo.removeFromMailbox(resumen('ana', 1), 'delete');

		expect(correo.mensajes.value.map((m) => m.uid)).toEqual([2]);
		expect(correo.abierto.value).toBeNull();
	});

	test('sacar otro mensaje no cierra el que se está leyendo', async () => {
		contestar('delete_message', '"entero"');
		const correo = await conAbierto();

		await correo.removeFromMailbox(resumen('ana', 2), 'delete');

		expect(correo.mensajes.value.map((m) => m.uid)).toEqual([1]);
		expect(correo.abierto.value?.uid).toBe(1);
	});

	test('si falla, el mensaje sigue en la lista y abierto', async () => {
		fallar('delete_message', 'sin papelera');
		const correo = await conAbierto();

		expect(await correo.removeFromMailbox(resumen('ana', 1), 'delete')).toBe('failed');

		expect(correo.mensajes.value).toHaveLength(2);
		expect(correo.abierto.value?.uid).toBe(1);
	});
});

describe('uno por vez', () => {
	test('un segundo pedido sobre el mismo mensaje, en vuelo el primero, no hace nada', async () => {
		contestar('delete_message', '"entero"');
		const correo = useCorreo();
		const m = resumen('ana', 5);

		// Sin await entre los dos: el primero sigue en vuelo.
		const primero = correo.removeFromMailbox(m, 'delete');
		const segundo = correo.removeFromMailbox(m, 'delete');

		// No es un fallo: no deja ningún error a la vista.
		expect(await segundo).toBe('busy');
		expect(correo.error.value).toBe('');
		expect(await primero).toBe('done');
		expect(borrados()).toHaveLength(1);
	});

	test('cuando termina el primero, se puede volver a pedir', async () => {
		contestar('delete_message', '"entero"');
		const correo = useCorreo();
		const m = resumen('ana', 5);

		await correo.removeFromMailbox(m, 'delete');
		await correo.removeFromMailbox(m, 'delete');

		expect(borrados()).toHaveLength(2);
	});
});
