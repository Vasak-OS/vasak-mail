import { describe, expect, test } from 'bun:test';
import { asuntoDeRespuesta, citar, direcciones, type Original, responder } from '../src/tools/responder';

function original(extra: Partial<Original> = {}): Original {
	return {
		asunto: 'Reunión',
		texto: 'Nos vemos el jueves.',
		de: 'ana@ejemplo.com',
		responder_a: 'ana@ejemplo.com',
		fecha: '2026-09-10T12:00:00+00:00',
		message_id: '<original@ejemplo.com>',
		referencias: ['<primero@ejemplo.com>'],
		...extra,
	};
}

describe('asuntoDeRespuesta', () => {
	test('agrega el prefijo una sola vez', () => {
		// Responder cinco veces en una conversación deja «Re: Re: Re: Re: Re:»,
		// que es lo que hacen los clientes que comparan sin mirar mayúsculas.
		expect(asuntoDeRespuesta('Reunión')).toBe('Re: Reunión');
		expect(asuntoDeRespuesta('Re: Reunión')).toBe('Re: Reunión');
		expect(asuntoDeRespuesta('RE: RE: Reunión')).toBe('Re: Reunión');
		expect(asuntoDeRespuesta('re : Reunión')).toBe('Re: Reunión');
	});

	test('también saca el prefijo en español que ponen algunos clientes', () => {
		expect(asuntoDeRespuesta('RV: Reunión')).toBe('Re: Reunión');
		expect(asuntoDeRespuesta('Rv: Re: Reunión')).toBe('Re: Reunión');
	});

	test('un asunto vacío no deja el prefijo colgando raro', () => {
		expect(asuntoDeRespuesta('')).toBe('Re: ');
		expect(asuntoDeRespuesta('Re:')).toBe('Re: ');
	});

	test('no se come una palabra que empieza con «re»', () => {
		expect(asuntoDeRespuesta('Recordatorio')).toBe('Re: Recordatorio');
		expect(asuntoDeRespuesta('Revisión: el plan')).toBe('Re: Revisión: el plan');
	});
});

describe('citar', () => {
	test('pone un mayor adelante de cada línea', () => {
		expect(citar('uno\ndos', 'Ana escribió:')).toBe('Ana escribió:\n> uno\n> dos');
	});

	test('los niveles quedan pegados como espera cualquier cliente', () => {
		// `>>` y no `> >`: es lo que distingue los niveles de una conversación.
		expect(citar('> ya citado', 'Ana:')).toBe('Ana:\n>> ya citado');
	});

	test('los saltos de Windows no dejan renglones sueltos', () => {
		expect(citar('uno\r\ndos', 'Ana:')).toBe('Ana:\n> uno\n> dos');
	});

	test('un mensaje larguísimo se recorta', () => {
		// Citar mil líneas para escribir dos arriba hace que la respuesta pese
		// más que la conversación entera, y nadie la lee.
		const largo = Array.from({ length: 1000 }, (_, i) => `línea ${i}`).join('\n');
		const citado = citar(largo, 'Ana:');

		expect(citado.split('\n').length).toBeLessThan(110);
		expect(citado.endsWith('> […]')).toBe(true);
	});
});

describe('responder', () => {
	test('arma la respuesta entera', () => {
		const r = responder(original(), 'Ana escribió:');

		expect(r.para).toEqual(['ana@ejemplo.com']);
		expect(r.asunto).toBe('Re: Reunión');
		expect(r.en_respuesta_a).toBe('<original@ejemplo.com>');
		// El original al final de la cadena: es el que sigue en la conversación.
		expect(r.referencias).toEqual(['<primero@ejemplo.com>', '<original@ejemplo.com>']);
	});

	test('el cursor arranca arriba de la cita', () => {
		// Dejarlo pegado al texto citado obliga a hacerle lugar a mano cada vez.
		const r = responder(original(), 'Ana escribió:');
		expect(r.cuerpo.startsWith('\n\n')).toBe(true);
		expect(r.cuerpo).toContain('> Nos vemos el jueves.');
	});

	test('la respuesta va al Reply-To y no a quien apretó mandar', () => {
		// Las listas de correo y los sistemas de tickets lo ponen justamente
		// para eso. Ignorarlo manda la respuesta al lugar equivocado.
		const r = responder(original({ responder_a: 'lista@grupo.com' }), 'Ana:');
		expect(r.para).toEqual(['lista@grupo.com']);
	});

	test('sin Reply-To se responde al remitente', () => {
		const r = responder(original({ responder_a: '' }), 'Ana:');
		expect(r.para).toEqual(['ana@ejemplo.com']);
	});

	test('un mensaje sin identificador se puede responder igual', () => {
		// Los hay mal armados. Sin cabecera de conversación, pero con
		// destinatario y con cita.
		const r = responder(original({ message_id: '', referencias: [] }), 'Ana:');
		expect(r.en_respuesta_a).toBe('');
		expect(r.referencias).toEqual([]);
		expect(r.para).toEqual(['ana@ejemplo.com']);
	});

	test('el identificador no se repite si ya estaba en la cadena', () => {
		const r = responder(
			original({ referencias: ['<primero@x>', '<original@ejemplo.com>'] }),
			'Ana:'
		);
		expect(r.referencias).toEqual(['<primero@x>', '<original@ejemplo.com>']);
	});
});

describe('direcciones', () => {
	test('parte por coma y por punto y coma', () => {
		// La gente escribe las dos, y pegar una lista de Outlook trae punto y
		// coma.
		expect(direcciones('a@x.com, b@y.com')).toEqual(['a@x.com', 'b@y.com']);
		expect(direcciones('a@x.com; b@y.com')).toEqual(['a@x.com', 'b@y.com']);
		expect(direcciones('a@x.com,b@y.com; c@z.com')).toEqual([
			'a@x.com',
			'b@y.com',
			'c@z.com',
		]);
	});

	test('una coma de más no deja un destinatario en blanco', () => {
		// El servidor rechaza el mensaje entero por un `RCPT TO:<>`.
		expect(direcciones('a@x.com,')).toEqual(['a@x.com']);
		expect(direcciones(' , a@x.com , , ')).toEqual(['a@x.com']);
		expect(direcciones('')).toEqual([]);
		expect(direcciones('   ')).toEqual([]);
	});
});
