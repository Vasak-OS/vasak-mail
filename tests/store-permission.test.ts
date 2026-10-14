/**
 * Las marcas y los desenlaces del permiso del almacén que el programa de Rust
 * le pasa a la ventana (`src/tools/store-permission.ts`). El texto lo pone la
 * ventana en el idioma de la sesión; acá se prueba que cada cosa caiga donde
 * tiene que caer, y que una desconocida no se escape como mensaje crudo.
 */

import { describe, expect, test } from 'bun:test';
import {
	isStorePermissionDenied,
	type ReaskOutcome,
	reaskNoticeKey,
	reaskReopened,
	STORE_PERMISSION_DENIED,
} from '@/tools/store-permission';

describe('reconocer el «no» del almacén', () => {
	test('la marca exacta es un «no»', () => {
		expect(isStorePermissionDenied(STORE_PERMISSION_DENIED)).toBe(true);
	});

	test('cualquier otro error no lo es', () => {
		expect(isStorePermissionDenied('el servicio no está')).toBe(false);
		// Un `Error` con el mismo texto no es la marca: viaja como cadena cruda.
		expect(isStorePermissionDenied(new Error(STORE_PERMISSION_DENIED))).toBe(false);
		expect(isStorePermissionDenied(undefined)).toBe(false);
		expect(isStorePermissionDenied(null)).toBe(false);
	});
});

describe('leer el desenlace de volver a pedir', () => {
	test('sólo «reopened» manda releer', () => {
		expect(reaskReopened({ outcome: 'reopened' })).toBe(true);
		for (const outcome of [
			{ outcome: 'too_soon' },
			{ outcome: 'not_allowed' },
			{ outcome: 'failed', detail: 'x' },
		] satisfies ReaskOutcome[]) {
			expect(reaskReopened(outcome)).toBe(false);
		}
	});

	test('cuando se reabrió no hay nada que avisar', () => {
		expect(reaskNoticeKey({ outcome: 'reopened' })).toBe('');
	});

	test('cada desenlace que no reabre tiene su clave', () => {
		expect(reaskNoticeKey({ outcome: 'too_soon' })).toBe('permiso.limite');
		expect(reaskNoticeKey({ outcome: 'not_allowed' })).toBe('permiso.denegado');
		expect(reaskNoticeKey({ outcome: 'failed', detail: 'x' })).toBe('permiso.error');
	});

	test('un desenlace desconocido cae en el mensaje genérico, no en algo crudo', () => {
		expect(reaskNoticeKey({ outcome: 'vaya-a-saber' } as unknown as ReaskOutcome)).toBe(
			'permiso.error'
		);
	});
});
