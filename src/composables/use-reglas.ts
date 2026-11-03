/**
 * Las reglas de correo de una cuenta (Vasak-OS/vasak-accounts#20).
 *
 * La ventana edita; la lógica (evaluar, aplicar, la marca de agua) vive en el
 * servicio. Acá sólo se lee y se escribe por los comandos del proxy, y se
 * refresca cuando el servicio avisa por el evento `reglas-cambio`.
 *
 * Los nombres de los campos son los del cable (español), los mismos que
 * serializa el servicio: así una `Regla` va y vuelve sin traducir.
 */

import { invoke } from '@tauri-apps/api/core';
import { ref } from 'vue';

export type Operador = 'todas' | 'cualquiera';

export type Campo =
	| 'de'
	| 'para'
	| 'cc'
	| 'asunto'
	| 'responder_a'
	| 'list_id'
	| 'tamano'
	| 'tiene_adjuntos';

export type Prueba = 'contiene' | 'igual' | 'empieza_con' | 'mayor' | 'menor';

export interface Condicion {
	campo: Campo;
	prueba: Prueba;
	valor: string;
	negar: boolean;
}

export interface Coincidencia {
	operador: Operador;
	condiciones: Condicion[];
}

/** Una acción: las tres sueltas, o `mover_a` con la carpeta destino. */
export type Accion = 'marcar_leido' | 'destacar' | 'borrar' | { mover_a: string };

/** El tipo de acción, aplanado para el editor (donde `mover_a` es una opción más). */
export type TipoAccion = 'marcar_leido' | 'destacar' | 'borrar' | 'mover_a';

/** Separa una acción del cable en (tipo, carpeta), para editarla con selectores. */
export function tipoDeAccion(accion: Accion): { tipo: TipoAccion; carpeta: string } {
	return typeof accion === 'string'
		? { tipo: accion, carpeta: '' }
		: { tipo: 'mover_a', carpeta: accion.mover_a };
}

/** Arma la acción del cable desde (tipo, carpeta): `mover_a` lleva la carpeta. */
export function accionDesde(tipo: TipoAccion, carpeta: string): Accion {
	return tipo === 'mover_a' ? { mover_a: carpeta } : tipo;
}

export interface Regla {
	id: string;
	nombre: string;
	activa: boolean;
	coincidencia: Coincidencia;
	acciones: Accion[];
	detener: boolean;
}

const reglas = ref<Regla[]>([]);
const cargando = ref(false);
const error = ref('');

/** Una regla nueva, con una condición y una acción por defecto, lista para editar. */
export function reglaNueva(): Regla {
	return {
		id: '',
		nombre: '',
		activa: true,
		coincidencia: {
			operador: 'todas',
			condiciones: [{ campo: 'de', prueba: 'contiene', valor: '', negar: false }],
		},
		acciones: [{ mover_a: '' }],
		detener: false,
	};
}

/**
 * El nuevo orden de ids al mover la regla `id` un lugar hacia `dir`.
 *
 * Devuelve `null` si no se puede mover (ya está en la punta, o el id no está):
 * así quien llama no manda un reordenamiento que no cambia nada.
 */
export function ordenAlMover(
	actuales: Regla[],
	id: string,
	dir: 'arriba' | 'abajo'
): string[] | null {
	const i = actuales.findIndex((r) => r.id === id);
	if (i === -1) {
		return null;
	}
	const j = dir === 'arriba' ? i - 1 : i + 1;
	if (j < 0 || j >= actuales.length) {
		return null;
	}
	const ids = actuales.map((r) => r.id);
	[ids[i], ids[j]] = [ids[j], ids[i]];
	return ids;
}

export function useReglas() {
	async function cargar(accountId: string) {
		if (!accountId) {
			reglas.value = [];
			return;
		}
		cargando.value = true;
		error.value = '';
		try {
			reglas.value = await invoke<Regla[]>('list_rules', { accountId });
		} catch (e) {
			error.value = String(e);
		} finally {
			cargando.value = false;
		}
	}

	/** Crea una regla (el servicio le asigna el id) y recarga. */
	async function crear(accountId: string, regla: Regla): Promise<boolean> {
		return await escribir(accountId, async () => {
			const { id: _descartado, ...sinId } = regla;
			await invoke<string>('create_rule', { accountId, ruleJson: JSON.stringify(sinId) });
		});
	}

	/** Reemplaza una regla existente (por su id) y recarga. */
	async function actualizar(accountId: string, regla: Regla): Promise<boolean> {
		return await escribir(accountId, async () => {
			await invoke('update_rule', { accountId, ruleJson: JSON.stringify(regla) });
		});
	}

	async function borrar(accountId: string, id: string): Promise<boolean> {
		return await escribir(accountId, async () => {
			await invoke('delete_rule', { accountId, ruleId: id });
		});
	}

	/** Prende o apaga una regla sin abrir el editor. */
	async function alternarActiva(accountId: string, regla: Regla): Promise<boolean> {
		return await actualizar(accountId, { ...regla, activa: !regla.activa });
	}

	/** Mueve una regla un lugar arriba o abajo en la prioridad. */
	async function mover(accountId: string, id: string, dir: 'arriba' | 'abajo'): Promise<boolean> {
		const ids = ordenAlMover(reglas.value, id, dir);
		if (!ids) {
			return false;
		}
		return await escribir(accountId, async () => {
			await invoke('reorder_rules', { accountId, ids });
		});
	}

	/** Corre una escritura, recarga ante éxito, y deja el error a la vista si falla. */
	async function escribir(accountId: string, accion: () => Promise<void>): Promise<boolean> {
		error.value = '';
		try {
			await accion();
			await cargar(accountId);
			return true;
		} catch (e) {
			error.value = String(e);
			return false;
		}
	}

	return { reglas, cargando, error, cargar, crear, actualizar, borrar, alternarActiva, mover };
}
