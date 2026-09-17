import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Accion, Atajos, GMAIL, juego, teclasPorAccion, VIM } from '../src/tools/atajos';

/**
 * Las pruebas del módulo que traduce teclas a acciones.
 *
 * Se puede probar entero sin navegador porque el módulo no toca el DOM: recibe
 * un objeto con lo que hace falta de un evento y devuelve qué se pidió. Los
 * casos que importan no son los atajos que funcionan —ésos se ven al usarlos—
 * sino los que **no tienen que dispararse**.
 */

/** Un evento de teclado, con lo mínimo. */
function tecla(key: string, extra: Record<string, unknown> = {}) {
	return { key, ...extra };
}

describe('atajos', () => {
	test('las teclas del juego de Gmail hacen lo suyo', () => {
		const a = new Atajos();
		expect(a.apretar(tecla('j'))).toBe('siguiente');
		expect(a.apretar(tecla('k'))).toBe('anterior');
		expect(a.apretar(tecla('Enter'))).toBe('abrir');
		expect(a.apretar(tecla('u'))).toBe('volver');
		expect(a.apretar(tecla('r'))).toBe('responder');
		expect(a.apretar(tecla('c'))).toBe('redactar');
		expect(a.apretar(tecla('?'))).toBe('ayuda');
	});

	test('las flechas hacen lo mismo que j y k', () => {
		// Siempre, no como alternativa que hay que descubrir: quien no sabe que
		// existen los atajos igual aprieta las flechas.
		const a = new Atajos();
		expect(a.apretar(tecla('ArrowDown'))).toBe('siguiente');
		expect(a.apretar(tecla('ArrowUp'))).toBe('anterior');
	});

	/**
	 * El caso que hace inservible un juego de atajos de una sola tecla: escribir
	 * una «r» en el cuerpo de un correo y que se abra una respuesta.
	 */
	test('no se disparan mientras se escribe', () => {
		const a = new Atajos();
		for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
			expect(a.apretar(tecla('r', { target: { tagName } }))).toBeNull();
		}

		// Y lo editable, que es lo que usan los editores enriquecidos.
		expect(
			a.apretar(tecla('r', { target: { tagName: 'DIV', isContentEditable: true } }))
		).toBeNull();
	});

	test('fuera de un campo, la misma tecla sí', () => {
		const a = new Atajos();
		expect(a.apretar(tecla('r', { target: { tagName: 'DIV' } }))).toBe('responder');
		expect(a.apretar(tecla('r', { target: null }))).toBe('responder');
	});

	/**
	 * Tomar las combinaciones con modificador rompe copiar, pegar y cerrar la
	 * ventana. No son nuestras.
	 */
	test('las combinaciones con modificador no se tocan', () => {
		const a = new Atajos();
		expect(a.apretar(tecla('c', { ctrlKey: true }))).toBeNull();
		expect(a.apretar(tecla('c', { metaKey: true }))).toBeNull();
		expect(a.apretar(tecla('r', { altKey: true }))).toBeNull();
		// Shift no: `?` es Shift+/ en casi todos los teclados.
		expect(a.apretar(tecla('?', { shiftKey: true }))).toBe('ayuda');
	});

	test('una secuencia se completa con su segunda tecla', () => {
		const a = new Atajos();
		expect(a.apretar(tecla('g'), 0)).toBeNull();
		expect(a.esperando()).toBe(true);
		expect(a.apretar(tecla('i'), 100)).toBe('irALaEntrada');
		expect(a.esperando()).toBe(false);
	});

	/**
	 * Sin vencimiento, una `g` apretada sin querer espera para siempre y la
	 * próxima `i` —en cualquier momento del día— dispara algo que nadie pidió.
	 */
	test('una secuencia a medias vence', () => {
		const a = new Atajos();
		a.apretar(tecla('g'), 0);
		expect(a.apretar(tecla('i'), 5000)).toBeNull();
		expect(a.esperando()).toBe(false);
	});

	test('una secuencia que no lleva a nada se olvida entera', () => {
		const a = new Atajos();
		a.apretar(tecla('g'), 0);
		// La `x` no completa nada.
		expect(a.apretar(tecla('x'), 10)).toBeNull();
		expect(a.esperando()).toBe(false);
		// Y la `i` siguiente no completa la secuencia vieja.
		expect(a.apretar(tecla('i'), 20)).toBeNull();
	});

	test('escribir en un campo borra la secuencia a medias', () => {
		const a = new Atajos();
		a.apretar(tecla('g'), 0);
		a.apretar(tecla('i', { target: { tagName: 'INPUT' } }), 10);
		expect(a.esperando()).toBe(false);
	});

	test('una tecla que no está en el mapa no hace nada', () => {
		const a = new Atajos();
		for (const t of ['z', 'F5', 'Escape', ' ', 'Tab']) {
			expect(a.apretar(tecla(t))).toBeNull();
		}
	});

	/**
	 * La ayuda sale del mismo mapa que ejecuta, así que una ayuda que miente es
	 * imposible. Si no fuera así, la lista y las teclas se separarían en cuanto
	 * alguien cambie una.
	 */
	test('la ayuda se arma con el mapa de verdad', () => {
		const lista = teclasPorAccion();
		const acciones = new Set(lista.map((l) => l.accion));

		// Cada acción del mapa aparece una vez, con todas sus teclas juntas.
		expect(acciones.size).toBe(lista.length);
		const siguiente = lista.find((l) => l.accion === 'siguiente');
		expect(siguiente?.teclas.sort()).toEqual(['ArrowDown', 'j']);

		// Y no hay ninguna acción declarada que el mapa no tenga.
		for (const { accion } of lista) {
			expect(Object.values(GMAIL)).toContain(accion);
		}
	});

	/**
	 * Lo que el issue pide explícitamente: no declarar atajos que no hacen nada.
	 * Archivar, borrar, destacar y marcar como no leído son del juego de Gmail y
	 * todavía no existen acá.
	 *
	 * `buscar` **salió de esta lista** cuando entró el buscador. Ése es el ciclo
	 * que esta prueba tiene que sostener: una acción sale de acá el día que
	 * empieza a contestar, y no antes.
	 */
	test('no se prometen teclas que no contestan', () => {
		const sinHacer = ['archivar', 'borrar', 'destacar', 'marcarNoLeido'];
		for (const mapa of [GMAIL, VIM]) {
			for (const accion of Object.values(mapa)) {
				expect(sinHacer).not.toContain(accion as string);
			}
		}
	});

	test('la barra lleva al buscador', () => {
		// Es la misma tecla en los dos juegos, y no por pereza: `/` busca en Vim
		// desde antes que Gmail existiera.
		for (const mapa of [GMAIL, VIM]) {
			expect(new Atajos(mapa).apretar(tecla('/'))).toBe('buscar');
		}
	});

	test('y dentro de un campo la barra se escribe', () => {
		// Sin esto, buscar «n/a» se convierte en apretar el atajo a mitad de la
		// palabra. Es el mismo caso que la «r», pero con la tecla que justamente
		// deja el foco donde se escribe.
		const a = new Atajos();
		expect(a.apretar(tecla('/', { target: { tagName: 'INPUT' } }))).toBeNull();
	});

	test('un mapa distinto es otro juego de teclas, no otro código', () => {
		// Es lo que después permite el juego estilo Vim sin duplicar nada.
		const vim: Record<string, Accion> = { h: 'volver', l: 'abrir', 'g g': 'irALaEntrada' };
		const a = new Atajos(vim);
		expect(a.apretar(tecla('l'))).toBe('abrir');
		expect(a.apretar(tecla('j'))).toBeNull();
		expect(a.apretar(tecla('g'), 0)).toBeNull();
		expect(a.apretar(tecla('g'), 10)).toBe('irALaEntrada');
	});
});

