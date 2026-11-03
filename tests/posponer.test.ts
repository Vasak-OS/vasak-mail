/**
 * Posponer desde la ventana (Vasak-OS/vasak-accounts#22).
 *
 * Lo que se comprueba es **a qué mensaje y a qué hora** viaja el pedido y qué le
 * queda a la ventana: el doble de `invoke` contesta igual con o sin los
 * argumentos correctos, así que se mira lo que se le pidió.
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { type Cuenta, type Pospuesto, type Resumen, useCorreo } from '@/composables/use-correo';
import { enSegundos } from '@/tools/programar';
import { contestar, invocaciones, olvidarTodo } from './dobles';

setDefaultTimeout(30_000);

const ANA: Cuenta = { account_id: 'ana', display_name: 'Ana', sin_leer: 0, error: '' };

function resumen(uid: number, casilla = 'INBOX'): Resumen {
	return {
		account_id: 'ana',
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

function pospuesto(messageId: string, uid: number, volverA: number): Pospuesto {
	return {
		message_id: messageId,
		casilla_origen: 'INBOX',
		uid,
		uidvalidity: 1,
		volver_a: volverA,
	};
}

/** Una cuenta cargada y elegida, lista para posponer. */
async function conUnaCuenta() {
	contestar('listar_cuentas', [ANA]);
	contestar('listar_mensajes', [resumen(7)]);
	const correo = useCorreo();
	await correo.cargarCuentas();
	return correo;
}

const pospuestos = () => invocaciones.filter((i) => i.comando === 'snooze_message');
const cancelados = () => invocaciones.filter((i) => i.comando === 'cancel_snooze');

afterEach(() => {
	olvidarTodo();
});

describe('posponer', () => {
	test('manda la hora en segundos y saca el mensaje de la lista', async () => {
		const correo = await conUnaCuenta();
		contestar('snooze_message', undefined);
		// El servicio guarda la fila; la ventana la relee para armar el «Deshacer».
		contestar('list_snoozed', [pospuesto('<m1@x>', 7, 1_700_000_000)]);
		const cuando = new Date(1_700_000_000_000);

		const ok = await correo.posponer(resumen(7), cuando);

		expect(ok).toBe(true);
		expect(pospuestos()).toHaveLength(1);
		expect(pospuestos()[0].args).toEqual({
			accountId: 'ana',
			mailbox: 'INBOX',
			uid: 7,
			returnAt: enSegundos(cuando),
		});
		// El mensaje ya no está en la lista, y el aviso trae el id para deshacer.
		expect(correo.visibles.value.some((m) => m.uid === 7)).toBe(false);
		expect(correo.pospuestoReciente.value?.messageId).toBe('<m1@x>');
	});
});

describe('ver pospuestos', () => {
	test('los lista ordenados por hora de vuelta', async () => {
		const correo = await conUnaCuenta();
		contestar('list_snoozed', [
			pospuesto('<tarde@x>', 7, 2_000),
			pospuesto('<pronto@x>', 8, 1_000),
		]);

		await correo.verPospuestos();

		expect(correo.viendoPospuestos.value).toBe(true);
		expect(correo.pospuestos.value.map((p) => p.message_id)).toEqual(['<pronto@x>', '<tarde@x>']);
	});
});

describe('cancelar un posponer', () => {
	test('le pide al servicio devolver el mensaje', async () => {
		const correo = await conUnaCuenta();
		contestar('list_snoozed', [pospuesto('<m1@x>', 7, 1_000)]);
		await correo.verPospuestos();
		contestar('cancel_snooze', '"devuelto"');
		contestar('list_snoozed', []);

		const ok = await correo.cancelarPosponer('ana', '<m1@x>');

		expect(ok).toBe(true);
		expect(cancelados()).toHaveLength(1);
		expect(cancelados()[0].args).toEqual({ accountId: 'ana', messageId: '<m1@x>' });
	});
});
