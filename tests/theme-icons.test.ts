/**
 * Los iconos del correo siguen al tema, y la recarga va por el planificador.
 *
 * El correo no resuelve ningún icono: los pide por nombre a `ThemeIcon`. Lo que
 * se comprueba acá es que la recarga llegue por el planificador de la librería
 * y no en el acto.
 *
 * Importa porque hasta este cambio no era así, y nada lo decía: el manifiesto
 * pedía `^1.0.0`, que admite la 1.4.0, pero `bun.lock` había quedado en la
 * 1.0.0 y se empaquetaba ésa. Un rango corregido no mueve el candado, así que
 * el correo venía con la librería de antes del planificador sin que ninguna
 * prueba ni el CI dijeran nada.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { olvidarLosIconosDelTema } from '@vasakgroup/vue-libvasak';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import CorreoView from '@/views/CorreoView.vue';
import { emit, olvidarTodo, setThemeIcon } from './dobles';

/**
 * Deja que terminen las promesas encadenadas del pedido del icono.
 *
 * Sólo microtareas: con el reloj detenido, un `setTimeout(0)` no vuelve nunca.
 */
async function settle(rounds = 8) {
	for (let i = 0; i < rounds; i++) {
		await nextTick();
		await Promise.resolve();
	}
}

/**
 * Adelanta el reloj hasta pasada la espera del planificador, y asienta.
 *
 * Con temporizadores falsos y no con una espera de verdad. Las dos cosas que
 * hay que comprobar acá se pelean: que la recarga **todavía no** pasó justo
 * después del evento, y que **sí** pasa un poco más tarde. Con el reloj real la
 * primera falla de a ratos —si la máquina se demora, los 100 ms se cumplen
 * antes de la aserción— y con sólo un `nextTick` la segunda se vuelve vacía:
 * sin planificador la recarga tampoco llega a verse, así que la prueba pasaría
 * con la librería vieja. Comprobado: pasa.
 *
 * Con el reloj detenido no hay carrera. Se avanza a mano y en dos pasos,
 * porque el planificador `await`ea entre tandas y las microtareas tienen que
 * poder correr en el medio.
 */
async function advancePastReload() {
	for (let i = 0; i < 8; i++) {
		jest.advanceTimersByTime(40);
		await settle(2);
	}
}

/** El icono de la aplicación, que es el primero que dibuja la vista. */
const APP_ICON = 'internet-mail';

let mounted: VueWrapper | null = null;

function openMail() {
	mounted = mount(CorreoView);
	return mounted;
}

function iconSources(vista: VueWrapper): string[] {
	return vista.findAll('img').map((una) => una.attributes('src') ?? '');
}

beforeEach(() => {
	jest.useFakeTimers();
	olvidarTodo();
	// La memoria de la librería vive en su módulo y sobrevive entre archivos de
	// prueba: sin vaciarla, esto ve el icono que dejó otra.
	olvidarLosIconosDelTema();
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
	olvidarLosIconosDelTema();
	jest.useRealTimers();
});

describe('el correo dibuja sus iconos con el tema', () => {
	test('el de la aplicación sale del tema, por nombre', async () => {
		setThemeIcon(APP_ICON, 'data:image/svg+xml,correo-claro');

		const vista = openMail();
		await settle();

		expect(iconSources(vista)).toContain('data:image/svg+xml,correo-claro');
	});

	test('la recarga se agenda, no pasa en el acto', async () => {
		// Es lo que separa la 1.0.0 —la que se venía empaquetando— de la 1.4.0:
		// sin planificador el dibujo nuevo ya estaría acá. Con él, todavía no, y
		// por eso una ráfaga de anuncios —el tema de iconos y el de GTK llegan
		// juntos— no dispara dos barridos.
		setThemeIcon(APP_ICON, 'data:image/svg+xml,correo-claro');

		const vista = openMail();
		await settle();

		setThemeIcon(APP_ICON, 'data:image/svg+xml,correo-oscuro');
		await emit('vicons:theme-changed');
		// Todas las microtareas que quieran, sin mover el reloj: así el camino
		// **sin** planificador —que resuelve con promesas y nada más— llega a
		// terminar, y la aserción de abajo dice algo. Con el reloj detenido no
		// hay forma de que se cumplan los 100 ms por accidente.
		await settle();

		expect(iconSources(vista)).not.toContain('data:image/svg+xml,correo-oscuro');

		await advancePastReload();
		expect(iconSources(vista)).toContain('data:image/svg+xml,correo-oscuro');
	});
});
