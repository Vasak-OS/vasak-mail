import { describe, expect, test } from 'bun:test';
import { type Colores, documentoDe, POLITICA } from '../src/tools/formato';

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
