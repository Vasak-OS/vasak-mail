import { describe, expect, test } from 'bun:test';
import { nombreDeCasilla } from '../src/tools/casillas';

/** Un catálogo de mentira, con sólo las claves que traduce el de verdad. */
const CATALOGO: Record<string, string> = {
	'casillas.entrada': 'Entrada',
	'casillas.enviados': 'Enviados',
};

/** Como el plugin: devuelve la clave cuando no la conoce. */
const t = (clave: string) => CATALOGO[clave] ?? clave;

describe('nombreDeCasilla', () => {
	test('una carpeta conocida se dice en el idioma de la sesión', () => {
		// Un servidor en inglés dice «Sent» y uno en español «Elementos
		// enviados»: que la misma carpeta cambie de nombre según el proveedor es
		// ruido, y encima cambia de idioma a mitad de la ventana.
		expect(nombreDeCasilla({ nombre: 'Sent', uso: 'enviados' }, t)).toBe('Enviados');
		expect(nombreDeCasilla({ nombre: 'Elementos enviados', uso: 'enviados' }, t)).toBe('Enviados');
		expect(nombreDeCasilla({ nombre: 'INBOX', uso: 'entrada' }, t)).toBe('Entrada');
	});

	test('una que no se reconoce conserva el nombre que le pusieron', () => {
		// «Facturas 2026» no tiene traducción ni debería tenerla.
		expect(nombreDeCasilla({ nombre: 'Facturas 2026', uso: 'ninguno' }, t)).toBe('Facturas 2026');
	});

	test('una traducción que falta no deja la clave a la vista', () => {
		// El plugin devuelve **la clave misma** cuando no la encuentra. Sin
		// comprobarlo, la carpeta aparecía como «casillas.archivo».
		expect(nombreDeCasilla({ nombre: 'Archive', uso: 'archivo' }, t)).toBe('Archive');
	});

	test('sin nombre ni traducción devuelve vacío y no la clave', () => {
		// Un servidor puede mandar cualquier cosa. Vacío se ve raro; «casillas.»
		// se ve roto.
		expect(nombreDeCasilla({ nombre: '', uso: '' }, t)).toBe('');
	});
});