describe('el juego estilo Vim', () => {
	test('cambia donde Vim tiene una convención', () => {
		const a = new Atajos(VIM);
		expect(a.apretar(tecla('l'))).toBe('abrir');
		expect(a.apretar(tecla('h'))).toBe('volver');
		expect(a.apretar(tecla('g'), 0)).toBeNull();
		expect(a.apretar(tecla('g'), 10)).toBe('irALaEntrada');
	});

	test('y coincide donde no la tiene', () => {
		// `j` y `k` son las mismas en los dos: Vim es de donde Gmail las sacó.
		const a = new Atajos(VIM);
		expect(a.apretar(tecla('j'))).toBe('siguiente');
		expect(a.apretar(tecla('k'))).toBe('anterior');
		expect(a.apretar(tecla('r'))).toBe('responder');
		expect(a.apretar(tecla('?'))).toBe('ayuda');
	});

	test('los dos juegos cubren las mismas acciones', () => {
		// Un juego con una acción de menos deja algo sin poder hacerse con el
		// teclado según cuál esté elegido, y nadie sabría por qué.
		expect(new Set(Object.values(VIM))).toEqual(new Set(Object.values(GMAIL)));
	});

	test('la ayuda de cada juego muestra sus propias teclas', () => {
		const deVim = teclasPorAccion(VIM).find((l) => l.accion === 'abrir');
		expect(deVim?.teclas.sort()).toEqual(['Enter', 'l']);
	});

	/**
	 * La que agarra el error que tenía la ayuda: el diálogo llamaba a
	 * `teclasPorAccion()` sin argumento, así que con el juego estilo Vim elegido
	 * mostraba `u` y `g i` mientras respondían `h` y `g g`.
	 *
	 * Se comprueba por el resultado y no por quién llama a qué: que las dos
	 * listas se puedan distinguir es lo que hace que pasar el mapa importe.
	 */
	test('las dos ayudas no son la misma', () => {
		const teclasDe = (mapa: Readonly<Record<string, Accion>>, accion: Accion) =>
			teclasPorAccion(mapa)
				.find((l) => l.accion === accion)
				?.teclas.sort();

		expect(teclasDe(GMAIL, 'volver')).toEqual(['u']);
		expect(teclasDe(VIM, 'volver')).toEqual(['h']);
		expect(teclasDe(GMAIL, 'irALaEntrada')).toEqual(['g i']);
		expect(teclasDe(VIM, 'irALaEntrada')).toEqual(['g g']);
	});
});

