import { describe, expect, test } from 'bun:test';
import { GMAIL, juego, VIM } from '../src/tools/atajos';
import {
	MAX_SEGUNDOS_PARA_DESHACER,
	SEGUNDOS_PARA_DESHACER,
	segundosValidos,
} from '../src/tools/deshacer';

/**
 * Lo que se puede probar de las preferencias sin un backend: que un valor raro
 * guardado no deje la ventana en un estado que no es ninguno.
 *
 * La lectura y la escritura pasan por `invoke`, que acá no existe; lo que sí se
 * prueba es la parte que decide, que es la que se puede equivocar en silencio.
 */
describe('elegir el juego de atajos', () => {
	test('los dos nombres que existen dan sus mapas', () => {
		expect(juego('gmail')).toBe(GMAIL);
		expect(juego('vim')).toBe(VIM);
	});

	/**
	 * Un archivo escrito a mano, o por una versión anterior, puede tener
	 * cualquier cosa. Que eso deje a alguien sin teclado sería peor que la
	 * preferencia.
	 */
	test('cualquier otra cosa da el de siempre', () => {
		for (const raro of ['emacs', '', 'GMAIL', undefined]) {
			expect(juego(raro)).toBe(GMAIL);
		}
	});
});

describe('cuánto dura el arrepentimiento', () => {
	test('un número razonable se respeta', () => {
		expect(segundosValidos(30)).toBe(30);
		expect(segundosValidos(MAX_SEGUNDOS_PARA_DESHACER)).toBe(MAX_SEGUNDOS_PARA_DESHACER);
	});

	test('cero vale: es «mandá en el acto»', () => {
		expect(segundosValidos(0)).toBe(0);
	});

	/**
	 * **Lo que no se entiende vuelve al valor de siempre y no a cero.**
	 *
	 * A cero hay que llegar a propósito: si un valor roto cayera ahí, el
	 * arrepentimiento desaparecería sin que nadie lo haya pedido, que es justo lo
	 * que esta función existe para no hacer.
	 */
	test('lo que no es un número da el de siempre', () => {
		for (const raro of ['30', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -5, {}]) {
			expect(segundosValidos(raro)).toBe(SEGUNDOS_PARA_DESHACER);
		}
	});

	test('se acota hacia arriba', () => {
		// Un número enorme deja los mensajes esperando y se ve como un correo que
		// no manda.
		expect(segundosValidos(999_999)).toBe(MAX_SEGUNDOS_PARA_DESHACER);
	});

	test('los decimales se redondean', () => {
		expect(segundosValidos(7.6)).toBe(8);
	});
});
