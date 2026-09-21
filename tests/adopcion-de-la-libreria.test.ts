/**
 * Lo que el correo dejó de dibujar por su cuenta.
 *
 * Los tres diálogos —atajos, preferencias y redactar— pasan a ser los de la
 * librería, el buscador de la lista al campo del sistema, y el icono de la
 * ventana a `ThemeIcon`.
 *
 * Lo que se comprueba es la promesa que dos de los tres **declaraban sin
 * cumplir**: tenían `role="dialog"` y `aria-modal="true"` y no hacían ninguna
 * de las cosas que eso promete. El foco no entraba, el Tab seguía recorriendo
 * la lista de mensajes de atrás y Escape no cerraba. Un lector de pantalla
 * anunciaba un diálogo modal mientras el teclado seguía en la pantalla
 * anterior.
 *
 * Se monta con `attachTo` porque `document.activeElement` sólo tiene sentido
 * para lo que está en el documento: en el aire, `focus()` no falla ni hace
 * nada, y la prueba pasaría con el foco en ninguna parte.
 */

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import AtajosComponent from '@/components/correo/AtajosComponent.vue';
import PreferenciasComponent from '@/components/correo/PreferenciasComponent.vue';
import RedactarComponent from '@/components/correo/RedactarComponent.vue';
import type { Borrador } from '@/composables/use-correo';
import { juego } from '@/tools/atajos';
import { olvidarTodo } from './dobles';

const RAIZ = new URL('..', import.meta.url).pathname;

const vistas = new Set<VueWrapper>();

function anotar<T extends VueWrapper>(vista: T): T {
	vistas.add(vista);
	return vista;
}

/**
 * El primer montaje del archivo, fuera de toda prueba.
 *
 * Bun compila cada `.vue` al importarlo, y ese costo lo pagaba entero la
 * primera prueba que montara: se pasaba del límite de cinco segundos y fallaba
 * por tiempo sin tener nada roto. Acá se paga una vez y con su propio límite.
 */
beforeAll(async () => {
	const calentar = mount(AtajosComponent, {
		props: { abierto: false, mapa: juego('gmail') },
	});
	calentar.unmount();
}, 60_000);

afterEach(() => {
	for (const vista of vistas) vista.unmount();
	vistas.clear();
	// El diálogo se teletransporta al `body`, así que no se lo lleva el
	// desmontaje: una prueba que falla dejaría su panel puesto y la siguiente
	// encontraría **ése** al preguntar por `[role="dialog"]`.
	for (const suelto of document.body.querySelectorAll('[role="dialog"]')) {
		suelto.parentElement?.remove();
	}
	olvidarTodo();
});

const elPanel = () => document.body.querySelector<HTMLElement>('[role="dialog"]');

/**
 * Una tecla escrita con el foco adentro, que es el camino normal.
 *
 * `cancelable` y devolver el evento no son adorno. Un evento despachado a mano
 * **no** hace la navegación nativa del Tab: el foco no se mueve solo, se mueva
 * o no la trampa. Una prueba que sólo comprobara «el foco no se fue afuera»
 * pasaría igual con la trampa desconectada, que es exactamente como estaban
 * escritas estas dos. Lo marcó la revisión.
 *
 * Lo que sí distingue una cosa de la otra es `defaultPrevented` —la trampa
 * cancela el evento para quedarse con el Tab— y adónde fue a parar el foco.
 */
function teclearDentro(key: string, shiftKey = false) {
	const evento = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
	elPanel()?.dispatchEvent(evento);
	return evento;
}

/** Dos vueltas: el diálogo enfoca en la primera y quien lo usa en la segunda. */
async function asentarse() {
	await nextTick();
	await nextTick();
	await nextTick();
}

const BORRADOR: Borrador = {
	para: [],
	cc: [],
	asunto: '',
	cuerpo: '',
	en_respuesta_a: '',
	referencias: [],
};

