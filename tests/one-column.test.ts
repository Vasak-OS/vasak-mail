/**
 * Una columna por vez en una ventana angosta, y las tres en una ancha.
 *
 * Hasta la 0.18 lo decidía `md:` —el ancho de la **pantalla**— y ahora lo
 * decide una consulta de contenedor sobre la fila de la ventana
 * (`@container/panes`). Lo que se comprueba acá:
 *
 * - que el corte del CSS y el de `tools/panes.ts` digan lo mismo, y que sea el
 *   que daba `md:` medido en la fila: con la barra arriba, la ventana cambia de
 *   formato exactamente en el mismo ancho que antes;
 * - que a 240, 360 y 600 px se vea una sola columna y a 1200 las tres;
 * - y, montando la ventana entera, que desde la lista se llegue a las carpetas
 *   y al mensaje, y que de los dos se vuelva a la lista.
 *
 * happy-dom no evalúa consultas de contenedor, así que lo que se mira montado
 * es qué panel lleva la clase que lo esconde en angosto. Que esa clase haga lo
 * que dice lo comprobaron las capturas del banco con Chrome (`apps-shots`).
 */

import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import AccountsComponent from '@/components/mail/AccountsComponent.vue';
import MessageComponent from '@/components/mail/MessageComponent.vue';
import MessageListComponent from '@/components/mail/MessageListComponent.vue';
import type { Abierto, Cuenta, Resumen } from '@/composables/use-correo';
import { ROW_SELECTORS } from '@/tools/focus';
import {
	HIDDEN_WHEN_NARROW,
	PANES,
	panesOnScreen,
	paneVisibility,
	THREE_PANES_MIN_WIDTH,
} from '@/tools/panes';
import MailView from '@/views/MailView.vue';
import { contestar, olvidarTodo } from './dobles';

const ROOT = new URL('..', import.meta.url).pathname;

// Montar la ventana entera y esperar sus cargas pasa los cinco segundos de
// fábrica cuando la máquina está cargada, sin tener nada roto.
setDefaultTimeout(60_000);

/**
 * Cuánto más angosta que la ventana es la fila: el canto del marco (1 px de
 * cada lado) y el relleno de la fila (`p-1`, 4 px de cada lado). Medido en el
 * banco con Chrome: a 768, 800 y 1200 px de ventana, la fila mide 758, 790 y
 * 1190.
 */
const FRAME_AND_PADDING = 10;

describe('el corte', () => {
	test('el CSS y `tools/panes.ts` dicen el mismo número', async () => {
		const css = await Bun.file(`${ROOT}src/assets/main.css`).text();
		const declared = css.match(/--container-three-panes:\s*(\d+)px;/);

		expect(declared?.[1]).toBe(String(THREE_PANES_MIN_WIDTH));
	});

	test('y es el de `md:` (768 px de ventana) medido en la fila', () => {
		expect(THREE_PANES_MIN_WIDTH + FRAME_AND_PADDING).toBe(768);
	});

	test('la fila de la ventana es el contenedor que se consulta', async () => {
		// Si la fila deja de ser `@container/panes`, las consultas no encuentran
		// contenedor y no aplican nunca: en angosto se verían las tres columnas
		// aplastadas, sin que nada falle.
		const view = await Bun.file(`${ROOT}src/views/MailView.vue`).text();

		expect(view).toMatch(/class="@container\/panes flex min-h-0 flex-1 gap-1 p-1"/);
	});

	test('y la clase que esconde es la de esa consulta, no una de pantalla', () => {
		expect(HIDDEN_WHEN_NARROW).toBe('@max-three-panes/panes:hidden');
	});
});

describe('qué se ve en cada ancho', () => {
	for (const width of [240, 360, 600]) {
		test(`a ${width} px se ve una sola columna, la que toca`, () => {
			for (const shown of PANES) {
				expect(panesOnScreen(width - FRAME_AND_PADDING, shown)).toEqual([shown]);
			}
		});
	}

	test('a 1200 px se ven las tres', () => {
		for (const shown of PANES) {
			expect(panesOnScreen(1200 - FRAME_AND_PADDING, shown)).toEqual(['folders', 'list', 'message']);
		}
	});

	test('el corte es justo en 768 px de ventana, como antes', () => {
		expect(panesOnScreen(767 - FRAME_AND_PADDING, 'list')).toEqual(['list']);
		expect(panesOnScreen(768 - FRAME_AND_PADDING, 'list')).toHaveLength(3);
	});

	test('el panel que toca nunca lleva la clase que lo esconde', () => {
		for (const shown of PANES) {
			const hidden = PANES.filter((pane) => paneVisibility(pane, shown) === HIDDEN_WHEN_NARROW);
			expect(hidden).toEqual(PANES.filter((pane) => pane !== shown));
		}
	});
});

const ACCOUNTS: Cuenta[] = [
	{ account_id: 'a1', display_name: 'ana@ejemplo.org', sin_leer: 1, error: '' },
	{ account_id: 'a2', display_name: 'ana@trabajo.example', sin_leer: 0, error: '' },
];

