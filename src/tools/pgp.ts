/**
 * Qué decir de un mensaje firmado o cifrado con OpenPGP.
 *
 * Lo decide el servicio al bajar el mensaje; acá sólo se **traduce su estado a
 * lo que se dibuja**, con la misma honestidad que `tools/smime.ts`: nunca
 * «firmado por Ana» con tilde verde. Lo más alto que se afirma es «clave
 * conocida» (TOFU: la huella ya estaba guardada para ese remitente), y la
 * huella sólo viaja en ese caso.
 */

/** `pgp` de un mensaje abierto. `null` si no venía firmado ni cifrado con PGP. */
export interface PgpStatus {
	/** `known`, `unknown` o `unverifiable`; cualquier otro valor se lee como no verificable. */
	signature: string | null;
	/** La huella del firmante, sólo con firma conocida. */
	signer: string | null;
	encryption: 'opened' | 'unavailable' | 'other' | null;
}

export type PgpSignatureView = 'known' | 'unknown' | 'unverifiable';

export interface PgpView {
	signature: PgpSignatureView | null;
	/** La huella, sólo si la clave es conocida. */
	fingerprint: string | null;
	encryption: 'opened' | 'unavailable' | null;
	/** Si el cuerpo no se debe dibujar (cifrado que no se pudo abrir). */
	bodyHidden: boolean;
}

const NONE: PgpView = { signature: null, fingerprint: null, encryption: null, bodyHidden: false };

export function describePgp(pgp: PgpStatus | null | undefined): PgpView {
	if (!pgp) return NONE;
	const signature: PgpSignatureView | null =
		pgp.signature == null
			? null
			: pgp.signature === 'known' || pgp.signature === 'unknown'
				? pgp.signature
				: 'unverifiable';
	const fingerprint = signature === 'known' && pgp.signer?.trim() ? pgp.signer.trim() : null;
	// Un valor que no conocemos cuenta como «no se pudo abrir», lo conservador.
	const encryption =
		pgp.encryption == null ? null : pgp.encryption === 'opened' ? 'opened' : 'unavailable';
	return { signature, fingerprint, encryption, bodyHidden: encryption === 'unavailable' };
}
