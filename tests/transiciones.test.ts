/**
 * Las transiciones `out-in` del lector y de la lista, y el foco que las cruza.
 *
 * Con `RevealTransition mode="out-in"` lo que sale sigue montado mientras se
 * va, y lo que entra se monta **después**. Todo lo que antes se resolvía con un
 * `nextTick` —llevar el foco al botón de volver, o a una fila— buscaba el
 * elemento nuevo cuando todavía estaba el viejo. Lo que se comprueba acá es que
 * el foco llegue al elemento que quedó, no al que se estaba yendo.
 *
 * # Por qué las transiciones van de verdad
 *
 * `@vue/test-utils` reemplaza `<Transition>` por un doble que cambia el
 * contenido al instante: con él, `out-in` no existe y estas pruebas pasarían con
 * o sin el arreglo del foco. Se apaga el doble (`stubs: { transition: false }`).
 * happy-dom no evalúa el CSS, así que la salida termina sola en el cuadro
 * siguiente; se espera avanzando cuadros hasta que se cumpla lo que se mira, sin
 * dormir un tiempo fijo.
 */

import { afterEach, beforeAll, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import MessageComponent from '@/components/mail/MessageComponent.vue';
import MessageListComponent from '@/components/mail/MessageListComponent.vue';
import type { Abierto, Resumen } from '@/composables/use-correo';
import { ROW_SELECTORS } from '@/tools/focus';
import { olvidarTodo } from './dobles';

setDefaultTimeout(30_000);

let vista: VueWrapper | null = null;
let fuera: HTMLButtonElement | null = null;

afterEach(() => {
	vista?.unmount();
	vista = null;
	fuera?.remove();
	fuera = null;
	olvidarTodo();
});

const CON_TRANSICIONES = { global: { stubs: { transition: false } } };

function mensaje(uid: number, asunto: string): Resumen {
	return {
		account_id: 'cuenta',
		casilla: 'INBOX',
		uid,
		de: 'Quien Sea',
		direccion: 'quien@ejemplo.org',
		asunto,
		fecha: '2026-09-20T10:00:00Z',
		sin_leer: false,
		con_adjuntos: false,
	};
}

/**
 * Avanza cuadros hasta que se cumpla `condicion`. Si no se cumple en un número
 * razonable de cuadros, la deja fallar en la aserción que sigue.
 */
async function hasta(condicion: () => boolean) {
	for (let i = 0; i < 60 && !condicion(); i++) {
		await flushPromises();
		await new Promise<void>((listo) => requestAnimationFrame(() => listo()));
	}
	await flushPromises();
}

/** Todos los cuadros que hagan falta para que las transiciones en curso terminen. */
async function asentar() {
	for (let i = 0; i < 8; i++) {
		await flushPromises();
		await new Promise<void>((listo) => requestAnimationFrame(() => listo()));
	}
	await flushPromises();
}

const botonVolver = () => vista?.findAll('button').find((b) => b.text().trim() === 'mensaje.volver');

describe('el lector de mensajes', () => {
	const CUERPO: Abierto = {
		texto: 'Hola',
		recortado: false,
		adjuntos: [],
		con_formato: null,
		message_id: '<1@ejemplo.org>',
		referencias: [],
		responder_a: 'quien@ejemplo.org',
		nombre: 'Quien Sea',
	};

	const PROPS_BASE = {
		panel: 'message' as const,
		abierto: null as Resumen | null,
		cuerpo: null as Abierto | null,
		cargando: false,
	};

	function montar(abierto: Resumen | null) {
		vista = mount(MessageComponent, {
			attachTo: document.body,
			props: { ...PROPS_BASE, abierto },
			...CON_TRANSICIONES,
		});
		return vista;
	}

	beforeAll(async () => {
		// Compilar el componente y su árbol pasa los cinco segundos la primera vez.
		mount(MessageComponent, { props: PROPS_BASE }).unmount();
	}, 60_000);

	test('sin mensaje abierto se ve el aviso de elegir uno, y ningún encabezado', async () => {
		const v = montar(null);
		await asentar();

		expect(v.text()).toContain('mensaje.elegiUno');
		expect(v.find('h1').exists()).toBe(false);
		expect(botonVolver()).toBeUndefined();
	});

	test('con un mensaje abierto se ve su encabezado, y ya no el aviso', async () => {
		const v = montar(mensaje(1, 'Fotos del viaje'));
		await asentar();

		expect(v.find('h1').text()).toBe('Fotos del viaje');
		expect(v.text()).not.toContain('mensaje.elegiUno');
		expect(botonVolver()).toBeDefined();
	});

	test('mientras carga se ve el estado de carga bajo el encabezado, no el cuerpo', async () => {
		const v = montar(mensaje(1, 'uno'));
		await v.setProps({ cargando: true });
		await asentar();

		expect(v.text()).toContain('lista.cargando');
		expect(v.text()).not.toContain('Hola');
	});

	test('y cuando llega el cuerpo, se ve el texto', async () => {
		const v = montar(mensaje(1, 'uno'));
		await v.setProps({ cuerpo: CUERPO });
		await asentar();

		expect(v.text()).toContain('Hola');
		expect(v.text()).not.toContain('lista.cargando');
	});

	test('cambiar de mensaje deja el encabezado del nuevo y ninguno del anterior', async () => {
		const v = montar(mensaje(1, 'el primero'));
		await asentar();
		await v.setProps({ abierto: mensaje(2, 'el segundo') });
		await asentar();

		expect(v.findAll('h1')).toHaveLength(1);
		expect(v.find('h1').text()).toBe('el segundo');
	});

	test('al abrir uno desde el aviso, el foco va al botón de volver ya montado', async () => {
		// El caso de `watch(backButton)`: el aviso sale primero y el botón existe
		// recién después. El `nextTick` de `watch(abierto)` corre antes y no lo
		// encuentra.
		const v = montar(null);
		await asentar();
		await v.setProps({ abierto: mensaje(1, 'uno') });
		await hasta(() => botonVolver() !== undefined);
		await asentar();

		const boton = botonVolver()?.element;
		expect(boton).toBeDefined();
		expect(boton?.isConnected).toBe(true);
		expect(document.activeElement === boton).toBe(true);
	});

	test('al cambiar de mensaje, el foco va al botón del nuevo y no al del que se fue', async () => {
		// Mientras el viejo sale, su botón sigue en el documento: enfocarlo
		// dejaba el foco en un elemento que desaparecía un momento después.
		const v = montar(mensaje(1, 'el primero'));
		await asentar();
		const viejo = botonVolver()?.element;
		expect(viejo).toBeDefined();

		await v.setProps({ abierto: mensaje(2, 'el segundo') });
		await asentar();

		const nuevo = botonVolver()?.element;
		expect(nuevo).toBeDefined();
		expect(nuevo === viejo).toBe(false);
		expect(viejo?.isConnected).toBe(false);
		expect(document.activeElement === nuevo).toBe(true);
	});

	test('al cerrar el mensaje no se enfoca nada y queda el aviso', async () => {
		const v = montar(mensaje(1, 'uno'));
		await asentar();
		await v.setProps({ abierto: null });
		await asentar();

		expect(v.text()).toContain('mensaje.elegiUno');
		expect(v.find('h1').exists()).toBe(false);
		expect(document.activeElement === document.body).toBe(true);
	});

	test('las transiciones no dejan avisos de Vue (un solo hijo por rama)', async () => {
		// `<Transition>` avisa si una rama dibuja más de un nodo raíz o un
		// fragmento: se vería sin animar y sin error.
		const avisos = spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const v = montar(null);
			await asentar();
			await v.setProps({ abierto: mensaje(1, 'uno'), cargando: true });
			await asentar();
			await v.setProps({ cargando: false, cuerpo: CUERPO });
			await asentar();
			await v.setProps({ abierto: mensaje(2, 'dos'), cuerpo: null });
			await asentar();
			await v.setProps({ abierto: null });
			await asentar();

			expect(avisos.mock.calls.map((llamada) => String(llamada[0]))).toEqual([]);
		} finally {
			avisos.mockRestore();
		}
	});
});

