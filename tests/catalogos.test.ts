import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Que los dos catálogos digan lo mismo, y que no se use una clave que no existe.
 *
 * El propio `es.yml` promete esta prueba —«Los dos idiomas tienen que tener las
 * mismas claves… Hay un test que lo verifica»— y en este repositorio no existía.
 * Una clave que está en un idioma y no en el otro no rompe nada: el plugin
 * devuelve la clave y la interfaz muestra `casillas.papelera` en vez de
 * «Papelera». En una sesión en el idioma que sí la tiene, todo se ve bien.
 *
 * Viene de `vasak-settings`, donde ya encontró errores de verdad.
 */

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const CATALOGOS = join(RAIZ, 'src-tauri/locales');

/**
 * Las claves de un `.yml` plano por indentación, como `views.home.title`.
 *
 * Se saltea el contenido de los bloques `>-` y `|`. Ahí adentro todo es texto,
 * y una línea de prosa que empiece con «palabra:» —«dispositivo: una que se los
 * pida…»— se leía como una clave. El resultado era una falla que acusaba a la
 * traducción de tener claves de más, cuando lo único que había pasado es que el
 * texto se acomodó distinto al reescribirlo. Pasó de verdad, y el mensaje no
 * daba ninguna pista de por dónde buscar.
 */
function clavesDe(yaml: string): Set<string> {
	const claves = new Set<string>();
	const pila: string[] = [];
	/** Sangría del bloque de texto que se está salteando, si hay alguno. */
	let sangriaDelBloque: number | null = null;

	for (const linea of yaml.split('\n')) {
		if (!linea.trim() || linea.trimStart().startsWith('#')) continue;
		const sangria = linea.length - linea.trimStart().length;

		if (sangriaDelBloque !== null) {
			// El bloque termina cuando vuelve a la sangría de su propia clave.
			if (sangria > sangriaDelBloque) continue;
			sangriaDelBloque = null;
		}

		const nivel = sangria / 2;
		// La clave puede venir entrecomillada, con comilla simple o doble: es como
		// el YAML escribe `'0_env'`, que empieza con un dígito, y `"on"`/`"off"`,
		// que sin comillas serían booleanos.
		const match = linea.trim().match(/^["']?([A-Za-z0-9_.-]+)["']?:(.*)$/);
		if (!match) continue;

		pila.length = nivel;
		pila[nivel] = match[1];
		// Con valor es una hoja; sin valor, un grupo que sólo abre camino.
		const valor = match[2].trim();
		if (valor) claves.add(pila.slice(0, nivel + 1).join('.'));
		// `>-`, `>`, `|`, `|-`… abren un bloque cuyo contenido es texto, no YAML.
		if (/^[>|][-+]?\d*$/.test(valor)) sangriaDelBloque = sangria;
	}

	return claves;
}

function archivosDeCodigo(dir: string): string[] {
	const encontrados: string[] = [];
	for (const entrada of readdirSync(dir)) {
		const ruta = join(dir, entrada);
		if (statSync(ruta).isDirectory()) {
			encontrados.push(...archivosDeCodigo(ruta));
		} else if (/\.(vue|ts)$/.test(entrada)) {
			encontrados.push(ruta);
		}
	}
	return encontrados;
}

const es = clavesDe(readFileSync(join(CATALOGOS, 'es.yml'), 'utf8'));
const en = clavesDe(readFileSync(join(CATALOGOS, 'en.yml'), 'utf8'));

describe('catálogos de idioma', () => {
	test('los dos idiomas tienen las mismas claves', () => {
		const soloEnEspanol = [...es].filter((clave) => !en.has(clave)).sort();
		const soloEnIngles = [...en].filter((clave) => !es.has(clave)).sort();

		expect({ soloEnEspanol, soloEnIngles }).toEqual({ soloEnEspanol: [], soloEnIngles: [] });
	});

	test('cada clave que usa la interfaz existe', () => {
		// Sólo las literales: `t(\`views.${x}\`)` no se puede resolver acá y no
		// tiene sentido adivinarlo.
		const usoLiteral = /\bt\(\s*'([A-Za-z0-9_.-]+)'\s*[,)]/g;
		const faltantes: string[] = [];

		for (const archivo of archivosDeCodigo(join(RAIZ, 'src'))) {
			const texto = readFileSync(archivo, 'utf8');
			for (const uso of texto.matchAll(usoLiteral)) {
				const clave = uso[1];
				if (!es.has(clave)) {
					faltantes.push(`${archivo.slice(RAIZ.length)}: ${clave}`);
				}
			}
		}

		expect(faltantes.sort()).toEqual([]);
	});
});
