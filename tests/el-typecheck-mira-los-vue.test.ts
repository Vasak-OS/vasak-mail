import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Que `vue-tsc` corra donde comprueba algo.
 *
 * `bunx --bun vue-tsc` lo ejecuta bajo el runtime de Bun, y ahí el parche que
 * `vue-tsc` le mete a TypeScript para entender `.vue` no llega a aplicarse:
 * degrada a `tsc` pelado. `tsc` no conoce la extensión, así que los `.vue` del
 * `include` no entran al programa y **ninguno se comprueba**. Sale con 0 y no
 * dice nada.
 *
 * Esto no es hipotético acá: por eso `MensajeComponent.vue` y
 * `RedactarComponent.vue` llegaron a `main` usando cuatro nombres que nadie
 * importaba, y el paquete dejó de compilar en la tanda del repositorio. Lo
 * encontró `check-all.sh`, que corre `vue-tsc` por su cuenta y sin la bandera.
 *
 * Se lee el `package.json`, no se corre el comando: hacerlo correr acá tarda
 * más que toda la suite y necesita las dependencias instaladas.
 */

const RAIZ = join(import.meta.dir, '..');

function scripts(): Record<string, string> {
	return JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).scripts;
}

describe('el typecheck del build', () => {
	test('vue-tsc no corre con --bun', () => {
		const build = scripts().build;
		expect(build).toContain('vue-tsc');
		expect(build).not.toMatch(/--bun\s+vue-tsc/);
	});

	test('y el build sigue haciendo el typecheck antes de empaquetar', () => {
		// Si el orden se da vuelta, un error de tipos igual deja un `dist`
		// escrito, que es la mitad del valor de tenerlo.
		const build = scripts().build;
		expect(build.indexOf('vue-tsc')).toBeLessThan(build.indexOf('vite build'));
	});
});
