/**
 * Cómo se llama una carpeta en pantalla.
 *
 * Aparte y con pruebas porque es una regla corta con una trampa: el nombre que
 * se muestra **no** siempre es el que mandó el servidor, y elegir mal deja a la
 * persona buscando «Enviados» en una lista que dice «Sent».
 */

/** Lo mínimo de una carpeta que hace falta para nombrarla. */
export interface Nombrable {
	/** El nombre que le puso quien la creó, ya decodificado. */
	nombre: string;
	/** `entrada`, `enviados`, `papelera`… o `ninguno`. Lo calcula el servicio. */
	uso: string;
}

/**
 * El nombre traducido de las carpetas conocidas, y el del servidor para el resto.
 *
 * Un servidor en inglés dice «Sent» y uno en español «Elementos enviados»; que
 * la misma carpeta se llame distinto según el proveedor es ruido, y encima
 * cambia de idioma a mitad de la ventana.
 *
 * Las que **no** se reconocen se muestran con el nombre que les puso quien las
 * creó, que es el correcto: una carpeta «Facturas 2026» no tiene traducción ni
 * debería tenerla.
 *
 * `t` entra por argumento y no se importa acá adentro para que esto se pueda
 * probar sin montar el plugin de idiomas — y porque es la misma razón por la
 * que el resto de `tools/` no sabe nada de Vue.
 */
export function nombreDeCasilla(casilla: Nombrable, t: (clave: string) => string): string {
	const clave = `casillas.${casilla.uso}`;
	const traducido = t(clave);
	// El plugin devuelve **la clave misma** cuando no la encuentra. Es la única
	// señal que da de que no hay traducción; sin comprobarlo, una carpeta sin
	// nombre conocido aparecía como «casillas.ninguno».
	return traducido === clave ? casilla.nombre : traducido;
}
