/**
 * Qué se dice de un mensaje firmado o cifrado, y qué adjuntos se ven.
 *
 * La regla que ordena todo es no decir más de lo que se sabe (`tools/smime.ts`):
 * la validación de confianza X.509 no existe todavía, así que **nunca** se
 * afirma «firma válida», llegue lo que llegue en `valid`.
 */

import { describe, expect, test } from 'bun:test';
import type { Adjunto } from '@/composables/use-correo';
import { describeSmime, type SmimeStatus, visibleAttachments } from '@/tools/smime';

function status(cambios: Partial<SmimeStatus> = {}): SmimeStatus {
	return { valid: false, signer: null, encryption: null, ...cambios };
}

function adjunto(parte: string, nombre: string, tipo: string): Adjunto {
	return { parte, nombre, tipo };
}

const FIRMA = adjunto('2', 'smime.p7s', 'application/pkcs7-signature');
const SOBRE = adjunto('1', 'smime.p7m', 'application/pkcs7-mime');
const FACTURA = adjunto('3', 'factura.pdf', 'application/pdf');

describe('describeSmime: sin estado del servicio (lectura en vivo)', () => {
	test('sin `smime` y sin sobre, el mensaje se ve como uno cualquiera', () => {
		for (const sin of [null, undefined]) {
			expect(describeSmime(sin, [FACTURA])).toEqual({
				signer: null,
				encryption: null,
				bodyHidden: false,
			});
		}
	});

	test('sin `smime` pero con un sobre pkcs7-mime, el cuerpo no se dibuja y no es una alarma', () => {
		for (const tipo of ['application/pkcs7-mime', 'application/x-pkcs7-mime']) {
			const view = describeSmime(null, [adjunto('1', 'smime.p7m', tipo)]);

			expect(view.encryption).toBe('pending');
			expect(view.bodyHidden).toBe(true);
			expect(view.signer).toBeNull();
		}
	});

	test('el tipo del sobre se reconoce con parámetros y en mayúsculas', () => {
		const view = describeSmime(undefined, [
			adjunto('1', 'x', 'Application/PKCS7-Mime; smime-type=enveloped-data; name=smime.p7m'),
		]);

		expect(view.encryption).toBe('pending');
	});

	test('una firma suelta sola (multipart/signed) no es un sobre', () => {
		expect(describeSmime(undefined, [FIRMA]).encryption).toBeNull();
	});
});