describe('la ayuda de atajos', () => {
	function abrir() {
		return anotar(
			mount(AtajosComponent, {
				props: { abierto: true, mapa: juego('gmail') },
				attachTo: document.body,
			})
		);
	}

	test('se anuncia como diálogo y toma su nombre del título que se ve', async () => {
		// Antes el nombre era un `aria-label` escrito a mano con el mismo texto
		// que el `<h2>` de al lado: dos copias de lo mismo, y la que se queda
		// vieja es la que nadie ve.
		abrir();
		await asentarse();

		const id = elPanel()?.getAttribute('aria-labelledby');
		expect(elPanel()?.getAttribute('aria-modal')).toBe('true');
		expect(id).toBeTruthy();
		expect(document.getElementById(id as string)?.textContent).toContain('atajos.titulo');
	});

	test('el foco entra, que es lo que no pasaba', async () => {
		abrir();
		await asentarse();

		expect(document.activeElement).toBe(elPanel());
	});

	test('el Tab no se escapa a la lista de atrás', async () => {
		// Adentro hay un solo botón —el de cerrar—, así que dar la vuelta es
		// quedarse en él. Lo que prueba que la trampa corrió es que el evento
		// quede cancelado: sin ella el Tab seguiría hasta lo de atrás.
		abrir();
		await asentarse();

		const cerrar = elPanel()?.querySelector<HTMLElement>('button') ?? null;
		expect(cerrar).not.toBeNull();
		cerrar?.focus();
		const evento = teclearDentro('Tab');
		await nextTick();

		expect(evento.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(cerrar);
	});

	test('y Escape cierra', async () => {
		const vista = abrir();
		await asentarse();

		teclearDentro('Escape');
		await nextTick();

		expect(vista.emitted('cerrar')).toHaveLength(1);
	});
});

describe('las preferencias', () => {
	test('también entran el foco y Escape', async () => {
		const vista = anotar(
			mount(PreferenciasComponent, { props: { abierto: true }, attachTo: document.body })
		);
		await asentarse();

		expect(elPanel()?.getAttribute('aria-modal')).toBe('true');
		expect(document.activeElement).toBe(elPanel());

		teclearDentro('Escape');
		await nextTick();
		expect(vista.emitted('cerrar')).toHaveLength(1);
	});
});

describe('la ventana de redacción', () => {
	function abrir(esRespuesta = false, inicial: Borrador = BORRADOR) {
		return anotar(
			mount(RedactarComponent, {
				props: { inicial, esRespuesta, enviando: false, cuentas: [], cuenta: 'una' },
				attachTo: document.body,
			})
		);
	}

	test('el foco va al campo y no al panel, que es lo que pide un formulario', async () => {
		// `DialogContent` enfoca el panel al abrir, que es lo que corresponde a
		// un diálogo que pregunta algo. Esto no pregunta nada: lo útil es entrar
		// escribiendo. Los dos esperan un `nextTick`, así que el orden no se lee
		// en el código y por eso se comprueba acá.
		abrir();
		await asentarse();

		expect(document.activeElement?.tagName).toBe('INPUT');
		expect(document.activeElement).not.toBe(elPanel());
	});

	test('y en una respuesta va al cuerpo, que es donde falta escribir', async () => {
		abrir(true, { ...BORRADOR, para: ['quien@ejemplo.org'], asunto: 'Re: algo', cuerpo: '> citado' });
		await asentarse();

		expect(document.activeElement?.tagName).toBe('TEXTAREA');
	});

	test('el Tab da la vuelta adentro en vez de salirse al correo de atrás', async () => {
		// Acá hay varios campos, así que dar la vuelta se ve: del último al
		// primero. Y el evento tiene que quedar cancelado, o el Tab nativo
		// seguiría de largo hasta la lista de mensajes que el velo tapa.
		abrir();
		await asentarse();

		const alcanzables = [
			...(elPanel()?.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
			) ?? []),
		];
		expect(alcanzables.length).toBeGreaterThan(1);

		alcanzables[alcanzables.length - 1].focus();
		const evento = teclearDentro('Tab');
		await nextTick();

		expect(evento.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(alcanzables[0]);
	});

	test('Escape cierra cuando no hay nada escrito', async () => {
		const vista = abrir();
		await asentarse();

		teclearDentro('Escape');
		await nextTick();

		expect(vista.emitted('cerrar')).toHaveLength(1);
	});
});

describe('lo que el correo ya no dibuja', () => {
	test('el composable del icono se fue', async () => {
		expect(await Bun.file(`${RAIZ}src/composables/useReactiveIcon.ts`).exists()).toBe(false);
	});

	test('y nadie lo importa', async () => {
		// Un `import` a un archivo que volvió no lo ataja ninguna prueba
		// montada: lo que fallaría es la prueba del componente que ya no está.
		const fuentes = [...new Bun.Glob('src/**/*.{vue,ts}').scanSync(RAIZ)];
		expect(fuentes.length).toBeGreaterThan(10);

		const culpables: string[] = [];
		for (const ruta of fuentes) {
			const texto = await Bun.file(`${RAIZ}${ruta}`).text();
			if (/useReactiveIcon/.test(texto)) culpables.push(ruta);
		}

		expect(culpables).toEqual([]);
	});
});
