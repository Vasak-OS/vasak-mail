/**
 * La ventana para arrepentirse después de apretar «Enviar».
 *
 * # Por qué existe
 *
 * El error que se arregla con esto no es escribir mal: es mandar. Apretar
 * «Enviar» y ver en ese instante que el destinatario está mal, que faltaba el
 * adjunto, o que la respuesta iba a otro lado. Un mensaje que ya salió no
 * vuelve.
 *
 * Por dentro no es nada nuevo: se encola pidiendo que no salga antes de dentro
 * de unos segundos, y deshacer es sacarlo de la cola antes de que le toque. Lo
 * que agrega esta pieza es la cuenta regresiva y el borrador guardado para
 * devolvérselo a la persona.
 */

/**
 * Cuántos segundos hay para arrepentirse.
 *
 * Diez. Cinco alcanza para el arrepentimiento inmediato y no para leer el
 * cartel; treinta hacen que el correo parezca trabado y que alguien cierre la
 * ventana creyendo que no salió. Diez es lo que tarda la mirada en volver a la
 * pantalla y darse cuenta.
 *
 * Va acá y no en el servicio: el servicio recibe una hora, y quien la calcula
 * es quien dibuja el botón.
 */
export const SEGUNDOS_PARA_DESHACER = 10;

/**
 * La hora en RFC 3339 a partir de la cual el mensaje puede salir.
 *
 * En UTC, que es lo que el servicio espera: `toISOString()` ya lo da así, y
 * mandar una hora local sin zona haría salir el mensaje con horas de
 * diferencia según dónde esté el equipo.
 */
export function noAntesDe(desde: Date, segundos = SEGUNDOS_PARA_DESHACER): string {
	return new Date(desde.getTime() + segundos * 1000).toISOString();
}

/**
 * Cuántos segundos quedan para que salga, sin bajar de cero.
 *
 * Se calcula contra el reloj y no se lleva un contador: un contador que se
 * decrementa cada segundo se atrasa cuando la pestaña está en segundo plano o
 * el equipo suspende, y el cartel terminaría ofreciendo deshacer algo que ya
 * salió.
 */
export function quedan(hasta: string, ahora: Date): number {
	const fin = Date.parse(hasta);
	if (Number.isNaN(fin)) {
		return 0;
	}
	return Math.max(0, Math.ceil((fin - ahora.getTime()) / 1000));
}