const MESSAGES: Omit<Resumen, 'account_id' | 'casilla'>[] = [
	{
		uid: 1,
		de: 'Lucía',
		direccion: 'lucia@ejemplo.org',
		asunto: 'Fotos del viaje',
		fecha: '2026-10-01T10:00:00Z',
		sin_leer: true,
		con_adjuntos: false,
	},
];

const OPENED: Abierto = {
	texto: 'Hola',
	recortado: false,
	adjuntos: [],
	con_formato: null,
	message_id: '<1@ejemplo.org>',
	referencias: [],
	responder_a: 'lucia@ejemplo.org',
	nombre: 'Lucía',
};

let view: VueWrapper | null = null;

beforeAll(async () => {
	// Compilar la vista y su árbol la primera vez pasa los cinco segundos de
	// fábrica: se paga acá, con su propio límite.
	const warm = mount(MailView);
	await flushPromises();
	warm.unmount();
}, 120_000);

afterEach(() => {
	view?.unmount();
	view = null;
	olvidarTodo();
	// Las respuestas del backend se comparten entre archivos: se dejan como
	// estaban, o la próxima ventana que se monte arranca con estas cuentas.
	contestar('listar_cuentas', []);
	contestar('listar_mensajes', []);
	contestar('abrir_mensaje', undefined);
});

async function settle() {
	for (let i = 0; i < 6; i++) await flushPromises();
}

async function openWindow() {
	contestar('listar_cuentas', ACCOUNTS);
	contestar('listar_mensajes', MESSAGES);
	contestar('abrir_mensaje', OPENED);
	view = mount(MailView, { attachTo: document.body });
	await settle();
	return view;
}

/** Cuál de los tres queda en pantalla en una ventana angosta. */
function shownWhenNarrow(window: VueWrapper): string[] {
	const panes: Array<[string, VueWrapper]> = [
		['folders', window.findComponent(AccountsComponent)],
		['list', window.findComponent(MessageListComponent)],
		['message', window.findComponent(MessageComponent)],
	];
	return panes.filter(([, pane]) => !pane.classes().includes(HIDDEN_WHEN_NARROW)).map(([name]) => name);
}

function buttonLabelled(window: VueWrapper, text: string) {
	const found = window.findAll('button').find((b) => b.text().trim() === text);
	if (!found) throw new Error(`no hay un botón «${text}»`);
	return found;
}

describe('en angosto, una columna por vez y siempre con vuelta', () => {
	test('al abrir se ve la lista y nada más', async () => {
		const window = await openWindow();

		expect(shownWhenNarrow(window)).toEqual(['list']);
	});

	test('el nombre de la carpeta lleva a las carpetas, y elegir una vuelve a la lista', async () => {
		const window = await openWindow();

		// El botón de la carpeta es el de la lista, con el nombre de lo que se
		// está mirando: en la combinada, «Todas las cuentas».
		const list = window.findComponent(MessageListComponent);
		const folderButton = list.findAll('button').find((b) => b.text().includes('cuentas.todas'));
		expect(folderButton).toBeDefined();
		await folderButton?.trigger('click');
		await settle();
		expect(shownWhenNarrow(window)).toEqual(['folders']);

		// Elegir una cuenta devuelve a la lista: quedarse en las carpetas
		// obligaría a un toque más para ver lo que se acaba de pedir.
		const account = window
			.findComponent(AccountsComponent)
			.findAll(ROW_SELECTORS.first)
			.find((row) => row.text().includes('ana@ejemplo.org'));
		await account?.trigger('click');
		await settle();
		expect(shownWhenNarrow(window)).toEqual(['list']);
	});

	test('una fila lleva al mensaje, y «Volver» a la lista', async () => {
		const window = await openWindow();

		await window.findComponent(MessageListComponent).find(ROW_SELECTORS.first).trigger('click');
		await settle();
		expect(shownWhenNarrow(window)).toEqual(['message']);

		await buttonLabelled(window.findComponent(MessageComponent), 'mensaje.volver').trigger('click');
		await settle();
		expect(shownWhenNarrow(window)).toEqual(['list']);
	});

	test('los botones de ir y volver se esconden cuando entran los tres', async () => {
		// En ancho no hay a dónde ir: las tres columnas están a la vista. Un
		// botón que no lleva a ningún lado confunde.
		const window = await openWindow();
		await window.findComponent(MessageListComponent).find(ROW_SELECTORS.first).trigger('click');
		await settle();

		const back = buttonLabelled(window.findComponent(MessageComponent), 'mensaje.volver');
		expect(back.classes()).toContain('@three-panes/panes:hidden');
		const folderRow = window
			.findComponent(MessageListComponent)
			.findAll('div')
			.find((d) => d.classes().includes('@three-panes/panes:hidden'));
		expect(folderRow?.find('button').exists()).toBe(true);
	});
});
