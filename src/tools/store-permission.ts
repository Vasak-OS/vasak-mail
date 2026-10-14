/**
 * El permiso del almacén de correo, visto desde la ventana.
 *
 * El programa de Rust no muestra texto: cuando la persona negó el almacén
 * devuelve una marca ([`STORE_PERMISSION_DENIED`]) y la ventana la traduce. Así
 * el mensaje sale en el idioma de la sesión y no en el que estaba compilado el
 * backend, y la ventana decide qué pintar —el estado de «sin permiso» con su
 * botón— sin leer una frase traducida.
 *
 * La marca tiene que coincidir letra por letra con la de
 * `src-tauri/src/correo.rs`.
 */

/** Lo que devuelve `listar_mensajes` cuando la persona negó el almacén. */
export const STORE_PERMISSION_DENIED = 'store-permission-denied';

/** Si el error de un comando es ese «no» al almacén. */
export function isStorePermissionDenied(error: unknown): boolean {
	return String(error) === STORE_PERMISSION_DENIED;
}

/**
 * Los cuatro desenlaces de volver a pedir el permiso, tal como los manda
 * `request_mail_access_again` (`src-tauri/src/store_access.rs`).
 *
 * - `reopened`: se olvidó la decisión anterior; el próximo pedido de correo
 *   reabre el diálogo, así que hay que releer.
 * - `too_soon`: se volvió a pedir hace muy poco (el techo contra la fatiga de
 *   permisos); hay que esperar un momento.
 * - `not_allowed`: la ventana no puede pedir este recurso (no debería pasar).
 * - `failed`: el servicio de permisos no está, o falló.
 */
export type ReaskOutcome =
	| { outcome: 'reopened' }
	| { outcome: 'too_soon' }
	| { outcome: 'not_allowed' }
	| { outcome: 'failed'; detail?: string };

/** Si tras el re-pedido hay que releer el correo: el diálogo se va a reabrir. */
export function reaskReopened(outcome: ReaskOutcome): boolean {
	return outcome.outcome === 'reopened';
}

/**
 * La clave de traducción del aviso cuando **no** se reabrió el diálogo, o la
 * cadena vacía cuando sí (no hay nada que avisar: ya se relee). Un desenlace
 * desconocido cae en el mensaje genérico, nunca en algo crudo.
 */
export function reaskNoticeKey(outcome: ReaskOutcome): string {
	switch (outcome.outcome) {
		case 'reopened':
			return '';
		case 'too_soon':
			return 'permiso.limite';
		case 'not_allowed':
			return 'permiso.denegado';
		default:
			return 'permiso.error';
	}
}
