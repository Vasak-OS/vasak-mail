/**
 * La cara de usuario de OpenPGP: distintivos del mensaje entrante, la tarjeta de
 * identidad de Preferencias y el interruptor de firmar del redactor.
 *
 * Se monta con el catálogo **de verdad** (`src-tauri/locales/es.yml`): lo que
 * importa es lo que la persona lee —«Firmado, clave conocida» y jamás «válida» ni
 * «firmado por Ana»—, y una clave cruda no dice nada de eso.
 */

import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import I18n, { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import ComposeComponent from '@/components/mail/ComposeComponent.vue';
import MessageListComponent from '@/components/mail/MessageListComponent.vue';
import PgpIdentityCard from '@/components/mail/PgpIdentityCard.vue';
import PreferencesComponent from '@/components/mail/PreferencesComponent.vue';
import MessageComponent from '@/components/mail/MessageComponent.vue';
import type { Abierto, Adjunto, Borrador, Cuenta, Resumen } from '@/composables/use-correo';
import { ROW_SELECTORS } from '@/tools/focus';
import type { PgpStatus } from '@/tools/pgp';
import MailView from '@/views/MailView.vue';
import { CATALOGO, contestar, fallar, invocaciones, olvidarTodo } from './dobles';

// Compilar los `.vue` la primera vez pasa los cinco segundos de fábrica.
setDefaultTimeout(60_000);

const LOAD = 'plugin:i18n|load_translations';

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
	// El composable refleja la instancia **en cada `useI18n()`**: sin esta llamada
	// quedaría con el catálogo de acá hasta que alguien monte algo, y el próximo
	// archivo vería los textos resueltos donde espera las claves.
	useI18n();
}

beforeAll(async () => {
	const yaml = Bun.YAML.parse(await Bun.file(`${import.meta.dir}/../src-tauri/locales/es.yml`).text());
	es = flatten(yaml as Record<string, unknown>);
	contestar(LOAD, { es: { ...CATALOGO.es, ...es } });
	// Se carga desde cero: el singleton puede venir cargado por otro archivo.
	resetI18n();
	await I18n.getInstance().load();
});

afterAll(() => {
	// El catálogo con la clave de prueba y el singleton sin cargar: es lo que ven
	// los demás archivos, que esperan las claves crudas (y `traducciones.test.ts`,
	// que parte de un catálogo sin cargar). Sin esto el estado global de i18n se
	// filtra y el resultado depende del orden en que Bun recorra los archivos.
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
	// Los diálogos se teletransportan al `body` y no se van con el desmontaje.
	document.body.innerHTML = '';
	olvidarTodo();
});

async function asentar() {
	for (let i = 0; i < 6; i++) await flushPromises();
}


const SOBRE: Adjunto = { parte: '1', nombre: 'smime.p7m', tipo: 'application/pkcs7-mime' };

const RESUMEN: Resumen = {
	account_id: 'ana',
	casilla: 'INBOX',
	uid: 7,
	de: 'Lucía',
	direccion: 'lucia@ejemplo.org',
	asunto: 'Hola',
	fecha: '2026-09-20T10:00:00Z',
	sin_leer: false,
	con_adjuntos: false,
};

const SECRETO = 'El texto secreto del mensaje';

function abierto(cambios: Partial<Abierto> = {}): Abierto {
	return {
		texto: SECRETO,
		recortado: false,
		adjuntos: [],
		con_formato: null,
		message_id: '<m@ejemplo.org>',
		referencias: [],
		responder_a: 'lucia@ejemplo.org',
		nombre: 'Lucía',
		...cambios,
	};
}

function pgp(cambios: Partial<PgpStatus> = {}): PgpStatus {
	return { signature: null, signer: null, encryption: null, ...cambios };
}

async function verMensaje(cuerpo: Abierto | null) {
	const vista = anotar(
		mount(MessageComponent, {
			props: { panel: 'message', abierto: RESUMEN, cuerpo, cargando: false },
			attachTo: document.body,
		})
	);
	await asentar();
	return vista;
}

async function abrirExplicacion(vista: VueWrapper, etiqueta: string) {
	const chip = vista.findAll('button').find((b) => b.text().includes(etiqueta));
	expect(chip).toBeDefined();
	await chip?.trigger('click');
	await asentar();
}

