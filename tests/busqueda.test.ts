import { describe, expect, test } from 'bun:test';
import type { Resumen } from '../src/composables/use-correo';
import { alcance, filtrados, sinAcentos } from '../src/tools/busqueda';

function mensaje(de: string, direccion: string, asunto: string): Resumen {
	return {
		uid: 1,
		account_id: 'a',
		casilla: 'INBOX',
		de,
		direccion,
		asunto,
		fecha: '',
		sin_leer: false,
		con_adjuntos: false,
	} as Resumen;
}

const LISTA = [
	mensaje('Ana Pérez', 'ana@ejemplo.com', 'Reunión del martes'),
	mensaje('Banco', 'avisos@banco.com', 'Tu resumen de cuenta'),
	mensaje('José', 'jose@otro.org', 'Factura 1234'),
];

describe('sinAcentos', () => {
	test('las tildes no separan', () => {
		expect(sinAcentos('Reunión')).toBe('reunion');
		expect(sinAcentos('José')).toBe('jose');
		expect(sinAcentos('ÁÉÍÓÚ')).toBe('aeiou');
	});

	/**
	 * La eñe también se va, y eso es a propósito aunque sorprenda: en NFD la
	 * «ñ» es una «n» con una tilde encima, y el mismo paso que hace que
	 * «reunion» encuentre «reunión» hace que «ano» encuentre «año».
	 *
	 * Se deja así porque buscar «munoz» y encontrar a «Muñoz» es lo que espera
	 * quien escribe, y es lo mismo que hace la agenda de `vasak-contacts`. Vale
	 * la pena que esté escrito: alguien lo va a notar.
	 */
	test('la eñe también, y es a propósito', () => {
		expect(sinAcentos('Ñandú')).toBe('nandu');
		expect(sinAcentos('Muñoz')).toBe('munoz');
	});
});

describe('filtrados', () => {
	/**
	 * Nadie escribe los acentos en un buscador, ni siquiera quien los escribe
	 * bien en todo lo demás.
	 */
	test('buscar sin acentos encuentra con acentos', () => {
		expect(filtrados(LISTA, 'reunion')).toHaveLength(1);
		expect(filtrados(LISTA, 'jose')).toHaveLength(1);
		expect(filtrados(LISTA, 'perez')[0].de).toBe('Ana Pérez');
	});

	test('se busca en el nombre, en la dirección y en el asunto', () => {
		expect(filtrados(LISTA, 'ana')).toHaveLength(1);
		expect(filtrados(LISTA, 'banco.com')).toHaveLength(1);
		expect(filtrados(LISTA, 'factura')).toHaveLength(1);
	});

	/**
	 * Cada palabra en alguna parte, no todas en la misma: «ana reunion» tiene
	 * el remitente en un campo y el asunto en otro.
	 */
	test('cada palabra puede estar en un campo distinto', () => {
		expect(filtrados(LISTA, 'ana reunion')).toHaveLength(1);
		expect(filtrados(LISTA, 'ana factura')).toHaveLength(0);
	});

	test('sin consulta no se filtra nada', () => {
		expect(filtrados(LISTA, '')).toHaveLength(3);
		expect(filtrados(LISTA, '   ')).toHaveLength(3);
	});

	test('lo que no está no aparece', () => {
		expect(filtrados(LISTA, 'zzzz')).toHaveLength(0);
	});

	test('las mayúsculas no separan', () => {
		expect(filtrados(LISTA, 'ANA')).toHaveLength(1);
		expect(filtrados(LISTA, 'BaNcO')).toHaveLength(1);
	});
});

describe('alcance', () => {
	/**
	 * Lo que esto evita: que la lista cambie de significado sin aviso. «Los
	 * últimos doscientos que coinciden» y «todo lo que el servidor encontró»
	 * son respuestas distintas a la misma pregunta.
	 */
	test('sin consulta se está viendo todo', () => {
		expect(alcance('', false)).toBe('todo');
		expect(alcance('  ', true)).toBe('todo');
	});

	test('con consulta y sin ir al servidor, es local', () => {
		expect(alcance('ana', false)).toBe('local');
	});

	test('con resultados del servidor, es del servidor', () => {
		expect(alcance('ana', true)).toBe('servidor');
	});
});
