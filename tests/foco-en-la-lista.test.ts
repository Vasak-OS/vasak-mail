/**
 * Escape en el buscador, montando el componente de verdad.
 *
 * Es la prueba que el arreglo del foco no pudo traer consigo. En ese momento
 * `bun test` no compilaba `.vue`: el import devolvía la ruta como cadena y
 * `mount()` reventaba adentro de `@vue/test-utils` con un error que no nombra a
 * Vue por ningún lado. Lo que entró en su lugar —`foco.test.ts`— confronta los
 * selectores con la plantilla leída como texto, y cubre la regresión que
 * importa: que alguien mueva el `aria-current` y el selector deje de encontrar
 * la fila.
 *
 * Lo que esa prueba **no** puede cubrir, y ésta sí, es lo único que le importa a
 * quien usa el programa: dónde termina el foco. Que el orden de candidatos sea
 * correcto y que los selectores encuentren algo no dice que `focus()` se haya
 * llamado, ni que se haya llamado después del `nextTick` que espera a que la
 * lista se rearme, ni que la tecla llegue al manejador y no a otro.
 *
 * # Por qué se monta con `attachTo`
 *
 * `document.activeElement` sólo tiene sentido para elementos que están en el
 * documento. Montado en el aire, `focus()` no falla —no hace nada— y la prueba
 * pasaría con el foco en ninguna parte, que es exactamente el defecto que
 * busca.
 */

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import ListaComponent from '@/components/correo/ListaComponent.vue';
import type { Resumen } from '@/composables/use-correo';
import { olvidarTodo } from './dobles';

let vista: VueWrapper | null = null;

/**
 * El primer montaje del archivo, fuera de toda prueba.
 *
 * Compilar el componente y su árbol lleva más de diez segundos la primera vez
 * —Bun compila cada `.vue` al importarlo— y ese costo lo pagaba entero la
 * primera prueba que montara, que se pasaba del límite de cinco segundos y
 * fallaba por tiempo sin tener nada roto. Acá se paga una vez y con su propio
 * límite, y así lo que mide cada prueba es lo que de verdad tarda montar: si
 * alguna se vuelve lenta, se nota.
 */
beforeAll(async () => {
	const calentar = mount(ListaComponent, { props: PROPS_BASE });
	calentar.unmount();
}, 60_000);

afterEach(() => {
	vista?.unmount();
	vista = null;
	olvidarTodo();
});

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

/** Lo que el componente necesita para dibujarse; cada prueba cambia lo suyo. */
const PROPS_BASE = {
	panel: 'lista' as const,
	mensajes: [] as Resumen[],
	abierto: null as Resumen | null,
	cargando: false,
	combinada: false,
	cuentas: [],
	carpeta: 'INBOX',
	consulta: 'algo',
	queSeVe: 'local' as const,
	buscandoEnElServidor: false,
};

/** La lista, montada en el documento y con el buscador enfocado. */
async function abrirConElBuscadorEnfocado(
	mensajes: Resumen[],
	abierto: Resumen | null = null
) {
	vista = mount(ListaComponent, {
		attachTo: document.body,
		props: { ...PROPS_BASE, mensajes, abierto },
	});

	const campo = vista.find('input[type="search"]');
	(campo.element as HTMLInputElement).focus();
	expect(document.activeElement).toBe(campo.element);
	return { vista, campo };
}

/** Escape, y las dos vueltas que el manejador espera antes de enfocar. */
async function escapar(campo: ReturnType<VueWrapper['find']>) {
	await campo.trigger('keydown', { key: 'Escape' });
	// El manejador es `async` y espera un `nextTick` —limpiar cambia la lista—,
	// así que el foco se mueve un turno después de que la tecla vuelve.
	await Promise.resolve();
	await vista?.vm.$nextTick();
	await Promise.resolve();
}

