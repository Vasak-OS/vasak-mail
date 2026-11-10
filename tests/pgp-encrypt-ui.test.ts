/**
 * El interruptor de cifrar con OpenPGP del redactor y el estado de clave de cada
 * destinatario.
 *
 * Se monta con el catálogo **de verdad** (`src-tauri/locales/{es,en}.yml`): lo
 * que importa es lo que la persona lee —quién falta— y que el interruptor no se
 * pueda prender si algún destinatario no tiene una clave usable.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, setDefaultTimeout, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { Badge } from '@vasakgroup/vue-libvasak';
import I18n, { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { nextTick } from 'vue';
import ComposeComponent from '@/components/mail/ComposeComponent.vue';
import type { Borrador } from '@/composables/use-correo';
import { CATALOGO, contestar, invocaciones, olvidarTodo } from './dobles';

setDefaultTimeout(60_000);

const LOAD = 'plugin:i18n|load_translations';
const RESOLVE = 'resolver_clave_destinatario';

function flatten(tree: Record<string, unknown>, prefix = ''): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (value && typeof value === 'object') Object.assign(out, flatten(value as Record<string, unknown>, path));
		else out[path] = String(value);
	}
	return out;
}

let es: Record<string, string> = {};
let en: Record<string, string> = {};

function resetI18n() {
	(I18n as unknown as { instance: unknown }).instance = undefined;
	useI18n();
}

beforeAll(async () => {
	const leer = async (idioma: string) =>
		flatten(Bun.YAML.parse(await Bun.file(`${import.meta.dir}/../src-tauri/locales/${idioma}.yml`).text()) as Record<string, unknown>);
	es = await leer('es');
	en = await leer('en');
	contestar(LOAD, { es: { ...CATALOGO.es, ...es } });
	resetI18n();
	await I18n.getInstance().load();
});

afterAll(() => {
	contestar(LOAD, CATALOGO);
	contestar(RESOLVE, undefined);
	resetI18n();
});

/** Lo que el servicio dice de una dirección. */
type Clave = { present: boolean; expired?: boolean; revoked?: boolean };
const USABLE: Clave = { present: true, expired: false, revoked: false };
/** Qué contesta el servicio por dirección; lo que no está, no tiene clave. */
let claves: Record<string, Clave | 'falla'> = {};

beforeEach(() => {
	jest.useFakeTimers();
	claves = {};
	contestar(RESOLVE, (args: { address: string }) => {
		const clave = claves[args.address.toLowerCase()] ?? { present: false };
		if (clave === 'falla') throw 'Failed';
		return clave;
	});
});

const vistas = new Set<VueWrapper>();

afterEach(() => {
	for (const vista of vistas) vista.unmount();
	vistas.clear();
	document.body.innerHTML = '';
	olvidarTodo();
	jest.useRealTimers();
});

/** Sólo microtareas: con el reloj detenido un `setTimeout(0)` no vuelve. */
async function asentar(rondas = 8) {
	for (let i = 0; i < rondas; i++) {
		await nextTick();
		await Promise.resolve();
	}
}

/** Pasa la espera del debounce y deja que terminen las resoluciones. */
async function esperarClaves(ms = 500) {
	jest.advanceTimersByTime(ms);
	await asentar();
}

const BORRADOR: Borrador = {
	para: ['ana@ejemplo.org'],
	cc: [],
	asunto: 'Hola',
	cuerpo: 'Texto',
	en_respuesta_a: '',
	referencias: [],
};

function redactar(cambios: Partial<Borrador> = {}, cuenta = 'yo') {
	const vista = mount(ComposeComponent, {
		props: { inicial: { ...BORRADOR, ...cambios }, esRespuesta: false, enviando: false, cuentas: [], cuenta },
		attachTo: document.body,
	});
	vistas.add(vista);
	return vista;
}

