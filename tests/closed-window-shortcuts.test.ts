/**
 * Una ventana que se cierra antes de terminar de abrirse no deja sus atajos
 * andando. `onMounted` espera las preferencias antes de engancharse al
 * teclado, y si `onUnmounted` ya corrió nadie suelta ese oyente: el «.» de
 * otra ventana le pedía una vuelta al sincronizador dos veces.
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { flushPromises, mount } from '@vue/test-utils';
import MailView from '@/views/MailView.vue';
import { contestar, invocaciones, olvidarTodo } from './dobles';

setDefaultTimeout(60_000);

afterEach(() => {
	olvidarTodo();
	contestar('listar_cuentas', []);
});

describe('una ventana cerrada antes de abrirse del todo', () => {
	test('no deja el atajo de actualizar andando', async () => {
		contestar('listar_cuentas', [
			{ account_id: 'ana', display_name: 'Ana', sin_leer: 0, error: '' },
		]);
		const cerrada = mount(MailView, { attachTo: document.body });
		cerrada.unmount();
		for (let i = 0; i < 6; i++) await flushPromises();
		invocaciones.length = 0;

		window.dispatchEvent(new KeyboardEvent('keydown', { key: '.' }));
		for (let i = 0; i < 6; i++) await flushPromises();

		expect(invocaciones.map((i) => i.comando)).toEqual([]);
	});
});
