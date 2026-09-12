/**
 * Buscar en el correo que ya está en la ventana.
 *
 * Es la mitad instantánea de la búsqueda: sobre los resúmenes que ya llegaron,
 * sin tocar la red y sin latencia por tecla. La otra mitad la hace el servidor
 * y llega más lejos.
 *
 * **Las dos hacen falta y ninguna reemplaza a la otra**, y eso es lo que obliga
 * a decir cuál se está mostrando. Un campo de búsqueda que filtra en silencio
 * los últimos doscientos de una casilla contesta «no hay nada» sobre un mensaje
 * que existe, y esa es la peor forma de contestar una búsqueda.
 *
 * El criterio es el mismo que el de la agenda de `vasak-contacts`: sin acentos,
 * en minúsculas, por subcadena.
 */
import type { Resumen } from '@/composables/use-correo';

/**
 * Quita los acentos para comparar.
 *
 * Buscar «reunion» tiene que encontrar «reunión». Nadie escribe los acentos en
 * un buscador —ni siquiera quien los escribe bien en todo lo demás—, y una
 * búsqueda que no los ignora simplemente dice que no hay nada.
 *
 * `NFD` separa la letra de su tilde y el rango que se saca son las tildes: es lo
 * que convierte «é» en «e» sin enumerar las letras de ningún alfabeto.
 *
 * **La eñe también se va**, y eso sorprende: en NFD la «ñ» es una «n» con una
 * tilde encima, así que el mismo paso que hace que «reunion» encuentre
 * «reunión» hace que «ano» encuentre «año». Se deja así porque buscar «munoz»
 * y encontrar a «Muñoz» es lo que espera quien escribe, y porque es lo mismo
 * que hace la agenda de `vasak-contacts`.
 */
export function sinAcentos(texto: string): string {
	return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Los mensajes que coinciden con lo que se escribió.
 *
 * Se busca en el remitente, en su dirección y en el asunto: es lo que hay en un
 * resumen. **El cuerpo no está acá** —no se guarda en ninguna parte— y por eso
 * el filtro local no puede encontrar por contenido, que es una de las razones
 * por las que la búsqueda en el servidor no es opcional.
 *
 * Cada palabra tiene que aparecer en alguna parte, no todas en la misma:
 * escribir «ana factura» encuentra el mensaje de Ana sobre la factura.
 */
export function filtrados(mensajes: Resumen[], consulta: string): Resumen[] {
	const palabras = sinAcentos(consulta)
		.split(/\s+/)
		.filter((p) => p.length > 0);
	if (palabras.length === 0) {
		return mensajes;
	}

	return mensajes.filter((mensaje) => {
		const dondeBuscar = sinAcentos([mensaje.de, mensaje.direccion, mensaje.asunto].join(' '));
		return palabras.every((palabra) => dondeBuscar.includes(palabra));
	});
}

/** Qué se está mostrando en la lista. */
export type Alcance = 'todo' | 'local' | 'servidor';

/**
 * El alcance de lo que se ve, para poder decirlo.
 *
 * No es cosmético: sin esto la lista cambia de significado sin aviso. «Los
 * últimos doscientos que coinciden» y «todo lo que el servidor encontró» son
 * respuestas distintas a la misma pregunta, y quien mira no tiene cómo
 * distinguirlas.
 */
export function alcance(consulta: string, hayResultadosDelServidor: boolean): Alcance {
	if (consulta.trim() === '') {
		return 'todo';
	}
	return hayResultadosDelServidor ? 'servidor' : 'local';
}
