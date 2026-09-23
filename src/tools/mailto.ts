/**
 * Lo que llega cuando el sistema elige esta aplicación para un `mailto:`.
 *
 * El URI lo lee y lo valida el proceso de Rust —ver `src-tauri/src/mailto.rs`—;
 * acá sólo se traduce lo que manda a un borrador de los que abre la ventana de
 * redacción. Aparte de los componentes porque tiene una decisión adentro que no
 * se ve, la de la copia oculta, y las decisiones que no se ven son las que se
 * pierden en un refactor.
 */

import type { Borrador } from '@/composables/use-correo';

/** Un mensaje pedido desde afuera, tal cual lo manda el backend. */
export interface MailtoRequest {
	to: string[];
	cc: string[];
	bcc: string[];
	subject: string;
	body: string;
}

/** Lo que hay que abrir, y lo que hubo que dejar afuera. */
export interface MailtoResult {
	borrador: Borrador;
	/**
	 * Si el enlace pedía copia oculta.
	 *
	 * Ni la ventana de redacción ni el servicio que arma el mensaje tienen `Bcc`
	 * todavía, así que esas direcciones **no van a ninguna parte**. Se devuelve
	 * para poder decirlo: un mensaje que sale sin la copia oculta que el enlace
	 * pedía, y sin que nadie lo mencione, es de los errores que se descubren
	 * cuando ya no se pueden arreglar.
	 */
	sinCopiaOculta: boolean;
}

/** El borrador que abre la ventana, a partir de lo que pidió el enlace. */
export function aBorrador(pedido: MailtoRequest): MailtoResult {
	return {
		borrador: {
			para: pedido.to,
			cc: pedido.cc,
			asunto: pedido.subject,
			cuerpo: pedido.body,
			// Un `mailto:` nunca es una respuesta: no hay ningún mensaje al que
			// encadenarlo, y poner un `In-Reply-To` inventado rompería el hilo
			// de quien lo reciba.
			en_respuesta_a: '',
			referencias: [],
			adjuntos: [],
		},
		sinCopiaOculta: pedido.bcc.length > 0,
	};
}
