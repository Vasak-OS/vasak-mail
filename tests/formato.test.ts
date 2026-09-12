import { describe, expect, test } from 'bun:test';
import {
	type Colores,
	conLasImagenes,
	documentoDe,
	POLITICA,
	POLITICA_CON_IMAGENES,
} from '../src/tools/formato';

const COLORES: Colores = {
	fondo: '#111',
	texto: '#eee',
	apagado: '#999',
	enlace: '#7aa2f7',
	borde: '#333',
};

describe('documentoDe', () => {
	test('lleva la política de contenido puesta', () => {
		// Es una cadena, y una cadena mal escrita no falla en ningún lado:
		// simplemente deja de proteger, y nadie se entera hasta que un mensaje
		// carga algo que no debía.
		const documento = documentoDe('<p>hola</p>', COLORES);
		expect(documento).toContain('http-equiv="Content-Security-Policy"');
		expect(documento).toContain(POLITICA);
	});

	test('la política no deja cargar nada', () => {
		// **La segunda red debajo de las imágenes bloqueadas.** Aunque un `src`
		// remoto sobreviviera al saneado del servicio, acá no llega a salir a la
		// red — y no salir a la red es lo que impide avisarle a quien mandó el
		// correo que se abrió.
		expect(POLITICA).toContain("default-src 'none'");
	});

	test('lo único que se permite son los estilos de la aplicación', () => {
		// El mensaje no trae los suyos: el atributo `style` y la etiqueta
		// `<style>` los saca el saneador antes de que esto llegue.
		const permisos = POLITICA.split(';').map((p) => p.trim());
		expect(permisos).toEqual(["default-src 'none'", "style-src 'unsafe-inline'"]);
	});

	test('el fragmento entra tal cual, que es el punto', () => {
		// Ya viene saneado del servicio y lo que se quiere es dibujarlo. Lo que
		// lo hace seguro no es escaparlo acá, es la política y el contenedor sin
		// permisos.
		const documento = documentoDe('<p><strong>Hola</strong> Ana</p>', COLORES);
		expect(documento).toContain('<p><strong>Hola</strong> Ana</p>');
	});

	test('los colores del tema van adentro', () => {
		// Un documento aislado no hereda nada: sin esto el mensaje sale con los
		// colores por omisión del motor, o sea un rectángulo blanco en una
		// ventana oscura.
		const documento = documentoDe('<p>x</p>', COLORES);
		expect(documento).toContain(COLORES.fondo);
		expect(documento).toContain(COLORES.texto);
		expect(documento).toContain(COLORES.enlace);
	});

	test('es un documento entero y no un pedazo', () => {
		// Un fragmento suelto dentro del contenedor lo dibuja el motor en modo
		// de compatibilidad, donde los tamaños y los márgenes salen distintos.
		const documento = documentoDe('<p>x</p>', COLORES);
		expect(documento.startsWith('<!doctype html>')).toBe(true);
		expect(documento).toContain('<meta charset="utf-8">');
		expect(documento.trimEnd().endsWith('</html>')).toBe(true);
	});

	test('un mensaje vacío sigue siendo un documento válido', () => {
		const documento = documentoDe('', COLORES);
		expect(documento).toContain('<body></body>');
	});
});

describe('POLITICA_CON_IMAGENES', () => {
	test('deja ver imágenes pero no abre la red', () => {
		// **La diferencia que importa.** Con `img-src https:` el documento podría
		// pedir cualquier cosa, que es exactamente lo que este trabajo evita. Lo
		// que se muestra ya vino traído por el servicio y viaja adentro del
		// documento.
		expect(POLITICA_CON_IMAGENES).toContain('img-src data:');
		expect(POLITICA_CON_IMAGENES).not.toContain('https:');
		expect(POLITICA_CON_IMAGENES).not.toContain('http:');
		expect(POLITICA_CON_IMAGENES).toContain("default-src 'none'");
	});

	test('el documento usa una u otra según lo que se pidió', () => {
		expect(documentoDe('<p>x</p>', COLORES, false)).toContain(POLITICA);
		expect(documentoDe('<p>x</p>', COLORES, true)).toContain(POLITICA_CON_IMAGENES);
	});

	test('sin pedirlo, la política es la cerrada', () => {
		// El valor por omisión importa: una imagen que se carga sin que nadie la
		// haya pedido es el aviso al remitente que todo esto evita.
		expect(documentoDe('<p>x</p>', COLORES)).toContain(POLITICA);
	});
});

describe('conLasImagenes', () => {
	const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

	test('le devuelve el src a las que se trajeron, con el contenido adentro', () => {
		// Con el contenido y **no con la dirección**: el documento sigue sin
		// poder salir a la red, y lo que se ve es lo que el servicio ya trajo.
		const fragmento = '<img data-vsk-src="https://ejemplo.com/p.png" alt="">';
		const salida = conLasImagenes(fragmento, new Map([['https://ejemplo.com/p.png', PIXEL]]));

		expect(salida).toContain(`src="${PIXEL}"`);
		expect(salida).not.toContain('src="https://ejemplo.com/p.png"');
	});

	test('lo que no se pudo traer se queda como estaba', () => {
		// Sin `src`, o sea mostrando su texto alternativo, que es lo que ya hacía.
		const fragmento = '<img data-vsk-src="https://ejemplo.com/rota.png" alt="un gato">';
		const salida = conLasImagenes(fragmento, new Map());

		expect(salida).toBe(fragmento);
		expect(salida).not.toContain(' src=');
	});

	test('con varias, cada una la suya', () => {
		const fragmento =
			'<img data-vsk-src="https://a.com/1.png"><img data-vsk-src="https://b.com/2.png">';
		const otro = 'data:image/gif;base64,R0lGOD';
		const salida = conLasImagenes(
			fragmento,
			new Map([
				['https://a.com/1.png', PIXEL],
				['https://b.com/2.png', otro],
			])
		);

		expect(salida).toContain(`src="${PIXEL}"`);
		expect(salida).toContain(`src="${otro}"`);
	});

	test('una dirección con & escapado se encuentra igual', () => {
		// El saneador escapa al guardar la dirección; acá hay que deshacerlo o la
		// imagen nunca coincide con la que se trajo. Pasa con cualquier dirección
		// que lleve parámetros, que son casi todas las de seguimiento.
		const fragmento = '<img data-vsk-src="https://ejemplo.com/p.png?a=1&amp;b=2">';
        const salida = conLasImagenes(
			fragmento,
			new Map([['https://ejemplo.com/p.png?a=1&b=2', PIXEL]])
		);

		expect(salida).toContain(`src="${PIXEL}"`);
	});

	test('un fragmento sin imágenes no se toca', () => {
		const fragmento = '<p>hola</p>';
		expect(conLasImagenes(fragmento, new Map())).toBe(fragmento);
	});
});
