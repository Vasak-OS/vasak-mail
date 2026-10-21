/**
 * La identidad S/MIME de cada cuenta: la tarjeta de Preferencias para importar
 * o quitar el certificado, y el interruptor de firmar que depende de él.
 *
 * Se monta con el catálogo **de verdad** (`src-tauri/locales/es.yml`): lo que
 * importa es el mensaje que lee la persona por cada código de error, y una
 * clave cruda no lo dice. El `invoke` es el único doble de toda la suite
 * (`tests/dobles.ts`).
 */

import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import I18n, { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import ComposeComponent from '@/components/mail/ComposeComponent.vue';
import PreferencesComponent from '@/components/mail/PreferencesComponent.vue';
import SmimeIdentityCard from '@/components/mail/SmimeIdentityCard.vue';
import type { Borrador, Cuenta } from '@/composables/use-correo';
import { CATALOGO, contestar, fallar, invocaciones, olvidarTodo } from './dobles';

// Compilar los `.vue` la primera vez pasa los cinco segundos de fábrica.
setDefaultTimeout(60_000);

const LOAD = 'plugin:i18n|load_translations';
const STATE = 'estado_identidad_smime';
const IMPORT = 'importar_identidad_smime';
const REMOVE = 'quitar_identidad_smime';
const DIALOG = 'plugin:dialog|open';

/** `{ smime: { cifrado: 'x' } }` → `{ 'smime.cifrado': 'x' }`, como lo da el plugin. */
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

/** Tira el singleton de i18n y deja el estado del composable reflejando uno vacío. */
function resetI18n() {
	(I18n as unknown as { instance: unknown }).instance = undefined;
	// El composable refleja la instancia en cada `useI18n()`: sin esta llamada
	// el próximo archivo vería los textos resueltos donde espera las claves.
	useI18n();
}

beforeAll(async () => {
	const yaml = Bun.YAML.parse(await Bun.file(`${import.meta.dir}/../src-tauri/locales/es.yml`).text());
	es = flatten(yaml as Record<string, unknown>);
	contestar(LOAD, { es: { ...CATALOGO.es, ...es } });
	resetI18n();
	await I18n.getInstance().load();
});

afterAll(() => {
	// Lo que ven los demás archivos: el catálogo con la clave de prueba y el
	// singleton sin cargar. Sin esto el resultado depende del orden en que Bun
	// recorra los archivos.
	contestar(LOAD, CATALOGO);
	resetI18n();
});

const vistas = new Set<VueWrapper>();

function anotar<T extends VueWrapper>(vista: T): T {
	vistas.add(vista);
	return vista;
}

afterEach(() => {
	for (const vista of vistas) vista.unmount();
	vistas.clear();
	document.body.innerHTML = '';
	olvidarTodo();
	// `olvidarTodo` no toca las respuestas: lo que se contestó acá no pasa al
	// archivo que sigue.
	contestar(STATE, undefined);
	contestar(IMPORT, undefined);
	contestar(REMOVE, undefined);
	contestar(DIALOG, undefined);
});

async function asentar() {
	for (let i = 0; i < 6; i++) await flushPromises();
}

const CUENTA: Cuenta = { account_id: 'a1', display_name: 'ana@ejemplo.org', sin_leer: 0, error: '' };
const SIN_IDENTIDAD = { present: false, email: null, not_after: null };
const CON_IDENTIDAD = { present: true, email: 'ana@ejemplo.org', not_after: '2027-01-31T12:00:00Z' };
const RUTA = '/home/ana/Descargas/ana.p12';

function tarjeta(cuenta: Cuenta = CUENTA) {
	return anotar(mount(SmimeIdentityCard, { props: { cuenta }, attachTo: document.body }));
}

function boton(vista: VueWrapper, texto: string) {
	const found = vista.findAll('button').find((b) => b.text().trim() === texto);
	if (!found) throw new Error(`no hay botón «${texto}»`);
	return found;
}

function campoDeContrasena(vista: VueWrapper) {
	return vista.find<HTMLInputElement>('input[type="password"], input[autocomplete="off"]');
}

/** Cuántas veces se le preguntó al servicio por el estado de la identidad. */
function consultas(): number {
	return invocaciones.filter((i) => i.comando === STATE).length;
}

/** Elige el archivo en el diálogo y escribe la contraseña, como lo haría la persona. */
async function llenar(vista: VueWrapper, contrasena = 'hunter2') {
	contestar(DIALOG, RUTA);
	await boton(vista, es['smime.elegir']).trigger('click');
	await asentar();
	await campoDeContrasena(vista).setValue(contrasena);
	await asentar();
}

describe('la tarjeta de S/MIME: qué muestra', () => {
	test('con identidad: el correo del certificado, cuándo vence y «Quitar»', async () => {
		contestar(STATE, CON_IDENTIDAD);
		const vista = tarjeta();
		await asentar();

		const hasta = new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(
			new Date(CON_IDENTIDAD.not_after)
		);
		expect(vista.text()).toContain('ana@ejemplo.org');
		expect(vista.text()).toContain(`vence el ${hasta}`);
		expect(boton(vista, es['smime.quitar'])).toBeDefined();
		// Y nada del formulario de importar.
		expect(vista.findAll('button').some((b) => b.text().trim() === es['smime.importar'])).toBe(false);
		expect(vista.findAll('button').some((b) => b.text().trim() === es['smime.elegir'])).toBe(false);
		expect(campoDeContrasena(vista).exists()).toBe(false);
	});

	test('una fecha que no se entiende se muestra tal cual vino', async () => {
		contestar(STATE, { ...CON_IDENTIDAD, not_after: 'cuando se pueda' });
		const vista = tarjeta();
		await asentar();

		expect(vista.text()).toContain('vence el cuando se pueda');
	});

	test('con identidad pero sin fecha no dice «vence»', async () => {
		contestar(STATE, { ...CON_IDENTIDAD, not_after: null });
		const vista = tarjeta();
		await asentar();

		expect(vista.text()).toContain('ana@ejemplo.org');
		expect(vista.text()).not.toContain('vence');
	});

	test('sin identidad: el selector de .p12, la contraseña y «Importar» (apagado)', async () => {
		contestar(STATE, SIN_IDENTIDAD);
		const vista = tarjeta();
		await asentar();

		expect(vista.text()).toContain(es['smime.ausente']);
		expect(boton(vista, es['smime.elegir'])).toBeDefined();
		expect(campoDeContrasena(vista).exists()).toBe(true);
		expect(boton(vista, es['smime.importar']).attributes('disabled')).toBeDefined();
		expect(vista.findAll('button').some((b) => b.text().trim() === es['smime.quitar'])).toBe(false);
	});

	test('pregunta por la cuenta de la tarjeta', async () => {
		contestar(STATE, SIN_IDENTIDAD);
		tarjeta();
		await asentar();

		expect(invocaciones.find((i) => i.comando === STATE)?.args).toEqual({ accountId: 'a1' });
	});

	test('el diálogo sólo ofrece .p12 y .pfx', async () => {
		contestar(STATE, SIN_IDENTIDAD);
		const vista = tarjeta();
		await asentar();

		contestar(DIALOG, RUTA);
		await boton(vista, es['smime.elegir']).trigger('click');
		await asentar();

		const opciones = invocaciones.find((i) => i.comando === DIALOG)?.args as {
			options: { filters: { extensions: string[] }[]; multiple: boolean };
		};
		expect(opciones.options.filters[0].extensions).toEqual(['p12', 'pfx']);
		expect(opciones.options.multiple).toBe(false);
		expect(vista.text()).toContain('ana.p12');
	});

	test('«Importar» se enciende con archivo y contraseña, y no antes', async () => {
		contestar(STATE, SIN_IDENTIDAD);
		const vista = tarjeta();
		await asentar();

		contestar(DIALOG, RUTA);
		await boton(vista, es['smime.elegir']).trigger('click');
		await asentar();
		expect(boton(vista, es['smime.importar']).attributes('disabled')).toBeDefined();

		await campoDeContrasena(vista).setValue('hunter2');
		await asentar();
		expect(boton(vista, es['smime.importar']).attributes('disabled')).toBeUndefined();
	});
});

describe('la tarjeta de S/MIME: cada error tiene su mensaje', () => {
	const CODIGOS: [string, string][] = [
		['WrongPassword', 'smime.errorWrongPassword'],
		['TooBig', 'smime.errorTooBig'],
		['AddressMismatch', 'smime.errorAddressMismatch'],
		['UnsupportedLegacy', 'smime.errorUnsupportedLegacy'],
		['Malformed', 'smime.errorMalformed'],
		['KeyringLocked', 'smime.errorKeyringLocked'],
		// El que el lado Rust usa para todo lo demás, y uno que nadie conoce.
		['Failed', 'smime.errorFailed'],
		['algo-que-nadie-conoce', 'smime.errorFailed'],
	];

	for (const [codigo, clave] of CODIGOS) {
		test(`importar con «${codigo}» muestra «${clave}»`, async () => {
			contestar(STATE, SIN_IDENTIDAD);
			const vista = tarjeta();
			await asentar();
			await llenar(vista);

			fallar(IMPORT, codigo);
			await boton(vista, es['smime.importar']).trigger('click');
			await asentar();

			const aviso = vista.find('[role="alert"]');
			expect(aviso.exists()).toBe(true);
			expect(aviso.text()).toBe(es[clave]);
			// Y no se llega a traducir con la clave a la vista.
			expect(vista.text()).not.toContain('smime.error');
		});
	}

	test('cada código tiene un mensaje propio y ninguno es una clave sin traducir', () => {
		const textos = CODIGOS.map(([, clave]) => es[clave]);
		for (const texto of textos) expect(texto).toBeTruthy();
		// Los siete códigos de verdad dicen siete cosas distintas.
		expect(new Set(textos).size).toBe(7);
	});

	test('un error al quitar también sale traducido', async () => {
		contestar(STATE, CON_IDENTIDAD);
		const vista = tarjeta();
		await asentar();

		fallar(REMOVE, 'KeyringLocked');
		await boton(vista, es['smime.quitar']).trigger('click');
		await asentar();

		expect(vista.find('[role="alert"]').text()).toBe(es['smime.errorKeyringLocked']);
		// Sigue mostrando la identidad: no se quitó.
		expect(vista.text()).toContain('ana@ejemplo.org');
	});

	test('si no se puede consultar el estado, se dice y no se ofrece importar a ciegas', async () => {
		fallar(STATE, 'KeyringLocked');
		const vista = tarjeta();
		await asentar();

		expect(vista.find('[role="alert"]').text()).toBe(es['smime.errorKeyringLocked']);
		expect(vista.findAll('button').some((b) => b.text().trim() === es['smime.importar'])).toBe(false);
	});
});

describe('la tarjeta de S/MIME: importar y quitar', () => {
	test('importar manda cuenta, ruta y contraseña, y vuelve a preguntar el estado', async () => {
		contestar(STATE, SIN_IDENTIDAD);
		const vista = tarjeta();
		await asentar();
		await llenar(vista, 'hunter2');
		expect(consultas()).toBe(1);

		// El servicio ya la tiene cuando se vuelve a preguntar.
		contestar(STATE, CON_IDENTIDAD);
		await boton(vista, es['smime.importar']).trigger('click');
		await asentar();

		const llamada = invocaciones.find((i) => i.comando === IMPORT);
		expect(llamada?.args).toEqual({ accountId: 'a1', ruta: RUTA, contrasena: 'hunter2' });
		expect(consultas()).toBe(2);
		expect(vista.text()).toContain('ana@ejemplo.org');
		expect(vista.text()).toContain(es['smime.quitar']);
	});

	test('importar bien limpia la contraseña y el archivo en el acto', async () => {
		contestar(STATE, SIN_IDENTIDAD);
		const vista = tarjeta();
		await asentar();
		await llenar(vista, 'hunter2');

		// El estado sigue «sin identidad» al releer: el formulario se queda a la
		// vista, así que se puede ver qué quedó en el campo.
		await boton(vista, es['smime.importar']).trigger('click');
		await asentar();

		expect(campoDeContrasena(vista).element.value).toBe('');
		expect(vista.text()).not.toContain('ana.p12');
		// Y con el campo vacío no se puede volver a mandar.
		expect(boton(vista, es['smime.importar']).attributes('disabled')).toBeDefined();
		expect(vista.find('[role="alert"]').exists()).toBe(false);
	});

	test('con Enter en la contraseña también se importa', async () => {
		contestar(STATE, SIN_IDENTIDAD);
		const vista = tarjeta();
		await asentar();
		await llenar(vista);

		await campoDeContrasena(vista).trigger('keydown', { key: 'Enter' });
		await asentar();

		expect(invocaciones.filter((i) => i.comando === IMPORT)).toHaveLength(1);
	});

	test('quitar llama a quitar_identidad_smime con la cuenta y vuelve a preguntar', async () => {
		contestar(STATE, CON_IDENTIDAD);
		const vista = tarjeta();
		await asentar();
		expect(consultas()).toBe(1);

		contestar(STATE, SIN_IDENTIDAD);
		await boton(vista, es['smime.quitar']).trigger('click');
		await asentar();

		expect(invocaciones.find((i) => i.comando === REMOVE)?.args).toEqual({ accountId: 'a1' });
		expect(consultas()).toBe(2);
		// Ahora ofrece importar de nuevo.
		expect(vista.text()).toContain(es['smime.ausente']);
		expect(boton(vista, es['smime.elegir'])).toBeDefined();
	});
});

describe('Preferencias: una tarjeta por cuenta', () => {
	const OTRA: Cuenta = { account_id: 'a2', display_name: 'trabajo@ejemplo.org', sin_leer: 0, error: '' };

	function preferencias(cuentas?: Cuenta[]) {
		return anotar(
			mount(PreferencesComponent, { props: { abierto: true, cuentas }, attachTo: document.body })
		);
	}

	test('con cuentas, la sección S/MIME trae una tarjeta por cada una', async () => {
		contestar(STATE, SIN_IDENTIDAD);
		preferencias([CUENTA, OTRA]);
		await asentar();

		expect(document.body.textContent).toContain(es['smime.seccion']);
		expect(document.body.textContent).toContain('ana@ejemplo.org');
		expect(document.body.textContent).toContain('trabajo@ejemplo.org');
		const cuentas = invocaciones.filter((i) => i.comando === STATE).map((i) => i.args);
		expect(cuentas).toEqual([{ accountId: 'a1' }, { accountId: 'a2' }]);
	});

	test('sin cuentas no hay sección S/MIME ni se le pregunta nada al servicio', async () => {
		preferencias();
		await asentar();

		expect(document.body.textContent).not.toContain(es['smime.seccion']);
		expect(consultas()).toBe(0);
	});
});

describe('el redactor: el interruptor de firmar depende del certificado', () => {
	const BORRADOR: Borrador = {
		para: ['quien@ejemplo.org'],
		cc: [],
		asunto: 'Hola',
		cuerpo: 'Texto',
		en_respuesta_a: '',
		referencias: [],
	};

	function redactar(cuenta = 'ana') {
		return anotar(
			mount(ComposeComponent, {
				props: { inicial: BORRADOR, esRespuesta: false, enviando: false, cuentas: [], cuenta },
				attachTo: document.body,
			})
		);
	}

	function interruptor(): HTMLElement {
		const found = [...document.body.querySelectorAll<HTMLElement>('[role="switch"]')].find((el) =>
			(el.closest('div')?.parentElement?.textContent ?? el.textContent ?? '').includes(es['redactar.firmar'])
		);
		if (!found) throw new Error('no está el interruptor «Firmar con S/MIME»');
		return found;
	}

	function deshabilitado(el: HTMLElement): boolean {
		return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
	}

	test('sin certificado en la cuenta, el interruptor queda deshabilitado y remite a Preferencias', async () => {
		contestar(STATE, SIN_IDENTIDAD);
		redactar();
		await asentar();

		expect(deshabilitado(interruptor())).toBe(true);
		expect(document.body.textContent).toContain(es['redactar.firmarSinCertificado']);
		expect(document.body.textContent).not.toContain(es['redactar.firmarPorQue']);
	});

	test('con certificado, el interruptor está habilitado y firma', async () => {
		contestar(STATE, CON_IDENTIDAD);
		const vista = redactar();
		await asentar();

		expect(deshabilitado(interruptor())).toBe(false);
		expect(document.body.textContent).toContain(es['redactar.firmarPorQue']);
		expect(document.body.textContent).not.toContain(es['redactar.firmarSinCertificado']);

		interruptor().click();
		await asentar();
		expect(interruptor().getAttribute('aria-checked')).toBe('true');
		document.body
			.querySelector('form')
			?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
		await asentar();
		const [borrador] = vista.emitted('enviar')?.[0] as [Borrador, string];
		expect(borrador.firmar).toBe(true);
	});

	test('deshabilitado, un clic no lo prende y el borrador sale sin firmar', async () => {
		contestar(STATE, SIN_IDENTIDAD);
		const vista = redactar();
		await asentar();

		interruptor().click();
		await asentar();
		expect(interruptor().getAttribute('aria-checked')).toBe('false');
		document.body
			.querySelector('form')
			?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
		await asentar();

		const [borrador] = vista.emitted('enviar')?.[0] as [Borrador, string];
		expect(borrador.firmar).toBeUndefined();
	});

	test('un borrador que traía `firmar: true` sin certificado se apaga, no sale a fallar', async () => {
		contestar(STATE, SIN_IDENTIDAD);
		anotar(
			mount(ComposeComponent, {
				props: {
					inicial: { ...BORRADOR, firmar: true },
					esRespuesta: false,
					enviando: false,
					cuentas: [],
					cuenta: 'ana',
				},
				attachTo: document.body,
			})
		);
		await asentar();

		expect(interruptor().getAttribute('aria-checked')).toBe('false');
	});

	test('pregunta por la cuenta de la que sale el borrador', async () => {
		contestar(STATE, CON_IDENTIDAD);
		redactar('trabajo');
		await asentar();

		expect(invocaciones.find((i) => i.comando === STATE)?.args).toEqual({ accountId: 'trabajo' });
	});

	test('si el servicio no contesta, no se bloquea: el motivo lo da al enviar', async () => {
		fallar(STATE, 'Failed');
		redactar();
		await asentar();

		expect(deshabilitado(interruptor())).toBe(false);
	});
});
