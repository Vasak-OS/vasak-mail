/**
 * Cómo va la sincronización de cada cuenta, en la lista de cuentas
 * (Vasak-OS/vasak-mail#68).
 *
 * El estado sale de `syncStatus('email')` de `@vasakgroup/plugin-vsk-store`
 * (el `GetStatus` del almacén) y se relee con su aviso `STATUS_EVENT`, que
 * escucha la ventana; «Actualizar» guarda a qué cuentas no se les pudo pedir
 * una vuelta. `invoke` y `listen` son los dobles de `tests/dobles.ts`, por
 * debajo del paquete del plugin: el bus, la comprobación del dueño y
 * `syncLine` se prueban en el plugin.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import {
	type AccountSyncStatus,
	STATUS_EVENT,
	type SyncRequestFailure,
} from '@vasakgroup/plugin-vsk-store';
import { StatusDot } from '@vasakgroup/vue-libvasak';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import AccountsComponent from '@/components/mail/AccountsComponent.vue';
import { type Cuenta, useCorreo } from '@/composables/use-correo';
import { TODAS } from '@/tools/bandeja';
import MailView from '@/views/MailView.vue';
import { contestar, emit, fallar, invocaciones, olvidarTodo } from './dobles';

// Montar la ventana entera la primera vez compila todo su árbol.
setDefaultTimeout(60_000);

/** Los comandos del plugin del almacén, tal como los manda su paquete. */
const SYNC_STATUS = 'plugin:vsk-store|sync_status';
const REQUEST_SYNC = 'plugin:vsk-store|request_sync';

const ANA: Cuenta = { account_id: 'ana', display_name: 'Ana', sin_leer: 0, error: '' };
const LUIS: Cuenta = { account_id: 'luis', display_name: 'Luis', sin_leer: 0, error: '' };

const STATUSES: AccountSyncStatus[] = [
	{ account_id: 'ana', state: 'syncing', detail: '', last_synced_at: null },
	{ account_id: 'luis', state: 'failed', detail: 'clave rechazada', last_synced_at: null },
];

function timesInvoked(comando: string): number {
	return invocaciones.filter((i) => i.comando === comando).length;
}

async function asentar() {
	for (let i = 0; i < 6; i++) await flushPromises();
}