function interruptor(etiqueta: string): HTMLElement {
	const found = [...document.body.querySelectorAll<HTMLElement>('[role="switch"]')].find((el) => el.textContent?.includes(etiqueta));
	if (!found) throw new Error(`no está el interruptor «${etiqueta}»`);
	return found;
}

const cifrar = () => interruptor(es['redactar.cifrarPgp']);
const deshabilitado = (el: HTMLElement) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
const encendido = () => cifrar().getAttribute('aria-checked') === 'true';
const texto = () => document.body.textContent ?? '';
const llamadasAlResolver = () => invocaciones.filter((i) => i.comando === RESOLVE);

async function borradorEnviado(vista: VueWrapper): Promise<Borrador> {
	document.body.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
	await asentar();
	return (vista.emitted('enviar')?.at(-1) as [Borrador, string])[0];
}

/** Escribe en el campo con esa etiqueta, como quien teclea. */
async function escribir(etiqueta: string, valor: string) {
	const label = [...document.body.querySelectorAll('label')].find((l) => l.textContent?.trim() === etiqueta);
	const input = label && document.getElementById(label.htmlFor);
	if (!(input instanceof HTMLInputElement)) throw new Error(`no está el campo «${etiqueta}»`);
	input.value = valor;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await asentar();
}

/** El mensaje de lo que falta, con los nombres puestos. */
const faltan = (...nombres: string[]) => es['redactar.cifrarPgpFalta'].replace('{0}', nombres.join(', '));

describe('el redactor: la puerta de cifrar con OpenPGP', () => {
	test('un destinatario sin clave: deshabilitado, lo nombra y un clic no lo prende', async () => {
		const vista = redactar();
		await esperarClaves();

		expect(deshabilitado(cifrar())).toBe(true);
		expect(texto()).toContain(faltan('ana@ejemplo.org'));
		cifrar().click();
		await asentar();
		expect(encendido()).toBe(false);
		expect((await borradorEnviado(vista)).metodo_cifrado).toBeUndefined();
	});

	test('con la clave de To pero no la de alguien en Cc: sigue bloqueado y nombra al de Cc', async () => {
		claves['ana@ejemplo.org'] = USABLE;
		redactar({ cc: ['copia@ejemplo.org'] });
		await esperarClaves();

		expect(deshabilitado(cifrar())).toBe(true);
		expect(texto()).toContain(faltan('copia@ejemplo.org'));
		expect(texto()).not.toContain(faltan('ana@ejemplo.org'));
	});

	test('si faltan varios, los nombra a todos', async () => {
		claves['ana@ejemplo.org'] = USABLE;
		redactar({ para: ['ana@ejemplo.org', 'sin1@ejemplo.org'], cc: ['sin2@ejemplo.org'] });
		await esperarClaves();

		expect(deshabilitado(cifrar())).toBe(true);
		expect(texto()).toContain(faltan('sin1@ejemplo.org', 'sin2@ejemplo.org'));
	});

	test('una clave presente pero vencida cuenta como faltante', async () => {
		claves['ana@ejemplo.org'] = { present: true, expired: true, revoked: false };
		redactar();
		await esperarClaves();

		expect(deshabilitado(cifrar())).toBe(true);
		expect(texto()).toContain(faltan('ana@ejemplo.org'));
	});

	test('una clave presente pero revocada cuenta como faltante', async () => {
		claves['ana@ejemplo.org'] = { present: true, expired: false, revoked: true };
		redactar();
		await esperarClaves();

		expect(deshabilitado(cifrar())).toBe(true);
		expect(texto()).toContain(faltan('ana@ejemplo.org'));
	});

	test('falla cerrado: si el servicio falla, el destinatario queda sin clave y no se puede cifrar', async () => {
		claves['ana@ejemplo.org'] = 'falla';
		const vista = redactar();
		await esperarClaves();

		expect(llamadasAlResolver()).toHaveLength(1);
		expect(deshabilitado(cifrar())).toBe(true);
		expect(texto()).toContain(faltan('ana@ejemplo.org'));
		cifrar().click();
		await asentar();
		expect((await borradorEnviado(vista)).metodo_cifrado).toBeUndefined();
	});

	test('una respuesta vacía del servicio tampoco lo habilita', async () => {
		contestar(RESOLVE, () => undefined);
		redactar();
		await esperarClaves();
		expect(deshabilitado(cifrar())).toBe(true);
	});

	test('sin destinatarios: deshabilitado y pide agregar', async () => {
		redactar({ para: [], cc: [] });
		await esperarClaves();

		expect(deshabilitado(cifrar())).toBe(true);
		expect(texto()).toContain(es['redactar.cifrarPgpSinDestinatarios']);
	});
});

