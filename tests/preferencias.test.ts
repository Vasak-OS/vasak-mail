import { describe, expect, test } from 'bun:test';
import {
	leidas,
	MAX_SEGUNDOS_PARA_DESHACER,
	POR_OMISION,
	type Preferencias,
} from '../src/tools/preferencias';

describe('POR_OMISION', () => {
	test('es lo conservador, que es lo que ya pasaba', () => {
		// **Agregar la preferencia no puede cambiar en silencio lo que hacía la
		// aplicación.** Quien no abra esto nunca tiene que seguir viendo lo de
		// antes: un cartel que no nombra a nadie y diez segundos para deshacer.
		expect(POR_OMISION.detalleDelAviso).toBe('cantidad');
		expect(POR_OMISION.segundosParaDeshacer).toBe(10);
	});
});

describe('leidas', () => {
	test('lo que estaba guardado se respeta', () => {
		const guardado: Preferencias = { detalleDelAviso: 'asunto', segundosParaDeshacer: 30 };
		expect(leidas(guardado)).toEqual(guardado);
	});

	test('un archivo que no está, o que no es un objeto, da lo de omisión', () => {
		// Es el caso de la primera vez, y también el de un archivo que quedó a
		// medias. Ninguno puede impedir que la aplicación abra.
		for (const nada of [null, undefined, 'texto', 42, [], true]) {
			expect(leidas(nada)).toEqual({ ...POR_OMISION });
		}
	});

	test('un campo que falta usa el de omisión y no rompe el resto', () => {
		// Pasa con un archivo escrito por una versión anterior que no tenía ese
		// campo todavía.
		expect(leidas({ segundosParaDeshacer: 5 })).toEqual({
			detalleDelAviso: POR_OMISION.detalleDelAviso,
			segundosParaDeshacer: 5,
		});
	});

	test('un detalle que no existe cae a lo conservador', () => {
		// **No a cualquier otro valor: al que menos muestra.** El archivo se puede
		// editar a mano, y un valor raro no puede terminar en un cartel que nombra
		// a quien te escribió.
		for (const raro of ['todo', 'DETALLE', '', null, 3, { a: 1 }]) {
			expect(leidas({ detalleDelAviso: raro }).detalleDelAviso).toBe('cantidad');
		}
	});

	test('los segundos se acotan', () => {
		// Sin tope, un número enorme deja los mensajes esperando para siempre y
		// parece que el correo no manda.
		expect(leidas({ segundosParaDeshacer: 999_999 }).segundosParaDeshacer).toBe(
			MAX_SEGUNDOS_PARA_DESHACER
		);
		expect(leidas({ segundosParaDeshacer: 7.6 }).segundosParaDeshacer).toBe(8);
	});

	test('cero vale, y hay que elegirlo a propósito', () => {
		// Cero es «mandá en el acto», que es una elección válida. Por eso lo que
		// no se entiende cae al valor de omisión y **no** a cero: a esa elección
		// no se llega por accidente.
		expect(leidas({ segundosParaDeshacer: 0 }).segundosParaDeshacer).toBe(0);
		for (const raro of [-5, Number.NaN, Number.POSITIVE_INFINITY, '10', null]) {
			expect(leidas({ segundosParaDeshacer: raro }).segundosParaDeshacer).toBe(
				POR_OMISION.segundosParaDeshacer
			);
		}
	});

	test('lo que sobra en el archivo se ignora', () => {
		// Un campo de una versión más nueva, o algo que alguien escribió a mano.
		const leido = leidas({ detalleDelAviso: 'remitente', inventado: true });
		expect(leido).toEqual({
			detalleDelAviso: 'remitente',
			segundosParaDeshacer: POR_OMISION.segundosParaDeshacer,
		});
	});
});