/** Corre `fn` sin ensuciar la salida con los `console.error` esperados. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
	const real = console.error;
	console.error = () => {};
	try {
		return await fn();
	} finally {
		console.error = real;
	}
}

// Otros archivos montan la ventana sin soltar sus oyentes ni olvidar lo que
// pidieron: se arranca de cero para contar sólo lo de cada prueba.
beforeEach(() => {
	olvidarTodo();
});

afterEach(() => {
	olvidarTodo();
	// Las respuestas del backend se comparten entre archivos: se dejan como
	// estaban.
	contestar('listar_cuentas', []);
	contestar(SYNC_STATUS, undefined);
	contestar(REQUEST_SYNC, undefined);
});

describe('el estado de la sincronización', () => {
	test('se lee el estado de cada cuenta del almacén', async () => {
		contestar(SYNC_STATUS, STATUSES);
		const correo = useCorreo();

		await correo.loadSyncStatus();

		expect(correo.syncStatuses.value).toEqual(STATUSES);
	});

	// El plugin sólo contesta las áreas que registró la aplicación: pedir otra,
	// o ninguna, deja la lista de cuentas sin estado y sin decir por qué.
	test('el estado se pide sólo del área del correo', async () => {
		contestar(SYNC_STATUS, STATUSES);
		const correo = useCorreo();

		await correo.loadSyncStatus();

		const pedidos = invocaciones.filter((i) => i.comando === SYNC_STATUS).map((i) => i.args);
		expect(pedidos).toEqual([{ area: 'email' }]);
	});

	test('una respuesta que no es una lista es ningún estado', async () => {
		contestar(SYNC_STATUS, { error: 'no' });
		const correo = useCorreo();

		await correo.loadSyncStatus();

		expect(correo.syncStatuses.value).toEqual([]);
	});

	test('si no se puede leer el estado, se queda el que había', async () => {
		contestar(SYNC_STATUS, STATUSES);
		const correo = useCorreo();
		await correo.loadSyncStatus();
		fallar(SYNC_STATUS, 'GetStatus: el servicio no existe');

		await quietly(() => correo.loadSyncStatus());

		expect(correo.syncStatuses.value).toEqual(STATUSES);
	});
});

describe('lo que «Actualizar» no pudo pedir', () => {
	test('se guarda qué cuentas rechazaron el pedido y por qué', async () => {
		contestar('listar_cuentas', [ANA, LUIS]);
		const failures: SyncRequestFailure[] = [{ account_id: 'luis', reason: 'denied' }];
		contestar(REQUEST_SYNC, failures);
		const correo = useCorreo();
		await correo.cargarCuentas();

		await correo.refresh();

		expect(correo.refreshFailures.value).toEqual(failures);
	});

	test('un «Actualizar» que sale bien borra los rechazos del anterior', async () => {
		contestar('listar_cuentas', [ANA, LUIS]);
		contestar(REQUEST_SYNC, [{ account_id: 'luis', reason: 'failed' }]);
		const correo = useCorreo();
		await correo.cargarCuentas();
		await correo.refresh();
		contestar(REQUEST_SYNC, []);

		await correo.refresh();

		expect(correo.refreshFailures.value).toEqual([]);
	});

	test('si el programa no contesta en la bandeja combinada, todas las cuentas quedan sin servicio', async () => {
		contestar('listar_cuentas', [ANA, LUIS]);
		fallar(REQUEST_SYNC, 'el programa no contesta');
		const correo = useCorreo();
		await correo.cargarCuentas();
		expect(correo.elegida.value).toBe(TODAS);

		await quietly(() => correo.refresh());

		expect(correo.refreshFailures.value).toEqual([
			{ account_id: 'ana', reason: 'unavailable' },
			{ account_id: 'luis', reason: 'unavailable' },
		]);
	});

	test('si el programa no contesta con una cuenta elegida, sólo esa queda sin servicio', async () => {
		contestar('listar_cuentas', [ANA, LUIS]);
		fallar(REQUEST_SYNC, 'el programa no contesta');
		const correo = useCorreo();
		await correo.cargarCuentas();
		await correo.elegir('luis');

		await quietly(() => correo.refresh());

		expect(correo.refreshFailures.value).toEqual([{ account_id: 'luis', reason: 'unavailable' }]);
	});

	test('«Actualizar» también relee el estado', async () => {
		contestar('listar_cuentas', [ANA]);
		contestar(SYNC_STATUS, STATUSES);
		const correo = useCorreo();

		await correo.refresh();

		expect(correo.syncStatuses.value).toEqual(STATUSES);
	});

	test('el cambio de estado olvida «se acaba de pedir» y deja los demás rechazos', async () => {
		contestar('listar_cuentas', [ANA, LUIS]);
		contestar(REQUEST_SYNC, [
			{ account_id: 'ana', reason: 'too_soon' },
			{ account_id: 'luis', reason: 'denied' },
		]);
		const correo = useCorreo();
		await correo.cargarCuentas();
		await correo.refresh();
		contestar(SYNC_STATUS, STATUSES);

		await correo.onSyncStatusChanged();

		expect(correo.refreshFailures.value).toEqual([{ account_id: 'luis', reason: 'denied' }]);
		expect(correo.syncStatuses.value).toEqual(STATUSES);
	});
});

describe('la línea en la lista de cuentas', () => {
	let wrapper: VueWrapper | null = null;

	afterEach(() => {
		wrapper?.unmount();
		wrapper = null;
	});

	function accounts(props: Record<string, unknown>) {
		wrapper = mount(AccountsComponent, {
			props: {
				panel: 'list',
				cuentas: [ANA, LUIS],
				elegida: TODAS,
				casillas: [],
				casilla: 'INBOX',
				salientes: [],
				sinLeerEnTotal: 0,
				...props,
			},
		});
		return wrapper;
	}

	test('cada cuenta con estado tiene su línea, anunciada como estado', () => {
		const lines = accounts({ syncStatuses: STATUSES }).findAll('[data-testid="sync-status"]');

		expect(lines).toHaveLength(2);
		for (const line of lines) expect(line.attributes('role')).toBe('status');
		expect(lines[0].text()).toContain('sync.syncing');
		expect(lines[1].text()).toContain('sync.failed');
	});

	test('la línea no está dentro de la fila que se elige', () => {
		const line = accounts({ syncStatuses: STATUSES }).find('[data-testid="sync-status"]');

		expect(line.element.closest('[role="button"]')).toBeNull();
	});

	test('el punto lleva el tono y late mientras sincroniza', () => {
		const dots = accounts({ syncStatuses: STATUSES })
			.findAll('[data-testid="sync-status"]')
			.map((line) => line.findComponent(StatusDot));

		expect(dots.map((d) => d.props('tone'))).toEqual(['accent', 'error']);
		expect(dots.map((d) => Boolean(d.props('pulse')))).toEqual([true, false]);
	});

	test('lo que «Actualizar» no pudo pedir se dice debajo de esa cuenta', () => {
		const lines = accounts({
			syncStatuses: STATUSES,
			refreshFailures: [{ account_id: 'ana', reason: 'denied' }],
		}).findAll('[data-testid="sync-status"]');

		expect(lines[0].text()).toContain('sync.request.denied');
		expect(lines[0].findComponent(StatusDot).props('tone')).toBe('warning');
		expect(lines[1].text()).toContain('sync.failed');
	});

	test('una cuenta sin estado ni rechazo no tiene línea', () => {
		const lines = accounts({ syncStatuses: [STATUSES[0]] }).findAll('[data-testid="sync-status"]');

		expect(lines).toHaveLength(1);
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
		contestar('listar_cuentas', [ANA, LUIS]);
		vista = mount(MailView, { attachTo: document.body });
		await asentar();
		return vista;
	}

	test('muestra el estado del almacén debajo de cada cuenta', async () => {
		contestar(SYNC_STATUS, STATUSES);
		const ventana = await abrirLaVentana();

		const lines = ventana.findAll('[data-testid="sync-status"]');
		expect(lines.map((l) => l.text())).toEqual(['sync.syncing', 'sync.failed']);
	});

	test('el aviso de estado relee el estado y lo muestra, sin releer el correo', async () => {
		const ventana = await abrirLaVentana();
		expect(ventana.find('[data-testid="sync-status"]').exists()).toBe(false);
		contestar(SYNC_STATUS, STATUSES);
		invocaciones.length = 0;

		await emit(STATUS_EVENT);
		await asentar();

		expect(timesInvoked(SYNC_STATUS)).toBe(1);
		expect(timesInvoked('listar_cuentas')).toBe(0);
		expect(ventana.findAll('[data-testid="sync-status"]')).toHaveLength(2);
	});

	test('el botón «Actualizar» dice qué cuenta rechazó el pedido', async () => {
		const ventana = await abrirLaVentana();
		contestar(REQUEST_SYNC, [{ account_id: 'luis', reason: 'too_soon' }]);

		await ventana.find('button[title="lista.actualizar"]').trigger('click');
		await asentar();

		const lines = ventana.findAll('[data-testid="sync-status"]');
		expect(lines.map((l) => l.text())).toEqual(['sync.request.too_soon']);
	});

	test('al cerrar la ventana deja de escuchar el estado', async () => {
		await abrirLaVentana();
		vista?.unmount();
		vista = null;
		invocaciones.length = 0;

		await emit(STATUS_EVENT);
		await asentar();

		expect(timesInvoked(SYNC_STATUS)).toBe(0);
	});

	test('cerrada antes de engancharse, tampoco queda escuchando el estado', async () => {
		contestar('listar_cuentas', [ANA]);
		const cerrada = mount(MailView, { attachTo: document.body });
		// Sin esperar: `listen` todavía no contestó cuando se cierra.
		cerrada.unmount();
		await asentar();
		invocaciones.length = 0;

		await emit(STATUS_EVENT);
		await asentar();

		expect(timesInvoked(SYNC_STATUS)).toBe(0);
	});
});