describe('el mensaje: distintivos de OpenPGP', () => {
	test('sin PGP no hay chips ni aviso, y el cuerpo se ve', async () => {
		const vista = await verMensaje(abierto());
		const texto = vista.text();

		expect(texto).toContain(SECRETO);
		for (const clave of ['pgp.cifrado', 'pgp.firmaConocida', 'pgp.firmaDesconocida', 'pgp.firmaNoVerificable', 'pgp.noSePudoAbrir']) {
			expect(texto).not.toContain(es[clave]);
		}
	});

	test('un estado PGP vacío (ni firma ni cifrado) tampoco dibuja nada', async () => {
		const vista = await verMensaje(abierto({ pgp: pgp() }));

		expect(vista.text()).not.toContain(es['pgp.cifrado']);
		expect(vista.text()).not.toContain('Firmado');
		expect(vista.text()).toContain(SECRETO);
	});

	for (const [signature, clave] of [
		['known', 'pgp.firmaConocida'],
		['unknown', 'pgp.firmaDesconocida'],
		['unverifiable', 'pgp.firmaNoVerificable'],
		['algo-nuevo', 'pgp.firmaNoVerificable'],
	] as const) {
		test(`firma «${signature}»: chip de ${clave}`, async () => {
			const vista = await verMensaje(abierto({ pgp: pgp({ signature }) }));

			expect(vista.text()).toContain(es[clave]);
			expect(vista.text()).toContain(SECRETO);
		});
	}

	test('nunca dice «válida» ni «firmado por»: la honestidad de TOFU', async () => {
		for (const signature of ['known', 'unknown', 'unverifiable']) {
			const vista = await verMensaje(
				abierto({ pgp: pgp({ signature, signer: 'AAAA BBBB', encryption: 'opened' }) })
			);
			await abrirExplicacion(vista, 'Firmado');
			const todo = `${vista.text()} ${document.body.textContent}`;

			expect(todo).not.toMatch(/v[áa]lid/i);
			expect(todo).not.toMatch(/firmado por/i);
			expect(todo).not.toMatch(/verificad[ao]\b(?<!no verificad[ao])/i);
			vista.unmount();
			vistas.delete(vista);
			document.body.innerHTML = '';
		}
	});

	test('la huella aparece en la explicación sólo con la clave conocida', async () => {
		const conocida = await verMensaje(abierto({ pgp: pgp({ signature: 'known', signer: 'AAAA BBBB' }) }));
		await abrirExplicacion(conocida, es['pgp.firmaConocida']);
		expect(document.body.textContent).toContain('AAAA BBBB');
		expect(document.body.textContent).toContain(es['pgp.huella']);

		conocida.unmount();
		vistas.delete(conocida);
		document.body.innerHTML = '';

		for (const signature of ['unknown', 'unverifiable']) {
			const otra = await verMensaje(abierto({ pgp: pgp({ signature, signer: 'AAAA BBBB' }) }));
			await abrirExplicacion(otra, 'Firmado');
			expect(document.body.textContent).not.toContain('AAAA BBBB');
			otra.unmount();
			vistas.delete(otra);
			document.body.innerHTML = '';
		}
	});

	test('cifrado y abierto: candado «Cifrado» y el cuerpo descifrado a la vista', async () => {
		const vista = await verMensaje(abierto({ pgp: pgp({ encryption: 'opened' }) }));

		expect(vista.text()).toContain(es['pgp.cifrado']);
		expect(vista.text()).toContain(SECRETO);
		expect(vista.text()).not.toContain(es['pgp.noSePudoAbrir']);
	});

	for (const encryption of ['unavailable', 'other'] as const) {
		test(`con \`${encryption}\`: aviso «no se pudo abrir» y el cuerpo y los botones de formato NO se pintan`, async () => {
			const vista = await verMensaje(
				abierto({
					con_formato: { html: '<p>El html secreto</p>', imagenes_bloqueadas: 0, recortado: false },
					pgp: pgp({ encryption }),
				})
			);
			const html = vista.html();

			expect(vista.text()).toContain(es['pgp.noSePudoAbrir']);
			expect(html).not.toContain(SECRETO);
			expect(html).not.toContain('El html secreto');
			expect(vista.find('iframe').exists()).toBe(false);
			expect(vista.text()).not.toContain(es['mensaje.verTextoPelado']);
			expect(vista.text()).not.toContain(es['mensaje.verConFormato']);
			expect(vista.text()).not.toContain(es['mensaje.soloTexto']);
		});
	}

	test('S/MIME y PGP conviven: cada uno dibuja lo suyo', async () => {
		const vista = await verMensaje(
			abierto({
				smime: { valid: false, signer: 'ana@ejemplo.org', encryption: null },
				pgp: pgp({ signature: 'unknown' }),
			})
		);

		expect(vista.text()).toContain('Firmado, no verificado — ana@ejemplo.org');
		expect(vista.text()).toContain(es['pgp.firmaDesconocida']);
		expect(vista.text()).toContain(SECRETO);
	});

	test('con S/MIME abierto y PGP sin abrir el cuerpo se oculta igual', async () => {
		const vista = await verMensaje(
			abierto({
				smime: { valid: false, signer: null, encryption: 'opened' },
				pgp: pgp({ encryption: 'unavailable' }),
			})
		);

		expect(vista.html()).not.toContain(SECRETO);
		expect(vista.text()).toContain(es['pgp.noSePudoAbrir']);
	});
});

