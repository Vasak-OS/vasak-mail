/**
 * Cómo se arma una respuesta a partir de un mensaje.
 *
 * Aparte de los componentes y sin nada de Vue adentro, porque son tres reglas
 * chicas que se equivocan fácil y que se notan tarde: un asunto con dos «Re:»,
 * una cita sin citar, una respuesta que llega a la persona equivocada.
 */

/** Lo que hace falta del mensaje original. */
export interface Original {
	asunto: string;
	texto: string;
	de: string;
	/** A dónde va la respuesta: el `Reply-To` si lo hay, y el remitente si no. */
	responder_a: string;
	fecha: string;
	message_id: string;
	referencias: string[];
}

/** Lo que se abre en la ventana de redacción. */
export interface Respuesta {
	para: string[];
	asunto: string;
	cuerpo: string;
	en_respuesta_a: string;
	referencias: string[];
}

/** Cuántas líneas del original se citan. */
const MAX_LINEAS_CITADAS = 100;

/**
 * El asunto de una respuesta.
 *
 * Sin acumular «Re:». Responder cinco veces en una conversación deja
 * «Re: Re: Re: Re: Re: Hola», que es lo que hacen los clientes que comparan sin
 * mirar mayúsculas ni idiomas. Se saca cualquier prefijo que ya esté.
 */
export function asuntoDeRespuesta(asunto: string): string {
	// `Re:`, `RE:`, `Re :`, y `Rv:`/`RV:` que es lo que ponen algunos clientes
	// en español. Repetido, porque puede haber varios encadenados.
	const prefijo = /^\s*(re|rv)\s*:\s*/i;
	let limpio = asunto.trim();
	while (prefijo.test(limpio)) {
		limpio = limpio.replace(prefijo, '');
	}
	return `Re: ${limpio}`;
}

/**
 * El texto del original, citado.
 *
 * Con `>` adelante de cada línea, que es lo que todo cliente de correo entiende
 * como cita desde hace cuarenta años. Las líneas que ya están citadas reciben
 * otro `>`, así los niveles de la conversación se distinguen.
 *
 * Se recorta: citar un mensaje de mil líneas para escribir dos arriba hace que
 * la respuesta pese más que la conversación entera, y nadie lo lee.
 */
export function citar(texto: string, encabezado: string): string {
	const lineas = texto.replace(/\r\n/g, '\n').split('\n');
	const recortado = lineas.length > MAX_LINEAS_CITADAS;
	const citadas = lineas
		.slice(0, MAX_LINEAS_CITADAS)
		// Sin espacio si la línea ya empieza con `>`: así los niveles quedan
		// pegados (`>>`) como espera cualquier cliente, en vez de `> >`.
		.map((l) => (l.startsWith('>') ? `>${l}` : `> ${l}`))
		.join('\n');

	return `${encabezado}\n${citadas}${recortado ? '\n> […]' : ''}`;
}

/**
 * Arma la respuesta.
 *
 * `encabezado` lo pone la ventana ya traducido —«El 10 de septiembre, Ana
 * escribió:»—, porque acá no hay traducciones.
 *
 * El cuerpo arranca con **dos líneas en blanco** antes de la cita: es donde va
 * a escribir la persona, y dejar el cursor pegado al texto citado obliga a
 * hacerle lugar a mano cada vez.
 */
export function responder(original: Original, encabezado: string): Respuesta {
	// A dónde va: el `Reply-To` si el mensaje lo trae. Las listas de correo y
	// los sistemas de tickets lo ponen justamente para que la respuesta no le
	// llegue sólo a quien apretó mandar.
	const destino = original.responder_a || original.de;

	// El original al final de la cadena, sin repetirlo si ya está.
	const referencias = [...original.referencias];
	if (original.message_id && referencias.at(-1) !== original.message_id) {
		referencias.push(original.message_id);
	}

	return {
		para: destino ? [destino] : [],
		asunto: asuntoDeRespuesta(original.asunto),
		cuerpo: `\n\n${citar(original.texto, encabezado)}`,
		en_respuesta_a: original.message_id,
		referencias,
	};
}

/**
 * Parte lo que se escribió en un campo de direcciones.
 *
 * Por comas y por punto y coma: la gente escribe las dos, y pegar una lista de
 * Outlook trae punto y coma. Lo vacío se descarta, así una coma de más al final
 * no deja un destinatario en blanco que el servidor rechaza.
 */
export function direcciones(texto: string): string[] {
	return texto
		.split(/[,;]/)
		.map((d) => d.trim())
		.filter((d) => d.length > 0);
}
