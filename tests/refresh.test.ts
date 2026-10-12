/**
 * Leer del almacén del sistema y el botón «Actualizar» (Vasak-OS/vasak-mail#66).
 *
 * Lo que se comprueba es lo que cruza el borde del `invoke`, porque es lo único
 * que el backend ve:
 *
 * - que abrir un mensaje que salió del almacén mande su número del almacén, y
 *   `null` si vino en vivo —sin él, abrirlo vuelve a ir al servidor aunque el
 *   cuerpo ya esté en disco—;
 * - que «Actualizar» le pida la vuelta al sincronizador **por las cuentas que
 *   se están mirando** y después relea, aunque el pedido falle;
 * - y que el botón y el atajo de la ventana llamen a eso y no sólo a releer.
 */

import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { type Cuenta, type Resumen, useCorreo } from '@/composables/use-correo';
import { TODAS } from '@/tools/bandeja';
import MailView from '@/views/MailView.vue';
import { contestar, fallar, invocaciones, olvidarTodo } from './dobles';

// Montar la ventana entera la primera vez compila todo su árbol.
setDefaultTimeout(60_000);

const ANA: Cuenta = { account_id: 'ana', display_name: 'Ana', sin_leer: 0, error: '' };
const LUIS: Cuenta = { account_id: 'luis', display_name: 'Luis', sin_leer: 0, error: '' };

function resumen(cambios: Partial<Resumen> = {}): Resumen {
	return {
		account_id: 'ana',
		casilla: 'INBOX',
		uid: 7,
		de: 'Lucía',
		direccion: 'lucia@ejemplo.org',
		asunto: 'Hola',
		fecha: '2026-09-20T10:00:00Z',
		sin_leer: false,
		con_adjuntos: false,
		...cambios,
	};
}

/** Los argumentos de cada vez que se llamó a un comando. */
function argumentosDe(comando: string): unknown[] {
	return invocaciones.filter((i) => i.comando === comando).map((i) => i.args);
}

/** El orden en que se llamaron los comandos, sin argumentos. */
function comandos(): string[] {
	return invocaciones.map((i) => i.comando);
}

async function asentar() {
	for (let i = 0; i < 6; i++) await flushPromises();
}

afterEach(() => {
	olvidarTodo();
	// Las respuestas del backend se comparten entre archivos: se dejan como
	// estaban.
	contestar('listar_cuentas', []);
	contestar('listar_mensajes', []);
	contestar('open_message', undefined);
});

describe('abrir un mensaje', () => {
	test('el que salió del almacén se abre con su número del almacén', async () => {
		const correo = useCorreo();
		contestar('open_message', { texto: 'Hola', recortado: false, adjuntos: [] });

		await correo.abrir(resumen({ store_id: 41 }));

		expect(argumentosDe('open_message')).toEqual([
			{ accountId: 'ana', casilla: 'INBOX', uid: 7, storeId: 41 },
		]);
	});

	test('el que vino en vivo manda `null`, no se olvida la clave', async () => {
		// La clave va siempre, en `null`: el comando de Rust la declara y un
		// `undefined` no viaja en el JSON del `invoke`.
		const correo = useCorreo();

		await correo.abrir(resumen());
		await correo.abrir(resumen({ uid: 8, store_id: null }));

		expect(argumentosDe('open_message')).toEqual([
			{ accountId: 'ana', casilla: 'INBOX', uid: 7, storeId: null },
			{ accountId: 'ana', casilla: 'INBOX', uid: 8, storeId: null },
		]);
	});
});

describe('actualizar', () => {
	test('en la bandeja combinada pide la vuelta de todas las cuentas', async () => {
		contestar('listar_cuentas', [ANA, LUIS]);
		const correo = useCorreo();
		await correo.cargarCuentas();
		expect(correo.elegida.value).toBe(TODAS);
		invocaciones.length = 0;

		await correo.refresh();

		expect(argumentosDe('request_sync')).toEqual([{ accountIds: ['ana', 'luis'] }]);
	});

	test('con una cuenta elegida pide sólo la de esa cuenta', async () => {
		contestar('listar_cuentas', [ANA, LUIS]);
		const correo = useCorreo();
		await correo.cargarCuentas();
		await correo.elegir('luis');
		invocaciones.length = 0;

		await correo.refresh();

		expect(argumentosDe('request_sync')).toEqual([{ accountIds: ['luis'] }]);
	});

	test('sin nada elegido no pide la vuelta de ninguna cuenta', async () => {
		const correo = useCorreo();
		expect(correo.elegida.value).toBe('');

		await correo.refresh();

		expect(argumentosDe('request_sync')).toEqual([{ accountIds: [] }]);
	});

	test('pide la vuelta y después relee lo que hay', async () => {
		contestar('listar_cuentas', [ANA]);
		const correo = useCorreo();

		await correo.refresh();

		const orden = comandos();
		expect(orden).toContain('request_sync');
		expect(orden).toContain('listar_cuentas');
		expect(orden.indexOf('request_sync')).toBeLessThan(orden.indexOf('listar_cuentas'));
		// Y la relectura llegó a la lista: no basta con preguntar las cuentas.
		expect(argumentosDe('listar_mensajes')).toEqual([{ accountId: 'ana', casilla: 'INBOX' }]);
		expect(correo.elegida.value).toBe('ana');
	});

	test('si el pedido al sincronizador falla, igual relee', async () => {
		// El almacén tiene un límite por llamante: que diga que no es lo
		// esperable, y lo que ya está se tiene que seguir viendo al día.
		contestar('listar_cuentas', [ANA]);
		fallar('request_sync', 'límite por llamante');
		const correo = useCorreo();
		const errorDeConsola = console.error;
		console.error = () => {};
		try {
			await correo.refresh();
		} finally {
			console.error = errorDeConsola;
		}

		expect(comandos()).toContain('listar_cuentas');
		expect(correo.cuentas.value).toEqual([ANA]);
		expect(correo.error.value).toBe('');
	});
});

describe('la ventana', () => {
	let vista: VueWrapper | null = null;

	beforeAll(async () => {
		// Compilar la vista y su árbol la primera vez pasa los cinco segundos de
		// fábrica: se paga acá, con su propio límite.
		const calentar = mount(MailView);
		await asentar();
		calentar.unmount();
		olvidarTodo();
	}, 120_000);

	afterEach(() => {
		vista?.unmount();
		vista = null;
	});

	async function abrirLaVentana() {
		contestar('listar_cuentas', [ANA]);
		vista = mount(MailView, { attachTo: document.body });
		await asentar();
		invocaciones.length = 0;
		return vista;
	}

	test('el botón «Actualizar» le pide la vuelta al sincronizador', async () => {
		const ventana = await abrirLaVentana();
		const boton = ventana.find('button[title="lista.actualizar"]');
		expect(boton.exists()).toBe(true);

		await boton.trigger('click');
		await asentar();

		expect(argumentosDe('request_sync')).toEqual([{ accountIds: ['ana'] }]);
		expect(comandos()).toContain('listar_cuentas');
	});

	test('el atajo de actualizar también', async () => {
		await abrirLaVentana();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: '.' }));
		await asentar();

		expect(argumentosDe('request_sync')).toEqual([{ accountIds: ['ana'] }]);
	});
});