describe('el redactor: con clave de todos', () => {
	test('habilitado, con su explicación; encendido el borrador sale con `metodo_cifrado: pgp`', async () => {
		claves['ana@ejemplo.org'] = USABLE;
		claves['copia@ejemplo.org'] = USABLE;
		const vista = redactar({ cc: ['copia@ejemplo.org'] });
		await esperarClaves();

		expect(deshabilitado(cifrar())).toBe(false);
		expect(texto()).toContain(es['redactar.cifrarPgpPorQue']);
		cifrar().click();
		await asentar();
		expect(encendido()).toBe(true);
		expect((await borradorEnviado(vista)).metodo_cifrado).toBe('pgp');
	});

	test('apagado, el borrador sale sin el campo', async () => {
		claves['ana@ejemplo.org'] = USABLE;
		const vista = redactar();
		await esperarClaves();

		cifrar().click();
		await asentar();
		cifrar().click();
		await asentar();
		expect(JSON.stringify(await borradorEnviado(vista))).not.toContain('metodo_cifrado');
	});

	/**
	 * Cambió a propósito: antes un borrador restaurado con `metodo_cifrado: pgp`
	 * arrancaba encendido. Pero al montar las claves aún se están resolviendo, y
	 * un interruptor encendido sin clave de todos mostraba «cifrado» sobre un
	 * mensaje que no se iba a cifrar. Ahora arranca apagado y la persona lo
	 * prende cuando ya se sabe que todos tienen clave.
	 */
	test('un borrador con `metodo_cifrado: pgp` arranca apagado y, resueltas las claves, se prende a mano', async () => {
		claves['ana@ejemplo.org'] = USABLE;
		const vista = redactar({ metodo_cifrado: 'pgp' });
		await asentar();

		expect(encendido()).toBe(false);
		await esperarClaves();
		expect(deshabilitado(cifrar())).toBe(false);
		expect(encendido()).toBe(false);
		expect(JSON.stringify(await borradorEnviado(vista))).not.toContain('metodo_cifrado');

		cifrar().click();
		await asentar();
		expect(encendido()).toBe(true);
		expect((await borradorEnviado(vista)).metodo_cifrado).toBe('pgp');
	});

	test('encendido, si se cambia el destinatario por uno sin clave, se apaga solo', async () => {
		claves['ana@ejemplo.org'] = USABLE;
		const vista = redactar();
		await esperarClaves();
		cifrar().click();
		await asentar();
		expect(encendido()).toBe(true);

		await escribir(es['redactar.para'], 'otra@ejemplo.org');
		await esperarClaves();

		expect(encendido()).toBe(false);
		expect(deshabilitado(cifrar())).toBe(true);
		expect(JSON.stringify(await borradorEnviado(vista))).not.toContain('metodo_cifrado');
	});
});

