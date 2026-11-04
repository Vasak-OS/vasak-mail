/**
 * Reglas de correo en la ventana (Vasak-OS/vasak-accounts#20).
 *
 * Se comprueba a qué comando y con qué argumentos viaja cada operación y el
 * reordenamiento por prioridad; el doble de `invoke` contesta igual con o sin
 * los argumentos correctos, así que se mira lo que se le pidió.
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import {
	accionDesde,
	ordenAlMover,
	type Regla,
	reglaNueva,
	tipoDeAccion,
	useReglas,
} from '@/composables/use-reglas';
import { contestar, fallar, invocaciones, olvidarTodo } from './dobles';

setDefaultTimeout(30_000);

function regla(id: string, nombre = id): Regla {
	return {
		id,
		nombre,
		activa: true,
		coincidencia: { operador: 'todas', condiciones: [{ campo: 'de', prueba: 'contiene', valor: 'x', negar: false }] },
		acciones: [{ mover_a: 'Bancos' }],
		detener: false,
	};
}

const creados = () => invocaciones.filter((i) => i.comando === 'create_rule');
const reordenes = () => invocaciones.filter((i) => i.comando === 'reorder_rules');
const borrados = () => invocaciones.filter((i) => i.comando === 'delete_rule');
const editados = () => invocaciones.filter((i) => i.comando === 'update_rule');

afterEach(() => {
	olvidarTodo();
	contestar('list_rules', []);
});

describe('ordenAlMover', () => {
	const tres = [regla('a'), regla('b'), regla('c')];

	test('sube y baja intercambiando con el vecino', () => {
		expect(ordenAlMover(tres, 'b', 'arriba')).toEqual(['b', 'a', 'c']);
		expect(ordenAlMover(tres, 'b', 'abajo')).toEqual(['a', 'c', 'b']);
	});

	test('en la punta o con un id que no está, no hay movimiento', () => {
		expect(ordenAlMover(tres, 'a', 'arriba')).toBeNull();
		expect(ordenAlMover(tres, 'c', 'abajo')).toBeNull();
		expect(ordenAlMover(tres, 'z', 'arriba')).toBeNull();
	});
});

describe('acción ida y vuelta', () => {
	test('mover_a lleva la carpeta; las sueltas, no', () => {
		expect(tipoDeAccion({ mover_a: 'Bancos' })).toEqual({ tipo: 'mover_a', carpeta: 'Bancos' });
		expect(tipoDeAccion('marcar_leido')).toEqual({ tipo: 'marcar_leido', carpeta: '' });
		expect(accionDesde('mover_a', 'Bancos')).toEqual({ mover_a: 'Bancos' });
		expect(accionDesde('destacar', 'ignorada')).toBe('destacar');
	});
});

describe('reglaNueva', () => {
	test('trae una condición y una acción, activa y sin id', () => {
		const r = reglaNueva();
		expect(r.id).toBe('');
		expect(r.activa).toBe(true);
		expect(r.coincidencia.condiciones).toHaveLength(1);
		expect(r.acciones).toHaveLength(1);
	});
});

describe('useReglas', () => {
	test('cargar sin cuenta no pide nada y deja la lista vacía', async () => {
		const r = useReglas();
		await r.cargar('');
		expect(invocaciones.some((i) => i.comando === 'list_rules')).toBe(false);
		expect(r.reglas.value).toEqual([]);
	});

	test('un error al escribir devuelve false y lo deja a la vista', async () => {
		fallar('create_rule', 'sin permiso');
		const r = useReglas();
		const ok = await r.crear('ana', regla('x'));
		expect(ok).toBe(false);
		expect(r.error.value).toContain('sin permiso');
	});

	test('un error al cargar lo deja a la vista', async () => {
		fallar('list_rules', 'bus caído');
		const r = useReglas();
		await r.cargar('ana');
		expect(r.error.value).toContain('bus caído');
	});

	test('cargar pide las reglas de la cuenta', async () => {
		contestar('list_rules', [regla('a')]);
		const r = useReglas();
		await r.cargar('ana');
		const pedido = invocaciones.find((i) => i.comando === 'list_rules');
		expect(pedido?.args).toEqual({ accountId: 'ana' });
		expect(r.reglas.value.map((x) => x.id)).toEqual(['a']);
	});

	test('crear manda la regla sin id y recarga', async () => {
		contestar('create_rule', 'id-nuevo');
		contestar('list_rules', []);
		const r = useReglas();
		const ok = await r.crear('ana', regla('se-descarta', 'Banco'));
		expect(ok).toBe(true);
		expect(creados()).toHaveLength(1);
		const { accountId, ruleJson } = creados()[0].args as { accountId: string; ruleJson: string };
		expect(accountId).toBe('ana');
		const enviada = JSON.parse(ruleJson);
		expect(enviada.id).toBeUndefined();
		expect(enviada.nombre).toBe('Banco');
		// Recarga tras crear.
		expect(invocaciones.some((i) => i.comando === 'list_rules')).toBe(true);
	});

	test('alternar activa edita con el valor invertido', async () => {
		contestar('update_rule', undefined);
		contestar('list_rules', []);
		const r = useReglas();
		await r.alternarActiva('ana', regla('a'));
		expect(editados()).toHaveLength(1);
		const { ruleJson } = editados()[0].args as { ruleJson: string };
		expect(JSON.parse(ruleJson).activa).toBe(false);
	});

	test('mover reordena con los ids intercambiados', async () => {
		contestar('list_rules', [regla('a'), regla('b')]);
		const r = useReglas();
		await r.cargar('ana');
		contestar('reorder_rules', undefined);
		const ok = await r.mover('ana', 'b', 'arriba');
		expect(ok).toBe(true);
		expect(reordenes()).toHaveLength(1);
		expect(reordenes()[0].args).toEqual({ accountId: 'ana', ids: ['b', 'a'] });
	});

	test('mover en la punta no llama al servicio', async () => {
		contestar('list_rules', [regla('a'), regla('b')]);
		const r = useReglas();
		await r.cargar('ana');
		const ok = await r.mover('ana', 'a', 'arriba');
		expect(ok).toBe(false);
		expect(reordenes()).toHaveLength(0);
	});

	test('borrar manda el id', async () => {
		contestar('delete_rule', undefined);
		contestar('list_rules', []);
		const r = useReglas();
		await r.borrar('ana', 'a');
		expect(borrados()[0].args).toEqual({ accountId: 'ana', ruleId: 'a' });
	});
});