describe('la lista de mensajes', () => {
	const PROPS_BASE = {
		panel: 'list' as const,
		mensajes: [] as Resumen[],
		abierto: null as Resumen | null,
		cargando: false,
		combinada: false,
		cuentas: [],
		carpeta: 'INBOX',
		consulta: '',
		queSeVe: 'todo' as const,
		buscandoEnElServidor: false,
	};

	const TRES = [mensaje(1, 'uno'), mensaje(2, 'dos'), mensaje(3, 'tres')];

	function montar(props: Partial<typeof PROPS_BASE> & Record<string, unknown> = {}) {
		vista = mount(MessageListComponent, {
			attachTo: document.body,
			props: { ...PROPS_BASE, ...props },
			...CON_TRANSICIONES,
		});
		return vista;
	}

	const filas = () => vista?.findAll(ROW_SELECTORS.first) ?? [];
	const buscador = () => vista?.find('input[type="search"]').element as HTMLInputElement;

	beforeAll(async () => {
		mount(MessageListComponent, { props: PROPS_BASE }).unmount();
	}, 60_000);

	test('cargando y sin nada todavía, se ve el estado de carga y no la lista', async () => {
		const v = montar({ cargando: true });
		await asentar();

		expect(v.text()).toContain('lista.cargando');
		expect(v.text()).not.toContain('lista.vacia');
		expect(filas()).toHaveLength(0);
	});

	test('sin mensajes y sin cargar, se ve que está vacía', async () => {
		const v = montar();
		await asentar();

		expect(v.text()).toContain('lista.vacia');
		expect(v.text()).not.toContain('lista.cargando');
		expect(filas()).toHaveLength(0);
	});

	test('con mensajes se ven las filas, y ninguno de los dos avisos', async () => {
		const v = montar({ mensajes: TRES });
		await asentar();

		expect(filas()).toHaveLength(3);
		expect(v.text()).not.toContain('lista.vacia');
		expect(v.text()).not.toContain('lista.cargando');
	});

	test('pasar de cargando a la lista deja sólo la lista', async () => {
		const v = montar({ cargando: true });
		await asentar();
		await v.setProps({ cargando: false, mensajes: TRES });
		await asentar();

		expect(filas()).toHaveLength(3);
		expect(v.text()).not.toContain('lista.cargando');
	});

	test('Escape en una búsqueda sin resultados lleva el foco a la fila cuando la lista vuelve', async () => {
		// Escape limpia la búsqueda: la lista vuelve, pero con `out-in` primero
		// sale el aviso de «vacía», así que en el `nextTick` del manejador no hay
		// ninguna fila y el foco cae en el panel. Al montarse la lista, el `watch`
		// de las filas lo lleva a donde corresponde.
		const abierto = TRES[1];
		let lista: VueWrapper | null = null;
		lista = montar({
			mensajes: [],
			abierto,
			consulta: 'algo',
			onLimpiar: () => {
				lista?.setProps({ mensajes: TRES, consulta: '' });
			},
		});
		await asentar();
		buscador().focus();
		expect(document.activeElement === buscador()).toBe(true);

		await lista.find('input[type="search"]').trigger('keydown', { key: 'Escape' });
		await hasta(() => filas().length === TRES.length);
		await asentar();

		const filaAbierta = lista.find(ROW_SELECTORS.open);
		expect(filaAbierta.exists()).toBe(true);
		expect(document.activeElement === filaAbierta.element).toBe(true);
	});

	test('y sin ninguno abierto, a la primera fila', async () => {
		let lista: VueWrapper | null = null;
		lista = montar({
			consulta: 'algo',
			onLimpiar: () => {
				lista?.setProps({ mensajes: TRES, consulta: '' });
			},
		});
		await asentar();
		buscador().focus();

		await lista.find('input[type="search"]').trigger('keydown', { key: 'Escape' });
		await hasta(() => filas().length === TRES.length);
		await asentar();

		expect(document.activeElement === filas()[0].element).toBe(true);
	});

	test('si el foco está en el buscador cuando llega la lista, no se lo roba', async () => {
		// Escribir una búsqueda que pasa de «sin resultados» a tener alguno
		// monta la lista con el foco en el campo: quitarlo ahí interrumpiría a
		// quien está tecleando.
		const v = montar({ consulta: 'a' });
		await asentar();
		buscador().focus();

		await v.setProps({ mensajes: TRES });
		await hasta(() => filas().length === TRES.length);
		await asentar();

		expect(document.activeElement === buscador()).toBe(true);
	});

	test('ni el que está en otra parte de la ventana', async () => {
		fuera = document.createElement('button');
		document.body.appendChild(fuera);
		const v = montar();
		await asentar();
		fuera.focus();

		await v.setProps({ mensajes: TRES });
		await hasta(() => filas().length === TRES.length);
		await asentar();

		expect(document.activeElement === fuera).toBe(true);
	});

	test('las transiciones no dejan avisos de Vue (un solo hijo por rama)', async () => {
		const avisos = spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const v = montar({ cargando: true });
			await asentar();
			await v.setProps({ cargando: false, mensajes: TRES });
			await asentar();
			await v.setProps({ mensajes: [] });
			await asentar();

			expect(avisos.mock.calls.map((llamada) => String(llamada[0]))).toEqual([]);
		} finally {
			avisos.mockRestore();
		}
	});
});
