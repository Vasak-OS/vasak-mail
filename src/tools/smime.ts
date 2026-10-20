/**
 * Qué decir de un mensaje firmado o cifrado, y qué adjuntos mostrar.
 *
 * Lo decide el servicio (`vasak-accounts-sync`): firma, verifica y descifra al
 * bajar el mensaje. Esta ventana sólo **traduce su estado a lo que se dibuja**,
 * y la regla que ordena todo es no decir más de lo que se sabe.
 *
 * - **Nunca «firma válida».** La validación de confianza X.509 (cadena hasta una
 *   autoridad, vigencia, revocación) todavía no existe, así que `valid` llega
 *   siempre en `false`. Y aunque llegara en `true`, acá **no se lee**: cuando la
 *   validación exista, afirmar «válida» será un cambio deliberado de este
 *   archivo y no un efecto de que el servicio mande un booleano.
 * - **Sin firmante no hay distintivo.** Si la firma no se pudo comprobar el
 *   servicio manda `signer: null`: el mensaje se ve como sin firmar, que es lo
 *   honesto. Mostrar «firmado» algo cuya firma no cierra sería peor que callar.
 * - **Cifrado y firma son ortogonales**: un correo puede traer las dos cosas.
 */

import type { Adjunto } from '@/composables/use-correo';

/** El estado de cifrado tal como llega. `other` es un valor que no conocemos. */
export type EncryptionState = 'opened' | 'unavailable' | 'other';

/** `smime` de un mensaje abierto. `null` si no venía firmado ni cifrado. */
export interface SmimeStatus {
	/** Hoy siempre `false`. No se usa para afirmar nada: ver arriba. */
	valid: boolean;
	signer: string | null;
	encryption: EncryptionState | null;
}

/**
 * Qué se ve del cifrado.
 *
 * - `opened`: el cuerpo que se muestra es el descifrado.
 * - `unavailable`: cifrado y no se pudo abrir (sin nuestra clave, ECC, un modo
 *   no soportado). **El cuerpo no se dibuja**, venga lo que venga.
 * - `pending`: no hay estado del servicio pero el mensaje trae un sobre S/MIME.
 *   Es la lectura en vivo, que no descifra: antes de que el sincronizador baje
 *   el cuerpo no se sabe si se podrá abrir, así que no es una alarma.
 */
export type EncryptionView = 'opened' | 'unavailable' | 'pending';

export interface SmimeView {
	/** El firmante, o `null` si no hay que mostrar ningún distintivo de firma. */
	signer: string | null;
	encryption: EncryptionView | null;
	/** Si el cuerpo no se debe dibujar. */
	bodyHidden: boolean;
}

/** Los tipos de la parte que lleva la firma suelta de un `multipart/signed`. */
const SIGNATURE_TYPES = ['application/pkcs7-signature', 'application/x-pkcs7-signature'];
/** Los del sobre (`smime.p7m`): cifrado, o firma opaca. */
const ENVELOPE_TYPES = ['application/pkcs7-mime', 'application/x-pkcs7-mime'];

function typeOf(attachment: Adjunto): string {
	// Con parámetros o sin ellos, y sin importar las mayúsculas: lo escribió
	// quien mandó el mensaje.
	return attachment.tipo.split(';')[0].trim().toLowerCase();
}

/**
 * Los adjuntos que la persona tiene que ver.
 *
 * Saca la firma suelta (`smime.p7s`): aparece como un archivo más en todo correo
 * firmado y no es nada que alguien quiera abrir. Se descarta **por tipo y no por
 * nombre**: el nombre lo eligió el remitente, y un archivo cualquiera llamado
 * `smime.p7s` tiene que seguir apareciendo.
 *
 * El sobre (`smime.p7m`) **se queda**: en un cifrado que no se pudo abrir es la
 * única salida —se guarda y se abre con otro cliente—.
 */
export function visibleAttachments(attachments: Adjunto[]): Adjunto[] {
	return attachments.filter((a) => !SIGNATURE_TYPES.includes(typeOf(a)));
}

/** Lo que se dibuja de un mensaje, a partir de su estado y de sus adjuntos. */
export function describeSmime(
	smime: SmimeStatus | null | undefined,
	attachments: Adjunto[]
): SmimeView {
	if (!smime) {
		// Sin estado: la lectura en vivo no verifica ni descifra. Si hay un sobre,
		// hay algo que no se está viendo.
		const envelope = attachments.some((a) => ENVELOPE_TYPES.includes(typeOf(a)));
		return envelope
			? { signer: null, encryption: 'pending', bodyHidden: true }
			: { signer: null, encryption: null, bodyHidden: false };
	}

	const signer = smime.signer?.trim() ? smime.signer.trim() : null;
	// Un valor que no conocemos cuenta como «no se pudo abrir»: afirmar que se
	// abrió algo de lo que no sabemos qué es sería lo contrario de lo conservador.
	const encryption: EncryptionView | null =
		smime.encryption == null ? null : smime.encryption === 'opened' ? 'opened' : 'unavailable';

	return { signer, encryption, bodyHidden: encryption === 'unavailable' };
}