describe('juego', () => {
	test('elige por nombre', () => {
		expect(juego('vim')).toBe(VIM);
		expect(juego('gmail')).toBe(GMAIL);
	});

	/** Una preferencia rara no puede dejar a nadie sin teclado. */
	test('lo que no existe da el de siempre', () => {
		expect(juego('lo-que-sea')).toBe(GMAIL);
		expect(juego(undefined)).toBe(GMAIL);
		expect(juego('')).toBe(GMAIL);
	});
});

/**
 * Que cada acción tenga su nombre en los dos idiomas.
 *
 * `catalogos.test.ts` no puede ver esto y lo dice: la ayuda arma la clave con
 * `t(\`atajos.${accion}\`)`, y su comprobación sólo mira las literales. O sea que
 * una acción nueva sin traducir no rompe nada, no falla ninguna prueba, y la
 * lista de atajos muestra `atajos.buscar` donde tendría que decir qué hace.
 *
 * Se lee el `.yml` como texto porque es lo único que hace falta: si la línea
 * está, el plugin la encuentra.
 */
describe('los nombres de las acciones', () => {
	/**
	 * Sólo el bloque `atajos:`, no el archivo entero.
	 *
	 * Buscar la clave suelta daba por buena una acción sin traducir: `responder`
	 * y `redactar` también son claves de otros bloques, así que `atajos.responder`
	 * podía faltar y la prueba encontraba la de la ventana de redacción y pasaba.
	 */
	const nombresDeAtajos = (idioma: string): Set<string> => {
		const texto = readFileSync(
			fileURLToPath(new URL(`../src-tauri/locales/${idioma}.yml`, import.meta.url)),
			'utf8'
		);
		const nombres = new Set<string>();
		let adentro = false;
		for (const linea of texto.split('\n')) {
			if (/^\S/.test(linea)) adentro = linea.startsWith('atajos:');
			else if (adentro) {
				const clave = linea.match(/^ {2}([A-Za-z0-9_]+):/);
				if (clave) nombres.add(clave[1]);
			}
		}
		return nombres;
	};

	test('cada acción de cada juego tiene su texto en los dos idiomas', () => {
		const acciones = new Set<Accion>([...Object.values(GMAIL), ...Object.values(VIM)]);
		const faltantes: string[] = [];

		for (const idioma of ['es', 'en']) {
			const nombres = nombresDeAtajos(idioma);
			for (const accion of acciones) {
				if (!nombres.has(accion)) faltantes.push(`${idioma}: atajos.${accion}`);
			}
		}

		expect(faltantes.sort()).toEqual([]);
	});
});
