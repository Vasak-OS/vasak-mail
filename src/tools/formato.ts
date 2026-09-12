/**
 * El documento que se dibuja adentro del contenedor aislado.
 *
 * ── Por qué hay un documento y no se inserta el HTML y ya ───────────────────
 *
 * El servicio ya saneó lo que manda: sin `<script>`, sin `on*`, sin `<iframe>`
 * y sin ninguna imagen cargándose sola. Insertar eso en el árbol de la
 * aplicación igual sería apostar todo a que ese saneado no tenga un agujero — y
 * el que escribe el correo es cualquiera que sepa la dirección de la persona.
 *
 * Así que además se **aísla**: el mensaje se dibuja en un contenedor cerrado,
 * con su propia política de contenido y sin permiso para ejecutar nada. Sanear y
 * aislar son dos cosas distintas y ninguna reemplaza a la otra. Si algo se
 * escapó del saneado, acá no puede correr; si el contenedor fallara, lo que hay
 * adentro ya venía limpio.
 *
 * ── Qué hace la política de acá adentro ─────────────────────────────────────
 *
 * `default-src 'none'`: nada se carga. Ni imágenes, ni tipografías, ni hojas de
 * estilo, ni peticiones. **Es la segunda red debajo de las imágenes
 * bloqueadas**: aunque un `src` remoto hubiera sobrevivido al saneado, acá no
 * llega a salir a la red — y no salir a la red es lo que impide avisarle a quien
 * mandó el correo que se abrió.
 *
 * `style-src 'unsafe-inline'` es la única excepción, y es para los estilos de
 * abajo, que son nuestros. El mensaje no puede traer los suyos: el atributo
 * `style` y la etiqueta `<style>` los saca el saneador antes.
 *
 * ── Y los colores ───────────────────────────────────────────────────────────
 *
 * Van copiados del tema de la ventana. Un documento aislado no hereda nada, así
 * que sin esto el mensaje sale con los colores por omisión del motor: un
 * rectángulo blanco en una ventana oscura.
 */

/**
 * Pone las imágenes que se trajeron en el documento.
 *
 * El saneador del servicio dejó la dirección en `data-vsk-src` y sacó el `src`,
 * así que un mensaje sin esto no pide nada. Acá se le devuelve el `src`, pero
 * **con el contenido adentro** —un `data:`— y no con la dirección: el documento
 * sigue sin poder salir a la red, y lo que se ve es lo que el servicio ya trajo.
 *
 * Lo que no se pudo traer se queda sin `src` y muestra su texto alternativo, que
 * es lo que ya hacía.
 */
export function conLasImagenes(fragmento: string, traidas: Map<string, string>): string {
	// Sobre el texto y no sobre el árbol, a propósito: lo que sale de acá entra
	// en un documento aislado y sin permisos, así que lo peor que produce un
	// error de este reemplazo es una imagen que no se ve.
	return fragmento.replace(
		/<img\b([^>]*?)\bdata-vsk-src="([^"]*)"/gi,
		(entera, antes: string, direccion: string) => {
			const dato = traidas.get(desescapar(direccion));
			return dato ? `<img${antes}src="${dato}"` : entera;
		}
	);
}

/** Deshace lo que el saneador escapó al guardar la dirección. */
function desescapar(direccion: string): string {
	return direccion.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/** Los colores del tema que se le pasan al mensaje. */
export interface Colores {
	fondo: string;
	texto: string;
	apagado: string;
	enlace: string;
	borde: string;
}

/** Lo que el servicio manda cuando el mensaje traía formato. */
export interface Saneado {
	html: string;
	/** Cuántas imágenes remotas se bloquearon. Ver `html.rs` del sincronizador. */
	imagenes_bloqueadas: number;
	recortado: boolean;
}

/**
 * La política del documento aislado.
 *
 * Aparte y exportada para poder comprobarla en una prueba: es una cadena, y una
 * cadena mal escrita no falla en ningún lado — simplemente deja de proteger.
 */
export const POLITICA = "default-src 'none'; style-src 'unsafe-inline'";

/**
 * La política cuando la persona pidió ver las imágenes.
 *
 * `img-src data:` y nada más: las imágenes que se muestran ya vienen traídas por
 * el servicio y van adentro del documento como `data:`. **No se abre la red**, y
 * ésa es la diferencia que importa — con `img-src https:` el documento podría
 * pedir cualquier cosa, que es exactamente lo que este trabajo evita.
 *
 * Un `data:` no puede ejecutar nada en un `<img>`: el servicio además rechaza el
 * SVG, que es el único formato de imagen que es en realidad un documento.
 */
export const POLITICA_CON_IMAGENES = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/**
 * Arma el documento completo que va adentro del contenedor.
 *
 * El fragmento entra **sin escapar**, que es el punto: ya viene saneado del
 * servicio y lo que se quiere es dibujarlo. Lo que lo hace seguro no es escapar
 * acá, es la política de arriba más el contenedor sin permisos.
 */
export function documentoDe(fragmento: string, colores: Colores, conImagenes = false): string {
	return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${conImagenes ? POLITICA_CON_IMAGENES : POLITICA}">
<style>
  html { color-scheme: only light dark; }
  body {
    margin: 0; padding: 1rem;
    background: ${colores.fondo}; color: ${colores.texto};
    font-family: system-ui, sans-serif; font-size: 0.875rem; line-height: 1.5;
    overflow-wrap: anywhere;
  }
  a { color: ${colores.enlace}; }
  blockquote {
    margin: 0.5rem 0; padding-left: 0.75rem;
    border-left: 2px solid ${colores.borde}; color: ${colores.apagado};
  }
  table { border-collapse: collapse; }
  td, th { border: 1px solid ${colores.borde}; padding: 0.25rem 0.5rem; }
  /* Una imagen que no se cargó deja su hueco con el texto alternativo. Sin
     esto, un mensaje lleno de imágenes bloqueadas se ve como un mensaje roto
     en vez de uno al que le faltan las imágenes a propósito. */
  img { max-width: 100%; height: auto; }
</style>
</head><body>${fragmento}</body></html>`;
}

/**
 * Lee del tema de la ventana los colores que el mensaje necesita.
 *
 * Con respaldos, porque esto corre antes de que el tema termine de cargar y un
 * color vacío deja el texto del color del fondo — o sea, invisible.
 */
export function coloresDelTema(raiz: HTMLElement): Colores {
	const leer = (variable: string, respaldo: string) => {
		const valor = getComputedStyle(raiz).getPropertyValue(variable).trim();
		return valor || respaldo;
	};

	return {
		fondo: leer('--use-ui-surface', '#1e2230'),
		texto: leer('--use-text-main', '#e6e8ee'),
		apagado: leer('--use-text-muted', '#9aa0b0'),
		enlace: leer('--use-primary', '#7aa2f7'),
		borde: leer('--use-ui-border', '#3a4056'),
	};
}