describe('el redactor: un borrador que pide cifrar sin clave de todos', () => {
	test('no muestra cifrado ni lo manda: apagado y sin `metodo_cifrado`', async () => {
		claves['ana@ejemplo.org'] = USABLE;
		const vista = redactar({ para: ['ana@ejemplo.org', 'sin@ejemplo.org'], metodo_cifrado: 'pgp' });
		await asentar();
		expect(encendido()).toBe(false);

		await esperarClaves();
		expect(deshabilitado(cifrar())).toBe(true);
		expect(encendido()).toBe(false);
		expect(texto()).toContain(faltan('sin@ejemplo.org'));
		expect(JSON.stringify(await borradorEnviado(vista))).not.toContain('metodo_cifrado');
	});

	test('mandar antes de que resuelvan las claves tampoco cifra', async () => {
		const vista = redactar({ metodo_cifrado: 'pgp' });
		await asentar();
		expect(JSON.stringify(await borradorEnviado(vista))).not.toContain('metodo_cifrado');
	});
});

describe('el redactor: resolver con debounce y caché', () => {
	test('no se pregunta por tecla: una sola vez, tras 500 ms de quietud', async () => {
		claves['ana@ejemplo.org'] = USABLE;
		redactar({ para: [] });
		await asentar();

		for (const parcial of ['a', 'an', 'ana@', 'ana@ejemplo.org']) {
			await escribir(es['redactar.para'], parcial);
			jest.advanceTimersByTime(300);
			await asentar();
		}
		expect(llamadasAlResolver()).toHaveLength(0);

		await esperarClaves();
		expect(llamadasAlResolver()).toHaveLength(1);
		expect(llamadasAlResolver()[0].args).toEqual({ accountId: 'yo', address: 'ana@ejemplo.org' });
	});

	test('una dirección ya resuelta no se vuelve a preguntar, aunque cambien las mayúsculas', async () => {
		claves['ana@ejemplo.org'] = USABLE;
		redactar();
		await esperarClaves();
		expect(llamadasAlResolver()).toHaveLength(1);

		await escribir(es['redactar.para'], 'ana@ejemplo.org, Ana@Ejemplo.org');
		await esperarClaves();
		await escribir(es['redactar.para'], 'ANA@EJEMPLO.ORG');
		await esperarClaves();
		expect(llamadasAlResolver()).toHaveLength(1);
		expect(deshabilitado(cifrar())).toBe(false);
	});

	test('un destinatario nuevo se pregunta, y sólo él', async () => {
		claves['ana@ejemplo.org'] = USABLE;
		redactar();
		await esperarClaves();

		await escribir(es['redactar.cc'], 'nueva@ejemplo.org');
		await esperarClaves();
		expect(llamadasAlResolver().map((i) => (i.args as { address: string }).address)).toEqual(['ana@ejemplo.org', 'nueva@ejemplo.org']);
	});

	test('mientras se resuelve: chip «resolviendo», explicación de espera y deshabilitado', async () => {
		claves['ana@ejemplo.org'] = USABLE;
		redactar();
		await asentar();

		expect(llamadasAlResolver()).toHaveLength(0);
		expect(deshabilitado(cifrar())).toBe(true);
		expect(texto()).toContain(`ana@ejemplo.org · ${es['redactar.clave_resolving']}`);
		expect(texto()).toContain(es['redactar.cifrarPgpResolviendo']);
		expect(texto()).not.toContain(faltan('ana@ejemplo.org'));
	});

	test('una dirección sin `@` no se resuelve y queda resolviendo', async () => {
		redactar({ para: ['ana'] });
		await esperarClaves();

		expect(llamadasAlResolver()).toHaveLength(0);
		expect(texto()).toContain(`ana · ${es['redactar.clave_resolving']}`);
		expect(deshabilitado(cifrar())).toBe(true);
	});
});