describe('describeSmime: la tabla de estados', () => {
	const casos: Array<[string, SmimeStatus, ReturnType<typeof describeSmime>]> = [
		[
			'ni firmado ni cifrado',
			status(),
			{ signer: null, encryption: null, bodyHidden: false },
		],
		[
			'firmado',
			status({ signer: 'ana@ejemplo.org' }),
			{ signer: 'ana@ejemplo.org', encryption: null, bodyHidden: false },
		],
		[
			'cifrado y abierto',
			status({ encryption: 'opened' }),
			{ signer: null, encryption: 'opened', bodyHidden: false },
		],
		[
			'cifrado y no se pudo abrir: el cuerpo no se dibuja',
			status({ encryption: 'unavailable' }),
			{ signer: null, encryption: 'unavailable', bodyHidden: true },
		],
		[
			'firmado y cifrado abierto (las dos cosas a la vez)',
			status({ signer: 'ana@ejemplo.org', encryption: 'opened' }),
			{ signer: 'ana@ejemplo.org', encryption: 'opened', bodyHidden: false },
		],
		[
			'firmado y cifrado sin poder abrir',
			status({ signer: 'ana@ejemplo.org', encryption: 'unavailable' }),
			{ signer: 'ana@ejemplo.org', encryption: 'unavailable', bodyHidden: true },
		],
	];

	for (const [titulo, entrada, esperado] of casos) {
		test(titulo, () => {
			expect(describeSmime(entrada, [])).toEqual(esperado);
		});
	}

	test('`valid: true` no cambia nada: sigue siendo «firmado, no verificado», nunca «válido»', () => {
		const conValid = describeSmime(status({ valid: true, signer: 'ana@ejemplo.org' }), []);
		const sinValid = describeSmime(status({ valid: false, signer: 'ana@ejemplo.org' }), []);

		expect(conValid).toEqual(sinValid);
		// La vista no tiene ningún campo con el que alguien pudiera pintar «válido».
		expect(Object.keys(conValid).sort()).toEqual(['bodyHidden', 'encryption', 'signer']);
		expect(JSON.stringify(conValid)).not.toMatch(/valid/i);
	});

	test('`valid: true` sin firmante tampoco inventa un distintivo', () => {
		expect(describeSmime(status({ valid: true, signer: null }), []).signer).toBeNull();
	});

	test('sin firmante (`signer: null`) no hay distintivo de firma', () => {
		expect(describeSmime(status({ signer: null }), []).signer).toBeNull();
	});

	test('un firmante vacío o de espacios es lo mismo que ninguno, y el real se recorta', () => {
		expect(describeSmime(status({ signer: '' }), []).signer).toBeNull();
		expect(describeSmime(status({ signer: '   ' }), []).signer).toBeNull();
		expect(describeSmime(status({ signer: '  ana@ejemplo.org ' }), []).signer).toBe(
			'ana@ejemplo.org'
		);
	});

	test('`encryption: null` es sin cifrado', () => {
		const view = describeSmime(status({ signer: 'ana@ejemplo.org', encryption: null }), []);

		expect(view.encryption).toBeNull();
		expect(view.bodyHidden).toBe(false);
	});

	test('`encryption: "other"` se trata como «no se pudo abrir» y oculta el cuerpo', () => {
		const view = describeSmime(status({ encryption: 'other' }), []);

		expect(view.encryption).toBe('unavailable');
		expect(view.bodyHidden).toBe(true);
	});

	test('un valor de cifrado que no existe hoy también es «no se pudo abrir»', () => {
		// El servicio puede agregar un estado mañana: tiene que fallar cerrado.
		const raro = status({ encryption: 'algo-nuevo' as unknown as SmimeStatus['encryption'] });
		const view = describeSmime(raro, []);

		expect(view.encryption).toBe('unavailable');
		expect(view.bodyHidden).toBe(true);
	});

	test('con estado del servicio, un sobre entre los adjuntos no lo pisa', () => {
		// `opened`: el cuerpo es el descifrado, aunque el sobre siga como adjunto.
		const view = describeSmime(status({ encryption: 'opened' }), [SOBRE]);

		expect(view).toEqual({ signer: null, encryption: 'opened', bodyHidden: false });
	});
});

describe('visibleAttachments', () => {
	test('saca la firma suelta por su tipo', () => {
		expect(visibleAttachments([FACTURA, FIRMA])).toEqual([FACTURA]);
	});

	test('reconoce también el tipo x-pkcs7-signature, con parámetros y mayúsculas', () => {
		const visibles = visibleAttachments([
			adjunto('1', 'a', 'application/x-pkcs7-signature'),
			adjunto('2', 'b', 'Application/PKCS7-Signature; name=smime.p7s'),
			FACTURA,
		]);

		expect(visibles).toEqual([FACTURA]);
	});

	test('filtra por TIPO y no por nombre: la firma con otro nombre también se saca', () => {
		const otroNombre = adjunto('2', 'firma-de-ana.bin', 'application/pkcs7-signature');

		expect(visibleAttachments([otroNombre, FACTURA])).toEqual([FACTURA]);
	});

	test('filtra por TIPO y no por nombre: un archivo llamado smime.p7s de otro tipo se queda', () => {
		const impostor = adjunto('2', 'smime.p7s', 'application/pdf');

		expect(visibleAttachments([impostor, FACTURA])).toEqual([impostor, FACTURA]);
	});

	test('conserva el sobre (p7m): en un cifrado sin abrir es la única salida', () => {
		expect(visibleAttachments([SOBRE, FIRMA])).toEqual([SOBRE]);
		expect(visibleAttachments([adjunto('1', 'smime.p7m', 'application/x-pkcs7-mime')])).toHaveLength(1);
	});

	test('sin adjuntos devuelve una lista vacía y no toca el orden de los demás', () => {
		expect(visibleAttachments([])).toEqual([]);
		expect(visibleAttachments([FACTURA, FIRMA, SOBRE])).toEqual([FACTURA, SOBRE]);
	});
});
