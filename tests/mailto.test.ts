/**
 * El puente entre lo que pide un `mailto:` y lo que abre la ventana.
 *
 * Lo que lee el URI está probado en Rust, donde vive. Acá lo que importa es que
 * lo que llega termine en los campos que corresponden: un destinatario que cae
 * en el asunto, o un cuerpo que se pierde, no falla en ningún lado — se ve
 * recién cuando el mensaje ya salió.
 */

import { describe, expect, test } from 'bun:test';
import { aBorrador, type MailtoRequest } from '@/tools/mailto';

function pedido(parcial: Partial<MailtoRequest> = {}): MailtoRequest {
	return { to: [], cc: [], bcc: [], subject: '', body: '', ...parcial };
}

describe('lo que pide un mailto', () => {
	test('cada campo va al suyo', () => {
		const { borrador } = aBorrador(
			pedido({
				to: ['pepe@ejemplo.com'],
				cc: ['otro@ejemplo.com'],
				subject: 'Hola',
				body: 'Qué tal',
			})
		);

		expect(borrador.para).toEqual(['pepe@ejemplo.com']);
		expect(borrador.cc).toEqual(['otro@ejemplo.com']);
		expect(borrador.asunto).toBe('Hola');
		expect(borrador.cuerpo).toBe('Qué tal');
	});

	test('nunca es una respuesta', () => {
		// No hay ningún mensaje al que encadenarlo. Un `In-Reply-To` inventado
		// mete el mensaje en un hilo ajeno del lado de quien lo recibe.
		const { borrador } = aBorrador(pedido({ to: ['pepe@ejemplo.com'] }));

		expect(borrador.en_respuesta_a).toBe('');
		expect(borrador.referencias).toEqual([]);
	});

	test('un mailto vacío abre un mensaje en blanco', () => {
		const { borrador, sinCopiaOculta } = aBorrador(pedido());

		expect(borrador.para).toEqual([]);
		expect(borrador.asunto).toBe('');
		expect(sinCopiaOculta).toBe(false);
	});

	test('la copia oculta se avisa en lugar de descartarse callando', () => {
		// Ni la ventana ni el servicio tienen `Bcc`. Mandar el mensaje sin la
		// copia oculta que el enlace pedía, y no decirlo, es de los errores que
		// se descubren cuando ya no se pueden arreglar.
		const { borrador, sinCopiaOculta } = aBorrador(
			pedido({ to: ['pepe@ejemplo.com'], bcc: ['escondido@ejemplo.com'] })
		);

		expect(sinCopiaOculta).toBe(true);
		// Y desde luego no se cuela entre los visibles, que sería peor que
		// perderla: la dirección que se quiso ocultar la verían todos.
		expect(borrador.para).toEqual(['pepe@ejemplo.com']);
		expect(borrador.cc).toEqual([]);
	});
});