describe('la ventana: responder a un PGP que no se pudo abrir', () => {
	const CUENTAS: Cuenta[] = [{ account_id: 'a1', display_name: 'ana@ejemplo.org', sin_leer: 0, error: '' }];
	const LISTA = [
		{
			uid: 1,
			de: 'Lucía',
			direccion: 'lucia@ejemplo.org',
			asunto: 'Documento',
			fecha: '2026-10-01T10:00:00Z',
			sin_leer: false,
			con_adjuntos: false,
		},
	];

	let ventana: VueWrapper | null = null;

	afterEach(() => {
		ventana?.unmount();
		ventana = null;
		contestar('listar_cuentas', []);
		contestar('listar_mensajes', []);
		contestar('open_message', undefined);
	});

	async function abrirYResponder(cuerpo: Abierto) {
		contestar('listar_cuentas', CUENTAS);
		contestar('listar_mensajes', LISTA);
		contestar('open_message', cuerpo);
		ventana = mount(MailView, { attachTo: document.body });
		await asentar();
		await ventana.findComponent(MessageListComponent).find(ROW_SELECTORS.first).trigger('click');
		await asentar();
		const responder = ventana.findAll('button').find((b) => b.text().trim() === es['redactar.responder']);
		if (!responder) throw new Error('no hay botón «Responder»');
		await responder.trigger('click');
		await asentar();
	}

	function cuerpoDeLaRespuesta(): string {
		return document.body.querySelector<HTMLTextAreaElement>('form textarea')?.value ?? '';
	}

	test('no cita el cuerpo: sería filtrar en claro lo que la vista nunca mostró', async () => {
		await abrirYResponder(abierto({ pgp: pgp({ encryption: 'unavailable' }) }));

		expect(document.body.querySelector('form')).not.toBeNull();
		expect(cuerpoDeLaRespuesta()).not.toContain(SECRETO);
	});

	test('con un cifrado de valor desconocido tampoco lo cita', async () => {
		await abrirYResponder(abierto({ pgp: pgp({ encryption: 'other' }) }));

		expect(document.body.querySelector('form')).not.toBeNull();
		expect(cuerpoDeLaRespuesta()).not.toContain(SECRETO);
	});

	test('cifrado abierto, sólo firmado o sin PGP: sí lo cita', async () => {
		await abrirYResponder(abierto({ pgp: pgp({ encryption: 'opened' }) }));
		expect(cuerpoDeLaRespuesta()).toContain(SECRETO);

		for (const cuerpo of [abierto({ pgp: pgp({ signature: 'known', signer: 'AAAA' }) }), abierto()]) {
			ventana?.unmount();
			ventana = null;
			document.body.innerHTML = '';
			await abrirYResponder(cuerpo);
			expect(cuerpoDeLaRespuesta()).toContain(SECRETO);
		}
	});

	test('el cuerpo oculto por S/MIME sigue sin citarse', async () => {
		await abrirYResponder(
			abierto({ smime: { valid: false, signer: null, encryption: 'unavailable' }, adjuntos: [SOBRE] })
		);

		expect(cuerpoDeLaRespuesta()).not.toContain(SECRETO);
	});
});

