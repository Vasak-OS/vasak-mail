/**
 * Las preferencias de la aplicación, del lado que las usa.
 *
 * Se leen una vez al arrancar y quedan en memoria: son de esta ventana y esta
 * ventana es la única que las escribe, así que no hay nadie más que las pueda
 * cambiar por debajo. El servicio las relee cada vez porque él sí puede
 * encontrarse con un cambio que hizo la ventana; acá no pasa lo contrario.
 *
 * Es un módulo y no un `ref` por componente: si cada uno leyera lo suyo, cambiar
 * una preferencia dejaría a la mitad de la ventana con el valor viejo hasta
 * reiniciarla.
 */
import { invoke } from '@tauri-apps/api/core';
import { ref } from 'vue';
import { SEGUNDOS_PARA_DESHACER, segundosValidos } from '@/tools/deshacer';

/** Con qué se abre un mensaje. */
export type Vista = 'formato' | 'texto';

const VISTAS: readonly Vista[] = ['formato', 'texto'];
const JUEGOS = ['gmail', 'vim'] as const;

/**
 * Con formato, que es lo que la gente espera de un correo.
 *
 * La vista de texto no desaparece: es la que sirve cuando un mensaje se ve raro
 * o cuando no se le tiene confianza a quien lo mandó.
 */
const vistaPorOmision = ref<Vista>('formato');
const juegoDeAtajos = ref<string>('gmail');

/**
 * Cuánto dura la ventana para arrepentirse de un envío.
 *
 * Ésta es **sólo de la ventana**: el servicio recibe una hora ya calculada y no
 * necesita saber de dónde salió. Vive en el mismo archivo que las demás igual,
 * porque tener dos lugares según quién lee sería peor que tener uno.
 */
const segundosParaDeshacer = ref<number>(SEGUNDOS_PARA_DESHACER);

let cargadas = false;

/** Lee el archivo. Se llama una vez, al arrancar la ventana. */
export async function cargarPreferencias(): Promise<void> {
	if (cargadas) {
		return;
	}
	cargadas = true;
	try {
		const guardado = JSON.parse(await invoke<string>('leer_preferencias'));

		// Cada una sólo si es uno de los valores que existen. Un valor raro en
		// el archivo no puede dejar la ventana en un estado que no es ninguno.
		if (VISTAS.includes(guardado?.vista_por_omision)) {
			vistaPorOmision.value = guardado.vista_por_omision;
		}
		if ((JUEGOS as readonly string[]).includes(guardado?.juego_de_atajos)) {
			juegoDeAtajos.value = guardado.juego_de_atajos;
		}
		// Ésta se acota en vez de descartarse: un número fuera de rango sigue
		// diciendo qué quiso la persona. Ver `segundosValidos`.
		if (guardado?.segundos_para_deshacer !== undefined) {
			segundosParaDeshacer.value = segundosValidos(guardado.segundos_para_deshacer);
		}
	} catch (e) {
		// Sin preferencias se usan las de siempre, que es lo que había antes de
		// que existiera este archivo. No poder leerlas no puede impedir abrir.
		console.error('no se pudieron leer las preferencias', e);
	}
}

/** Guarda una y la deja valiendo en el acto. */
export async function guardarPreferencia(clave: string, valor: unknown): Promise<void> {
	await invoke('poner_preferencia', { clave, valor });

	if (clave === 'vista_por_omision' && VISTAS.includes(valor as Vista)) {
		vistaPorOmision.value = valor as Vista;
	}
	if (clave === 'juego_de_atajos' && typeof valor === 'string') {
		juegoDeAtajos.value = valor;
	}
	if (clave === 'segundos_para_deshacer') {
		segundosParaDeshacer.value = segundosValidos(valor);
	}
}

export function usePreferencias() {
	return { vistaPorOmision, juegoDeAtajos, segundosParaDeshacer };
}
