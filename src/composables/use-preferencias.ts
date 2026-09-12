import { invoke } from '@tauri-apps/api/core';
import { readonly, ref } from 'vue';
import { leidas, POR_OMISION, type Preferencias } from '@/tools/preferencias';

/**
 * Las preferencias de la aplicación, cargadas una vez y compartidas.
 *
 * **Fuera de la función**, o sea una sola copia para toda la ventana: dos
 * composables con su propio estado mostrarían valores distintos del mismo
 * ajuste, y guardar en uno no actualizaría al otro.
 *
 * Arranca con lo de omisión y no vacío: el archivo se lee en un viaje al
 * programa, y hasta que conteste hay que dibujar algo. Lo que se dibuja es lo
 * que pasaba antes de que existieran las preferencias, así que un arranque lento
 * no se nota.
 */
const preferencias = ref<Preferencias>({ ...POR_OMISION });
let cargadas = false;

/**
 * Las preferencias y cómo cambiarlas.
 *
 * El archivo lo escribe el programa —ver `preferencias.rs`— y lo lee además
 * `vasak-accounts-sync`, que necesita algunas y corre con la ventana cerrada.
 */
export function usePreferencias() {
	const guardando = ref(false);

	/**
	 * Lee el archivo, una sola vez por sesión.
	 *
	 * No hace falta más: esta ventana es el único que escribe, así que lo que
	 * hay en memoria y lo que hay en el disco no se separan nunca.
	 */
	async function cargar() {
		if (cargadas) {
			return;
		}
		cargadas = true;
		try {
			const crudo = await invoke<string | null>('leer_preferencias');
			// `leidas` es la que sabe qué hacer con un archivo a medias, editado
			// a mano o escrito por una versión anterior. Ver `tools/preferencias.ts`.
			preferencias.value = leidas(crudo ? JSON.parse(crudo) : null);
		} catch (e) {
			// Que no se puedan leer no puede impedir abrir el correo: se usan las
			// de omisión, que son lo que pasaba antes de que existieran.
			console.error('no se pudieron leer las preferencias', e);
			preferencias.value = { ...POR_OMISION };
		}
	}

	/**
	 * Guarda un cambio.
	 *
	 * Se aplica en pantalla **antes** de que el disco conteste: una casilla que
	 * tarda medio segundo en moverse se siente rota. Si la escritura falla se
	 * vuelve atrás, que es la única forma de no mentir sobre lo que quedó
	 * guardado.
	 */
	async function cambiar(cambio: Partial<Preferencias>): Promise<boolean> {
		const antes = preferencias.value;
		const nuevas = leidas({ ...antes, ...cambio });
		preferencias.value = nuevas;
		guardando.value = true;

		try {
			await invoke('guardar_preferencias', { contenido: JSON.stringify(nuevas) });
			return true;
		} catch (e) {
			console.error('no se pudieron guardar las preferencias', e);
			preferencias.value = antes;
			return false;
		} finally {
			guardando.value = false;
		}
	}

	return { preferencias: readonly(preferencias), guardando, cargar, cambiar };
}