const STATE = 'estado_identidad_pgp';
const IMPORT = 'importar_identidad_pgp';
const REMOVE = 'quitar_identidad_pgp';
const DIALOG = 'plugin:dialog|open';

afterEach(() => {
	contestar(STATE, undefined);
	contestar(IMPORT, undefined);
	contestar(REMOVE, undefined);
	contestar(DIALOG, undefined);
});

const CUENTA: Cuenta = { account_id: 'a1', display_name: 'ana@ejemplo.org', sin_leer: 0, error: '' };
const OTRA: Cuenta = { account_id: 'a2', display_name: 'trabajo@ejemplo.org', sin_leer: 0, error: '' };
const SIN_CLAVE = { present: false, fingerprint: null, uids: [] };
const CON_CLAVE = { present: true, fingerprint: 'AAAA BBBB CCCC', uids: ['Ana <ana@ejemplo.org>', 'Ana P <ana@otro.org>'] };
const RUTA = '/home/ana/Descargas/ana.asc';

function tarjeta(cuenta: Cuenta = CUENTA) {
	return anotar(mount(PgpIdentityCard, { props: { cuenta }, attachTo: document.body }));
}

function boton(vista: VueWrapper, texto: string) {
	const found = vista.findAll('button').find((b) => b.text().trim() === texto);
	if (!found) throw new Error(`no hay botón «${texto}»`);
	return found;
}

function hayBoton(vista: VueWrapper, texto: string) {
	return vista.findAll('button').some((b) => b.text().trim() === texto);
}

function campoDeContrasena(vista: VueWrapper) {
	return vista.find<HTMLInputElement>('input[type="password"], input[autocomplete="off"]');
}

function consultas(): number {
	return invocaciones.filter((i) => i.comando === STATE).length;
}

async function elegirArchivo(vista: VueWrapper) {
	contestar(DIALOG, RUTA);
	await boton(vista, es['pgp.elegir']).trigger('click');
	await asentar();
}

describe('la tarjeta de OpenPGP: qué muestra', () => {
	test('con clave: las identidades, la huella y «Quitar»; nada del formulario', async () => {
		contestar(STATE, CON_CLAVE);
		const vista = tarjeta();
		await asentar();

		expect(vista.text()).toContain('Ana <ana@ejemplo.org>, Ana P <ana@otro.org>');
		expect(vista.text()).toContain('AAAA BBBB CCCC');
		expect(hayBoton(vista, es['pgp.quitar'])).toBe(true);
		expect(hayBoton(vista, es['pgp.importar'])).toBe(false);
		expect(hayBoton(vista, es['pgp.elegir'])).toBe(false);
		expect(campoDeContrasena(vista).exists()).toBe(false);
	});

	test('pregunta por la cuenta de la tarjeta', async () => {
		contestar(STATE, SIN_CLAVE);
		tarjeta();
		await asentar();

		expect(invocaciones.find((i) => i.comando === STATE)?.args).toEqual({ accountId: 'a1' });
	});

	test('sin clave: elegir archivo, contraseña e «Importar» apagado', async () => {
		contestar(STATE, SIN_CLAVE);
		const vista = tarjeta();
		await asentar();

		expect(vista.text()).toContain(es['pgp.ausente']);
		expect(hayBoton(vista, es['pgp.quitar'])).toBe(false);
		expect(campoDeContrasena(vista).exists()).toBe(true);
		expect(boton(vista, es['pgp.importar']).attributes('disabled')).toBeDefined();
	});

	test('el diálogo ofrece las extensiones de clave', async () => {
		contestar(STATE, SIN_CLAVE);
		const vista = tarjeta();
		await asentar();
		await elegirArchivo(vista);

		const opciones = invocaciones.find((i) => i.comando === DIALOG)?.args as {
			options: { filters: { extensions: string[] }[]; multiple: boolean };
		};
		expect(opciones.options.filters[0].extensions).toEqual(['asc', 'gpg', 'pgp', 'key']);
		expect(opciones.options.multiple).toBe(false);
		expect(vista.text()).toContain('ana.asc');
	});

	test('«Importar» se enciende con sólo el archivo: una clave sin proteger no lleva contraseña', async () => {
		contestar(STATE, SIN_CLAVE);
		const vista = tarjeta();
		await asentar();
		expect(boton(vista, es['pgp.importar']).attributes('disabled')).toBeDefined();

		await elegirArchivo(vista);

		expect(campoDeContrasena(vista).element.value).toBe('');
		expect(boton(vista, es['pgp.importar']).attributes('disabled')).toBeUndefined();
	});
});

