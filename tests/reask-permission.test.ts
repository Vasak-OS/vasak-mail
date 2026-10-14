/**
 * El botón «pedir permiso de nuevo» del correo (ola 2 de «pedir permiso de
 * nuevo», pedido del 13/10/2026).
 *
 * Cuando la persona le dijo que no al almacén, leer el correo guardado devuelve
 * la marca `store-permission-denied`. La ventana no la muestra como un error
 * encima del correo: la lee como el estado de «sin permiso» y muestra un botón
 * que le pide a `vasak-permissions` que vuelva a preguntar (`RequestAgain`). Si
 * el servicio olvida la decisión, la ventana relee y esa lectura reabre el
 * diálogo; un re-pedido demasiado seguido o un fallo quedan dichos sin sacar el
 * estado «sin permiso».
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Cuenta, type Resumen, useCorreo } from '@/composables/use-correo';
import { STORE_PERMISSION_DENIED } from '@/tools/store-permission';
import MailView from '@/views/MailView.vue';
import { contestar, fallar, invocaciones, olvidarFallo, olvidarTodo } from './dobles';

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

async function asentar() {
	for (let i = 0; i < 8; i++) await flushPromises();
}

/** Cuántas veces se le pidió un comando al backend. */
function veces(comando: string): number {
	return invocaciones.filter((i) => i.comando === comando).length;
}

afterEach(() => {
	olvidarTodo();
	contestar('listar_cuentas', []);
	contestar('listar_mensajes', []);
	contestar('listar_casillas', []);
	contestar('leer_preferencias', '{}');
});

describe('la negativa del almacén, en la lógica de la ventana', () => {
	test('deja la lista en «sin permiso», no como un error encima del correo', async () => {
		contestar('listar_cuentas', [ANA]);
		fallar('listar_mensajes', STORE_PERMISSION_DENIED);
		const correo = useCorreo();

		await correo.cargarCuentas();

		expect(correo.sinPermiso.value).toBe(true);
		expect(correo.error.value).toBe('');
		expect(correo.mensajes.value).toEqual([]);
	});

	test('en la bandeja combinada el «no» es uno solo, no un fallo por cuenta', async () => {
		contestar('listar_cuentas', [ANA, LUIS]);
		fallar('listar_mensajes', STORE_PERMISSION_DENIED);
		const correo = useCorreo();

		await correo.cargarCuentas();

		// El mismo permiso para todas: el estado «sin permiso», sin ensuciar el
		// aviso de error con un «no se pudo» por cada cuenta.
		expect(correo.sinPermiso.value).toBe(true);
		expect(correo.error.value).toBe('');
	});

	test('volver a pedir y reabrir el diálogo relee y apaga el «sin permiso»', async () => {
		contestar('listar_cuentas', [ANA]);
		fallar('listar_mensajes', STORE_PERMISSION_DENIED);
		const correo = useCorreo();
		await correo.cargarCuentas();
		expect(correo.sinPermiso.value).toBe(true);

		// El servicio reabre el diálogo; la relectura ya trae el correo.
		olvidarFallo('listar_mensajes');
		contestar('listar_mensajes', [resumen()]);
		contestar('request_mail_access_again', { outcome: 'reopened' });

		const clave = await correo.pedirPermisoDeNuevo();

		expect(clave).toBe('');
		expect(correo.sinPermiso.value).toBe(false);
		expect(correo.mensajes.value).toHaveLength(1);
	});

	test('un re-pedido demasiado seguido lo dice y no relee', async () => {
		contestar('listar_cuentas', [ANA]);
		fallar('listar_mensajes', STORE_PERMISSION_DENIED);
		const correo = useCorreo();
		await correo.cargarCuentas();
		invocaciones.length = 0;

		contestar('request_mail_access_again', { outcome: 'too_soon' });
		const clave = await correo.pedirPermisoDeNuevo();

		expect(clave).toBe('permiso.limite');
		// No reabrió nada: no se relee, y el estado «sin permiso» sigue.
		expect(veces('listar_cuentas')).toBe(0);
		expect(correo.sinPermiso.value).toBe(true);
	});

	test('si no se pudo ni pedir, lo dice como un fallo', async () => {
		const correo = useCorreo();
		fallar('request_mail_access_again', 'el bus está cerrado');

		expect(await correo.pedirPermisoDeNuevo()).toBe('permiso.error');
	});
});

describe('la negativa del almacén, en la ventana montada', () => {
	let view: VueWrapper | null = null;
	afterEach(() => {
		view?.unmount();
		view = null;
	});

	const abrir = async () => {
		view = mount(MailView, { attachTo: document.body });
		await asentar();
		return view;
	};

	test('muestra el botón para volver a pedir el permiso', async () => {
		contestar('listar_cuentas', [ANA]);
		fallar('listar_mensajes', STORE_PERMISSION_DENIED);

		await abrir();

		const boton = view?.find('[data-reask-permission] button');
		expect(boton?.exists()).toBe(true);
		// Sin catálogo cargado, `t()` devuelve la clave: alcanza para saber que
		// el estado «sin permiso» es el que se pintó.
		expect(view?.text()).toContain('permiso.titulo');
	});

	test('al tocarlo se llama al comando y, si es demasiado seguido, lo dice', async () => {
		contestar('listar_cuentas', [ANA]);
		fallar('listar_mensajes', STORE_PERMISSION_DENIED);
		contestar('request_mail_access_again', { outcome: 'too_soon' });

		await abrir();
		invocaciones.length = 0;

		await view?.find('[data-reask-permission] button').trigger('click');
		await asentar();

		expect(veces('request_mail_access_again')).toBe(1);
		const aviso = view?.find('[data-reask-note]');
		expect(aviso?.exists()).toBe(true);
		expect(aviso?.text()).toContain('permiso.limite');
		// No reabrió: el botón sigue a la vista.
		expect(view?.find('[data-reask-permission] button').exists()).toBe(true);
	});
});

describe('los textos del estado «sin permiso»', () => {
	const raiz = join(import.meta.dir, '..');
	const leer = (ruta: string) => readFileSync(join(raiz, ruta), 'utf8');

	test('las claves del bloque están en los dos catálogos', () => {
		const claves = ['titulo', 'descripcion', 'pedir', 'limite', 'denegado', 'error'];
		for (const archivo of ['src-tauri/locales/es.yml', 'src-tauri/locales/en.yml']) {
			const texto = leer(archivo);
			const bloque = texto.slice(texto.indexOf('\npermiso:'));
			for (const clave of claves) {
				expect(bloque).toContain(`${clave}:`);
			}
		}
	});
});
