/**
 * Qué se dice de un mensaje firmado o cifrado con OpenPGP.
 *
 * Misma regla que S/MIME: no decir más de lo que se sabe. Lo más alto que se
 * afirma es «clave conocida» (TOFU), y la huella sólo viaja con ella.
 */

import { describe, expect, test } from 'bun:test';
import { describePgp, type PgpStatus } from '@/tools/pgp';

function status(cambios: Partial<PgpStatus> = {}): PgpStatus {
	return { signature: null, signer: null, encryption: null, ...cambios };
}

const SIN_NADA = { signature: null, fingerprint: null, encryption: null, bodyHidden: false };

describe('describePgp: sin estado', () => {
	test('null, undefined y un estado vacío no dibujan nada y no ocultan el cuerpo', () => {
		for (const sin of [null, undefined, status()]) {
			expect(describePgp(sin)).toEqual(SIN_NADA);
		}
	});
});

describe('describePgp: la firma', () => {
	for (const signature of ['known', 'unknown', 'unverifiable']) {
		test(`«${signature}» se lee como «${signature}»`, () => {
			expect(describePgp(status({ signature })).signature).toBe(signature as never);
		});
	}

	test('un valor que no conocemos se lee como no verificable, nunca como conocida', () => {
		for (const raro of ['valid', 'trusted', 'KNOWN', '', 'futuro']) {
			expect(describePgp(status({ signature: raro, signer: 'AAAA' })).signature).toBe(
				'unverifiable'
			);
		}
	});

	test('la huella sólo se muestra con la clave conocida', () => {
		expect(describePgp(status({ signature: 'known', signer: 'AAAA BBBB' })).fingerprint).toBe(
			'AAAA BBBB'
		);
		for (const signature of ['unknown', 'unverifiable', 'valid']) {
			expect(describePgp(status({ signature, signer: 'AAAA BBBB' })).fingerprint).toBeNull();
		}
		// Sin firma tampoco: un `signer` suelto no afirma nada.
		expect(describePgp(status({ signature: null, signer: 'AAAA' })).fingerprint).toBeNull();
	});

	test('la huella se recorta y una vacía no cuenta', () => {
		expect(describePgp(status({ signature: 'known', signer: '  AAAA ' })).fingerprint).toBe('AAAA');
		expect(describePgp(status({ signature: 'known', signer: '   ' })).fingerprint).toBeNull();
		expect(describePgp(status({ signature: 'known', signer: null })).fingerprint).toBeNull();
	});

	test('firmar no oculta el cuerpo', () => {
		expect(describePgp(status({ signature: 'unverifiable' })).bodyHidden).toBe(false);
	});
});

describe('describePgp: el cifrado', () => {
	test('abierto se avisa y el cuerpo se ve', () => {
		const vista = describePgp(status({ encryption: 'opened' }));
		expect(vista.encryption).toBe('opened');
		expect(vista.bodyHidden).toBe(false);
	});

	test('no disponible oculta el cuerpo', () => {
		const vista = describePgp(status({ encryption: 'unavailable' }));
		expect(vista.encryption).toBe('unavailable');
		expect(vista.bodyHidden).toBe(true);
	});

	test('«other» y un valor nuevo se leen como no disponible: lo conservador', () => {
		for (const raro of ['other', 'futuro']) {
			const vista = describePgp(status({ encryption: raro as never }));
			expect(vista.encryption).toBe('unavailable');
			expect(vista.bodyHidden).toBe(true);
		}
	});

	test('firmado y cifrado abierto a la vez conservan los dos', () => {
		expect(
			describePgp(status({ signature: 'known', signer: 'AAAA', encryption: 'opened' }))
		).toEqual({ signature: 'known', fingerprint: 'AAAA', encryption: 'opened', bodyHidden: false });
	});

	test('firmado con clave conocida pero cifrado sin abrir: el cuerpo igual se oculta', () => {
		const vista = describePgp(
			status({ signature: 'known', signer: 'AAAA', encryption: 'unavailable' })
		);
		expect(vista.signature).toBe('known');
		expect(vista.bodyHidden).toBe(true);
	});
});