describe('la tarjeta de OpenPGP: importar y quitar', () => {
	test('importar sin contraseña manda cuenta, ruta y contraseña vacía, y vuelve a preguntar', async () => {
		contestar(STATE, SIN_CLAVE);
		const vista = tarjeta();
		await asentar();
		await elegirArchivo(vista);
		expect(consultas()).toBe(1);

		contestar(STATE, CON_CLAVE);
		await boton(vista, es['pgp.importar']).trigger('click');
		await asentar();

		expect(invocaciones.find((i) => i.comando === IMPORT)?.args).toEqual({
			accountId: 'a1',
			ruta: RUTA,
			contrasena: '',
		});
		expect(consultas()).toBe(2);
		expect(vista.text()).toContain('AAAA BBBB CCCC');
	});

	test('importar con contraseña la manda', async () => {
		contestar(STATE, SIN_CLAVE);
		const vista = tarjeta();
		await asentar();
		await elegirArchivo(vista);
		await campoDeContrasena(vista).setValue('hunter2');

		await boton(vista, es['pgp.importar']).trigger('click');
		await asentar();

		expect((invocaciones.find((i) => i.comando === IMPORT)?.args as { contrasena: string }).contrasena).toBe('hunter2');
	});

	test('importar bien limpia la contraseña y el archivo en el acto', async () => {
		contestar(STATE, SIN_CLAVE);
		const vista = tarjeta();
		await asentar();
		await elegirArchivo(vista);
		await campoDeContrasena(vista).setValue('hunter2');

		await boton(vista, es['pgp.importar']).trigger('click');
		await asentar();

		expect(campoDeContrasena(vista).element.value).toBe('');
		expect(vista.text()).not.toContain('ana.asc');
		expect(boton(vista, es['pgp.importar']).attributes('disabled')).toBeDefined();
		expect(vista.find('[role="alert"]').exists()).toBe(false);
	});

	test('quitar llama a quitar_identidad_pgp con la cuenta y vuelve a preguntar', async () => {
		contestar(STATE, CON_CLAVE);
		const vista = tarjeta();
		await asentar();

		contestar(STATE, SIN_CLAVE);
		await boton(vista, es['pgp.quitar']).trigger('click');
		await asentar();

		expect(invocaciones.find((i) => i.comando === REMOVE)?.args).toEqual({ accountId: 'a1' });
		expect(consultas()).toBe(2);
		expect(vista.text()).toContain(es['pgp.ausente']);
	});

	test('cambiar de cuenta reinicia el formulario y vuelve a preguntar por la nueva', async () => {
		contestar(STATE, SIN_CLAVE);
		const vista = tarjeta();
		await asentar();
		await elegirArchivo(vista);
		await campoDeContrasena(vista).setValue('hunter2');

		await vista.setProps({ cuenta: OTRA });
		await asentar();

		expect(vista.text()).not.toContain('ana.asc');
		expect(campoDeContrasena(vista).element.value).toBe('');
		expect(invocaciones.filter((i) => i.comando === STATE).map((i) => i.args)).toEqual([
			{ accountId: 'a1' },
			{ accountId: 'a2' },
		]);
	});
});