describe('el redactor: chips de clave por destinatario', () => {
	const chip = (direccion: string) => {
		const found = [...document.body.querySelectorAll<HTMLElement>('ul[aria-label] li')].find((li) => li.textContent?.includes(direccion));
		if (!found) throw new Error(`no hay chip para ${direccion}`);
		return found;
	};

	/** La clase de fondo con la que el Badge de la biblioteca pinta cada tono. */
	function clasesDe(tono: string): string {
		const ref = mount(Badge, { props: { tone: tono as 'success', dot: true, label: 'x' }, attachTo: document.body });
		vistas.add(ref);
		return ref.classes().find((c) => c.startsWith('bg-')) ?? '';
	}

	test('cada destinatario muestra su estado con el tono que toca', async () => {
		claves['si@ejemplo.org'] = USABLE;
		redactar({ para: ['si@ejemplo.org', 'no@ejemplo.org', 'espera'] });
		await esperarClaves();

		const esperado: [string, string, string][] = [
			['si@ejemplo.org', 'success', es['redactar.clave_yes']],
			['no@ejemplo.org', 'warning', es['redactar.clave_no']],
			['espera', 'neutral', es['redactar.clave_resolving']],
		];
		for (const [dir, tono, etiqueta] of esperado) {
			const li = chip(dir);
			expect(li.textContent).toContain(`${dir} · ${etiqueta}`);
			const badge = li.firstElementChild as HTMLElement;
			expect(clasesDe(tono)).toMatch(/^bg-/);
			expect(badge.classList.contains(clasesDe(tono))).toBe(true);
		}
		expect(clasesDe('success')).not.toBe(clasesDe('warning'));
		expect(clasesDe('warning')).not.toBe(clasesDe('neutral'));
	});

	test('los chips no llevan colores literales: sólo los tokens del esquema', async () => {
		redactar({ para: ['si@ejemplo.org', 'no@ejemplo.org'] });
		await esperarClaves();

		const lista = document.body.querySelector('ul[aria-label]') as HTMLElement;
		const html = lista.outerHTML;
		expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
		expect(html).not.toMatch(/\b(rgb|hsl|oklch)a?\(/i);
		expect(html).not.toMatch(/\b(bg|text|border)-(red|green|yellow|amber|orange|emerald|gray|slate)-\d/);
	});

	test('la lista se nombra para quien lee con lector de pantalla', async () => {
		redactar();
		await esperarClaves();
		expect(document.body.querySelector(`ul[aria-label="${es['redactar.claveDestinatarios']}"]`)).not.toBeNull();
	});
});

describe('el redactor: cambiar de cuenta', () => {
	test('con otra cuenta la clave se vuelve a resolver (la caché es por cuenta)', async () => {
		claves['ana@ejemplo.org'] = USABLE;
		const vista = redactar({}, 'yo');
		await esperarClaves();
		expect(llamadasAlResolver()).toHaveLength(1);

		await vista.setProps({ cuenta: 'trabajo' });
		expect(deshabilitado(cifrar())).toBe(true); // vuelve a resolviendo
		await esperarClaves();

		expect(llamadasAlResolver().map((i) => (i.args as { accountId: string }).accountId)).toEqual(['yo', 'trabajo']);
		expect(deshabilitado(cifrar())).toBe(false);
	});
});

describe('los textos del cifrado en los dos idiomas', () => {
	const CLAVES = ['cifrarPgp', 'cifrarPgpPorQue', 'cifrarPgpFalta', 'cifrarPgpResolviendo', 'cifrarPgpSinDestinatarios', 'claveDestinatarios', 'clave_resolving', 'clave_yes', 'clave_no'];

	test('las nueve claves existen y no están vacías en es y en', () => {
		for (const catalogo of [es, en]) {
			for (const clave of CLAVES) expect(catalogo[`redactar.${clave}`]?.trim().length).toBeGreaterThan(0);
		}
	});

	test('el aviso de faltantes lleva `{0}` en los dos idiomas y se llena con `.replace`', () => {
		for (const catalogo of [es, en]) {
			const mensaje = catalogo['redactar.cifrarPgpFalta'];
			expect(mensaje).toContain('{0}');
			const lleno = mensaje.replace('{0}', 'a@x.org, b@x.org');
			expect(lleno).toContain('a@x.org, b@x.org');
			expect(lleno).not.toContain('{0}');
		}
	});
});
