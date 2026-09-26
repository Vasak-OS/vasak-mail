/**
 * La barra de la ventana del correo.
 *
 * Tenía su propio marco, su propia barra y un absoluto propio para poner la
 * carpeta en el medio. Los tres salen ahora de la librería.
 *
 * Lo que se comprueba es dónde queda cada cosa, que es lo que se rompe al
 * mudarla. La cadena es larga —la vista se la pasa al layout, el layout al
 * marco, el marco a la barra— y basta con que uno de los tres no reexponga una
 * ranura para que lo que se le ponga desaparezca sin ningún error.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
	AppBar,
	olvidarLosIconosDelTema,
	WindowControls,
	WindowFrame,
} from '@vasakgroup/vue-libvasak';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import CorreoView from '@/views/CorreoView.vue';
import { olvidarTodo } from './dobles';

let vista: VueWrapper | null = null;

function abrir() {
	vista = mount(CorreoView);
	return vista;
}

/** Lo que cada llamada a `ranura()` dejó montado, para desmontarlo después. */
const sueltos: VueWrapper[] = [];

/**
 * Lo que se dibuja dentro de una ranura de la barra.
 *
 * Monta un componente aparte, así que lo que devuelve **no** cuelga de `vista`
 * y no se va con ella: se anota acá y el `afterEach` lo desmonta. Sin eso cada
 * prueba deja un componente vivo, con sus oyentes puestos, hasta que termina el
 * archivo.
 */
function ranura(ventana: VueWrapper, nombre: string) {
	const barra = ventana.findComponent(AppBar);
	const dibujar = (barra.vm.$slots as Record<string, (() => unknown) | undefined>)[nombre];
	if (!dibujar) return null;
	const suelto = mount({ render: () => dibujar() });
	sueltos.push(suelto);
	return suelto;
}

afterEach(() => {
	for (const suelto of sueltos.splice(0)) suelto.unmount();
	vista?.unmount();
	vista = null;
	olvidarTodo();
	// Lo que el tema resolvió se memoriza en el módulo de la librería, y un
	// módulo se comparte entre archivos de prueba: sin vaciarlo, el primero que
	// pida un icono con el tema sin preparar deja guardado que no hay ninguno.
	olvidarLosIconosDelTema();
});

describe('la ventana', () => {
	test('usa el marco compartido', () => {
		expect(abrir().findComponent(WindowFrame).exists()).toBe(true);
	});

	test('y no queda un segundo borde dibujado a mano', () => {
		expect(abrir().findAll('.rounded-corner-window')).toHaveLength(1);
	});

	test('con los tres botones', () => {
		expect(abrir().findComponent(WindowControls).findAll('button')).toHaveLength(3);
	});

	test('el marco queda `relative`, que es de lo que cuelga la redacción', () => {
		// La ventana de redacción va encima y no en una ventana aparte:
		// escribir un correo es algo que se hace y se termina. Sin `relative`
		// se apoya en el documento, y con la ventana redondeada le pintaría las
		// esquinas.
		expect(abrir().findComponent(WindowFrame).classes()).toContain('relative');
	});
});

describe('lo que va en la barra', () => {
	test('el icono va en `identidad`', async () => {
		// En el contenido de la barra se desplazaría con lo demás cuando queda a
		// un costado: `identidad` es la única zona que no scrollea.
		//
		// Lo dibuja `ThemeIcon`, que lo resuelve contra el tema: hasta que
		// vuelve deja un hueco del tamaño del icono y no un `img`.
		const dentro = ranura(abrir(), 'identidad');
		await new Promise((listo) => setTimeout(listo, 0));
		await nextTick();

		expect(dentro?.find('img').attributes('alt')).toBe('app.nombre');
	});

	test('actualizar y preferencias van en `acciones`', () => {
		// Es donde están en el resto de las aplicaciones. Antes los empujaba
		// hasta ahí un `span` con `flex-1`; ahora el hueco lo pone la barra.
		const dentro = ranura(abrir(), 'acciones');

		expect(dentro?.find('[aria-label="lista.actualizar"]').exists()).toBe(true);
		expect(dentro?.find('[aria-label="preferencias.titulo"]').exists()).toBe(true);
	});

	test('dónde se está parado va en `centro`', () => {
		// Centrado entre el icono y los tres controles queda centrado respecto
		// de lo que sobra, y los controles ocupan bastante más que el icono.
		const dentro = ranura(abrir(), 'centro');

		expect(dentro?.find('[aria-live="polite"]').exists()).toBe(true);
	});

	test('y sigue anunciándose al cambiar de carpeta', () => {
		// `aria-live` es lo único que lo dice: quien no ve la lista no tiene
		// otra pista de que cambió.
		const dentro = ranura(abrir(), 'centro');

		expect(dentro?.find('[aria-live="polite"]').attributes('aria-live')).toBe('polite');
	});

	test('y no quedó ningún hueco a mano empujando cosas', () => {
		expect(abrir().findComponent(AppBar).findAll('span.flex-1')).toHaveLength(0);
	});
});