describe('la tarjeta de OpenPGP: cada error tiene su mensaje', () => {
	const CODIGOS: [string, string][] = [
		['WrongPassword', 'pgp.errorWrongPassword'],
		['TooBig', 'pgp.errorTooBig'],
		['AddressMismatch', 'pgp.errorAddressMismatch'],
		['Malformed', 'pgp.errorMalformed'],
		['KeyringLocked', 'pgp.errorKeyringLocked'],
		['Failed', 'pgp.errorFailed'],
		['algo-que-nadie-conoce', 'pgp.errorFailed'],
	];

	for (const [codigo, clave] of CODIGOS) {
		test(`importar con «${codigo}» muestra «${clave}»`, async () => {
			contestar(STATE, SIN_CLAVE);
			const vista = tarjeta();
			await asentar();
			await elegirArchivo(vista);

			fallar(IMPORT, codigo);
			await boton(vista, es['pgp.importar']).trigger('click');
			await asentar();

			expect(vista.find('[role="alert"]').text()).toBe(es[clave]);
			expect(vista.text()).not.toContain('pgp.error');
		});
	}

	test('cada mensaje es propio y existe en español e inglés', async () => {
		const en = flatten(
			Bun.YAML.parse(await Bun.file(`${import.meta.dir}/../src-tauri/locales/en.yml`).text()) as Record<string, unknown>
		);
		const claves = CODIGOS.map(([, clave]) => clave);
		for (const clave of claves) {
			expect(es[clave]).toBeTruthy();
			expect(en[clave]).toBeTruthy();
		}
		// Seis mensajes distintos: los cinco códigos y el genérico.
		expect(new Set(claves.map((c) => es[c])).size).toBe(6);
	});

	test('un error al quitar sale traducido y la clave sigue a la vista', async () => {
		contestar(STATE, CON_CLAVE);
		const vista = tarjeta();
		await asentar();

		fallar(REMOVE, 'KeyringLocked');
		await boton(vista, es['pgp.quitar']).trigger('click');
		await asentar();

		expect(vista.find('[role="alert"]').text()).toBe(es['pgp.errorKeyringLocked']);
		expect(vista.text()).toContain('AAAA BBBB CCCC');
	});

	test('si no se puede consultar el estado, se dice y no se ofrece importar a ciegas', async () => {
		fallar(STATE, 'KeyringLocked');
		const vista = tarjeta();
		await asentar();

		expect(vista.find('[role="alert"]').text()).toBe(es['pgp.errorKeyringLocked']);
		expect(hayBoton(vista, es['pgp.importar'])).toBe(false);
	});
});

describe('Preferencias: una tarjeta de OpenPGP por cuenta', () => {
	function preferencias(cuentas?: Cuenta[]) {
		return anotar(mount(PreferencesComponent, { props: { abierto: true, cuentas }, attachTo: document.body }));
	}

	test('con cuentas, la sección trae una tarjeta por cada una', async () => {
		contestar(STATE, SIN_CLAVE);
		preferencias([CUENTA, OTRA]);
		await asentar();

		expect(document.body.textContent).toContain(es['pgp.seccion']);
		expect(invocaciones.filter((i) => i.comando === STATE).map((i) => i.args)).toEqual([
			{ accountId: 'a1' },
			{ accountId: 'a2' },
		]);
	});

	test('sin cuentas no hay sección ni se le pregunta nada al servicio', async () => {
		preferencias();
		await asentar();

		expect(document.body.textContent).not.toContain(es['pgp.seccion']);
		expect(consultas()).toBe(0);
	});
});