describe('Escape en el buscador', () => {
	test('avisa que hay que limpiar', async () => {
		const { vista: v, campo } = await abrirConElBuscadorEnfocado([mensaje(1, 'uno')]);
		await escapar(campo);

		expect(v.emitted('limpiar')).toHaveLength(1);
	});

	test('y el foco sale del campo', async () => {
		// Es la mitad del arreglo: adentro del campo los atajos de una tecla no
		// se disparan a propósito —escribir una «r» tiene que escribir una «r»—,
		// así que quedarse ahí dejaba a `j` y `k` sin funcionar hasta apretar Tab.
		const { campo } = await abrirConElBuscadorEnfocado([mensaje(1, 'uno')]);
		await escapar(campo);

		expect(document.activeElement).not.toBe(campo.element);
	});

	test('vuelve al mensaje que se está leyendo', async () => {
		// La decisión entera: salir del buscador devuelve donde estabas. Con el
		// orden al revés, buscar algo y arrepentirse te movía de mensaje.
		const abierto = mensaje(2, 'el que estaba leyendo');
		const { vista: v, campo } = await abrirConElBuscadorEnfocado(
			[mensaje(1, 'uno'), abierto, mensaje(3, 'tres')],
			abierto
		);
		await escapar(campo);

		const fila = v.find('li button[aria-current="true"]');
		expect(fila.exists()).toBe(true);
		expect(document.activeElement).toBe(fila.element);
	});

	test('y sin ninguno abierto, a la primera fila', async () => {
		const { vista: v, campo } = await abrirConElBuscadorEnfocado([
			mensaje(1, 'uno'),
			mensaje(2, 'dos'),
		]);
		await escapar(campo);

		expect(document.activeElement).toBe(v.findAll('li button')[0].element);
	});

	test('con la lista vacía, el foco queda en el panel', async () => {
		// Sin este último recurso, una búsqueda sin resultados dejaba el foco en
		// el campo y la tecla no hacía nada visible, que es indistinguible de
		// estar rota.
		//
		// Se compara contra el panel **exacto** y no «que no sea el campo»: sin
		// filas, el panel todavía contiene el buscador y el botón de carpeta, y
		// una aserción negativa pasa igual si el foco termina en cualquiera de
		// los dos. Lo señaló la revisión.
		const { vista: v, campo } = await abrirConElBuscadorEnfocado([]);
		await escapar(campo);

		// La raíz lleva `tabindex="-1"` justamente para poder recibirlo.
		expect(v.element.getAttribute('tabindex')).toBe('-1');
		expect(document.activeElement).toBe(v.element);
	});
});

describe('el turno de espera', () => {
	test('enfoca la lista ya rearmada, no la que estaba', async () => {
		// El manejador espera un `nextTick` porque limpiar **cambia la lista**:
		// las filas que el filtro escondía vuelven, y la del mensaje abierto
		// puede no estar entre las que se ven. Enfocar antes de eso apunta a una
		// fila que está por desaparecer.
		//
		// Acá se reproduce entero: la búsqueda dejó a la vista un solo mensaje y
		// **el abierto no es ése**, así que antes del rearmado no hay ninguna
		// fila con `aria-current` y el foco caería en la primera de la lista
		// vieja. Se hace lo que hace la vista de verdad: al oír `limpiar`,
		// devolver los tres mensajes.
		const abierto = mensaje(2, 'el que estaba leyendo');
		const filtrados = [mensaje(9, 'lo único que coincidía')];
		const todos = [mensaje(1, 'uno'), abierto, mensaje(3, 'tres')];

		let lista: VueWrapper | null = null;
		lista = mount(ListaComponent, {
			attachTo: document.body,
			props: {
				...PROPS_BASE,
				mensajes: filtrados,
				abierto,
				onLimpiar: () => {
					lista?.setProps({ mensajes: todos, consulta: '' });
				},
			},
		});
		vista = lista;

		const campo = lista.find('input[type="search"]');
		(campo.element as HTMLInputElement).focus();
		await escapar(campo);

		const fila = lista.find('li button[aria-current="true"]');
		expect(fila.exists()).toBe(true);
		expect(fila.text()).toContain('el que estaba leyendo');
		expect(document.activeElement).toBe(fila.element);
	});
});
