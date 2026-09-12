import { describe, expect, test } from 'bun:test';
import { GMAIL, juego, VIM } from '../src/tools/atajos';

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