describe('el redactor: firmar con OpenPGP', () => {
	const BORRADOR: Borrador = {
		para: ['quien@ejemplo.org'],
		cc: [],
		asunto: 'Hola',
		cuerpo: 'Texto',
		en_respuesta_a: '',
		referencias: [],
	};

	function redactar(inicial: Borrador = BORRADOR, cuenta = 'ana') {
		return anotar(
			mount(ComposeComponent, {
				props: { inicial, esRespuesta: false, enviando: false, cuentas: [], cuenta },
				attachTo: document.body,
			})
		);
	}

	function interruptores(): HTMLElement[] {
		return [...document.body.querySelectorAll<HTMLElement>('[role="switch"]')];
	}

	/** El interruptor (un botón con su propia etiqueta) que dice `etiqueta`. */
	function interruptor(etiqueta: string): HTMLElement {
		const found = interruptores().find((el) => el.textContent?.includes(etiqueta));
		if (!found) throw new Error(`no está el interruptor «${etiqueta}»`);
		return found;
	}

	const pgpSwitch = () => interruptor(es['redactar.firmarPgp']);
	const smimeSwitch = () => interruptor(es['redactar.firmar']);

	function deshabilitado(el: HTMLElement): boolean {
		return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
	}

	async function borradorEnviado(vista: VueWrapper): Promise<Borrador> {
		document.body
			.querySelector('form')
			?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
		await asentar();
		return (vista.emitted('enviar')?.[0] as [Borrador, string])[0];
	}

	test('sin identidad: deshabilitado, remite a Preferencias y un clic no lo prende', async () => {
		contestar(STATE, SIN_CLAVE);
		const vista = redactar();
		await asentar();

		expect(deshabilitado(pgpSwitch())).toBe(true);
		expect(document.body.textContent).toContain(es['redactar.firmarPgpSinClave']);
		pgpSwitch().click();
		await asentar();
		expect(pgpSwitch().getAttribute('aria-checked')).toBe('false');
		expect((await borradorEnviado(vista)).metodo_firma).toBeUndefined();
	});

	test('falla cerrado: si el servicio no contesta, el interruptor queda deshabilitado', async () => {
		fallar(STATE, 'Failed');
		const vista = redactar();
		await asentar();

		expect(deshabilitado(pgpSwitch())).toBe(true);
		pgpSwitch().click();
		await asentar();
		expect(pgpSwitch().getAttribute('aria-checked')).toBe('false');
		expect((await borradorEnviado(vista)).metodo_firma).toBeUndefined();
	});

	test('falla cerrado: una respuesta sin `present: true` tampoco lo habilita', async () => {
		contestar(STATE, undefined);
		redactar();
		await asentar();
		expect(deshabilitado(pgpSwitch())).toBe(true);
	});

	test('con identidad: habilitado, con su explicación, y pregunta por la cuenta del borrador', async () => {
		contestar(STATE, CON_CLAVE);
		redactar(BORRADOR, 'trabajo');
		await asentar();

		expect(deshabilitado(pgpSwitch())).toBe(false);
		expect(document.body.textContent).toContain(es['redactar.firmarPgpPorQue']);
		expect(document.body.textContent).not.toContain(es['redactar.firmarPgpSinClave']);
		expect(invocaciones.find((i) => i.comando === STATE)?.args).toEqual({ accountId: 'trabajo' });
	});

	test('encendido, el borrador sale con `metodo_firma: pgp` y SIN `firmar`', async () => {
		contestar(STATE, CON_CLAVE);
		const vista = redactar();
		await asentar();

		pgpSwitch().click();
		await asentar();
		expect(pgpSwitch().getAttribute('aria-checked')).toBe('true');
		const borrador = await borradorEnviado(vista);

		expect(borrador.metodo_firma).toBe('pgp');
		expect(borrador.firmar).toBeUndefined();
		expect(JSON.stringify(borrador)).not.toContain('firmar"');
	});

	test('apagado, el borrador sale sin `metodo_firma`', async () => {
		contestar(STATE, CON_CLAVE);
		const vista = redactar();
		await asentar();

		pgpSwitch().click();
		await asentar();
		pgpSwitch().click();
		await asentar();
		const borrador = await borradorEnviado(vista);

		expect(JSON.stringify(borrador)).not.toContain('metodo_firma');
	});

	test('un borrador con `metodo_firma: pgp` y clave arranca encendido', async () => {
		contestar(STATE, CON_CLAVE);
		redactar({ ...BORRADOR, metodo_firma: 'pgp' });
		await asentar();

		expect(pgpSwitch().getAttribute('aria-checked')).toBe('true');
	});

	test('un borrador con `metodo_firma: pgp` pero sin clave se apaga: no sale a fallar', async () => {
		contestar(STATE, SIN_CLAVE);
		const vista = redactar({ ...BORRADOR, metodo_firma: 'pgp' });
		await asentar();

		expect(pgpSwitch().getAttribute('aria-checked')).toBe('false');
		expect((await borradorEnviado(vista)).metodo_firma).toBeUndefined();
	});

	test('es excluyente con S/MIME: prender uno apaga el otro, en los dos sentidos', async () => {
		contestar(STATE, CON_CLAVE);
		contestar('estado_identidad_smime', { present: true, email: 'ana@ejemplo.org', not_after: null });
		const vista = redactar();
		await asentar();

		smimeSwitch().click();
		await asentar();
		pgpSwitch().click();
		await asentar();
		expect(pgpSwitch().getAttribute('aria-checked')).toBe('true');
		expect(smimeSwitch().getAttribute('aria-checked')).toBe('false');

		smimeSwitch().click();
		await asentar();
		expect(smimeSwitch().getAttribute('aria-checked')).toBe('true');
		expect(pgpSwitch().getAttribute('aria-checked')).toBe('false');

		const borrador = await borradorEnviado(vista);
		expect(borrador.firmar).toBe(true);
		expect(borrador.metodo_firma).toBeUndefined();
		contestar('estado_identidad_smime', undefined);
	});
});
