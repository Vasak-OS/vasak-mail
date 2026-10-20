/**
 * La cara de usuario de S/MIME: qué se dibuja de un mensaje firmado o cifrado y
 * cómo se pide firmar al escribir.
 *
 * Se monta con el catálogo **de verdad** (`src-tauri/locales/es.yml`) y no con
 * las claves crudas: lo que importa es lo que la persona lee —«Firmado, no
 * verificado — ana@…» y jamás «válida»—, y una clave cruda no dice nada de eso.
 */

import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import I18n from '@vasakgroup/tauri-plugin-i18n';
import ComposeComponent from '@/components/mail/ComposeComponent.vue';
import MessageListComponent from '@/components/mail/MessageListComponent.vue';
import MessageComponent from '@/components/mail/MessageComponent.vue';
import type { Abierto, Adjunto, Borrador, Cuenta, Resumen } from '@/composables/use-correo';
import { ROW_SELECTORS } from '@/tools/focus';
import type { SmimeStatus } from '@/tools/smime';
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

beforeAll(async () => {
	const yaml = Bun.YAML.parse(await Bun.file(`${import.meta.dir}/../src-tauri/locales/es.yml`).text());
	es = flatten(yaml as Record<string, unknown>);
	contestar(LOAD, { es: { ...CATALOGO.es, ...es } });
	// Se carga desde cero: `tests/traducciones.test.ts` hace lo mismo y deja el
	// singleton en el estado que le toque a cada archivo.
	(I18n as unknown as { instance: unknown }).instance = undefined;
	await I18n.getInstance().load();
});

afterAll(() => {
	// El catálogo de una sola clave es lo que espera `traducciones.test.ts`.
	contestar(LOAD, CATALOGO);
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

const FIRMA: Adjunto = { parte: '2', nombre: 'smime.p7s', tipo: 'application/pkcs7-signature' };
const SOBRE: Adjunto = { parte: '1', nombre: 'smime.p7m', tipo: 'application/pkcs7-mime' };
const FACTURA: Adjunto = { parte: '3', nombre: 'factura.pdf', tipo: 'application/pdf' };

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

function abierto(cambios: Partial<Abierto> = {}): Abierto {
	return {
		texto: 'El texto secreto del mensaje',
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

function smime(cambios: Partial<SmimeStatus> = {}): SmimeStatus {
	return { valid: false, signer: null, encryption: null, ...cambios };
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

describe('el mensaje: distintivos de firma y cifrado', () => {
	test('sin S/MIME no hay ningún distintivo ni aviso, y el cuerpo se ve', async () => {
		const vista = await verMensaje(abierto());
		const texto = vista.text();

		expect(texto).toContain('El texto secreto del mensaje');
		expect(texto).not.toContain(es['smime.cifrado']);
		expect(texto).not.toContain('Firmado');
		expect(texto).not.toContain(es['smime.noSePudoAbrir']);
		expect(texto).not.toContain(es['smime.cuerpoNoDisponible']);
	});

	test('firmado: «Firmado, no verificado — firmante», y nunca «válida»', async () => {
		const vista = await verMensaje(abierto({ smime: smime({ signer: 'ana@ejemplo.org' }) }));
		const texto = vista.text();

		expect(texto).toContain('Firmado, no verificado — ana@ejemplo.org');
		expect(texto).not.toMatch(/v[áa]lid/i);
		expect(texto).toContain('El texto secreto del mensaje');
	});

	test('firmado aunque llegue `valid: true`: sigue diciendo «no verificado»', async () => {
		const vista = await verMensaje(
			abierto({ smime: smime({ valid: true, signer: 'ana@ejemplo.org' }) })
		);
		const texto = vista.text();

		expect(texto).toContain('Firmado, no verificado — ana@ejemplo.org');
		expect(texto).not.toMatch(/v[áa]lid/i);
	});

	test('sin firmante no hay distintivo de firma', async () => {
		const vista = await verMensaje(abierto({ smime: smime({ signer: null }) }));

		expect(vista.text()).not.toContain('Firmado');
	});

	test('cifrado y abierto: candado «Cifrado» y el cuerpo descifrado a la vista', async () => {
		const vista = await verMensaje(abierto({ smime: smime({ encryption: 'opened' }) }));
		const texto = vista.text();

		expect(texto).toContain(es['smime.cifrado']);
		expect(texto).toContain('El texto secreto del mensaje');
		expect(texto).not.toContain(es['smime.noSePudoAbrir']);
	});

	test('firmado y cifrado abierto: los dos distintivos a la vez', async () => {
		const vista = await verMensaje(
			abierto({ smime: smime({ signer: 'ana@ejemplo.org', encryption: 'opened' }) })
		);
		const texto = vista.text();

		expect(texto).toContain(es['smime.cifrado']);
		expect(texto).toContain('Firmado, no verificado — ana@ejemplo.org');
	});

	test('el clic en la firma explica por qué no está verificada', async () => {
		const vista = await verMensaje(abierto({ smime: smime({ signer: 'ana@ejemplo.org' }) }));
		const chip = vista.findAll('button').find((b) => b.text().includes('Firmado, no verificado'));
		expect(chip).toBeDefined();

		await chip?.trigger('click');
		await asentar();

		expect(document.body.textContent).toContain(es['smime.firmaPorQue'].slice(0, 40));
	});
});

describe('el mensaje cifrado que no se pudo abrir', () => {
	for (const encryption of ['unavailable', 'other'] as const) {
		test(`con \`${encryption}\`: aviso «no se pudo abrir» y el cuerpo NO se pinta`, async () => {
			const vista = await verMensaje(
				abierto({
					texto: 'El texto secreto del mensaje',
					con_formato: { html: '<p>El html secreto</p>', imagenes_bloqueadas: 0, recortado: false },
					smime: smime({ encryption }),
				})
			);
			const html = vista.html();

			expect(vista.text()).toContain(es['smime.noSePudoAbrir']);
			expect(html).not.toContain('El texto secreto del mensaje');
			expect(html).not.toContain('El html secreto');
			expect(vista.find('iframe').exists()).toBe(false);
			// Sin cuerpo no hay a qué alternar la vista.
			expect(vista.text()).not.toContain(es['mensaje.verTextoPelado']);
			expect(vista.text()).not.toContain(es['mensaje.soloTexto']);
		});
	}

	test('el sobre p7m se queda entre los adjuntos: es la única salida', async () => {
		const vista = await verMensaje(
			abierto({ adjuntos: [SOBRE], smime: smime({ encryption: 'unavailable' }) })
		);

		expect(vista.text()).toContain('smime.p7m');
	});
});

describe('la guarda de la lectura en vivo', () => {
	test('sin `smime` y con un sobre pkcs7-mime: aviso informativo y sin cuerpo', async () => {
		const vista = await verMensaje(abierto({ adjuntos: [SOBRE] }));
		const html = vista.html();

		expect(vista.text()).toContain(es['smime.cuerpoNoDisponible']);
		expect(html).not.toContain('El texto secreto del mensaje');
		// Sin alarma: no es el aviso de «no se pudo abrir».
		expect(vista.text()).not.toContain(es['smime.noSePudoAbrir']);
	});

	test('sin `smime` y sin sobre, no aparece', async () => {
		const vista = await verMensaje(abierto({ adjuntos: [FACTURA] }));

		expect(vista.text()).not.toContain(es['smime.cuerpoNoDisponible']);
		expect(vista.text()).toContain('El texto secreto del mensaje');
	});
});

describe('los adjuntos del mensaje', () => {
	test('la firma suelta (p7s) no aparece como adjunto; los demás sí', async () => {
		const vista = await verMensaje(abierto({ adjuntos: [FACTURA, FIRMA] }));

		expect(vista.text()).toContain('factura.pdf');
		expect(vista.text()).not.toContain('smime.p7s');
	});

	test('si el único adjunto es la firma, no se muestra el bloque de adjuntos', async () => {
		const vista = await verMensaje(
			abierto({ adjuntos: [FIRMA], smime: smime({ signer: 'ana@ejemplo.org' }) })
		);

		expect(vista.text()).not.toContain(es['mensaje.adjuntos']);
		expect(vista.text()).not.toContain('smime.p7s');
	});

	test('un archivo llamado smime.p7s de otro tipo SÍ se muestra', async () => {
		const vista = await verMensaje(
			abierto({ adjuntos: [{ parte: '2', nombre: 'smime.p7s', tipo: 'application/pdf' }] })
		);

		expect(vista.text()).toContain('smime.p7s');
	});
});

const BORRADOR: Borrador = {
	para: ['quien@ejemplo.org'],
	cc: [],
	asunto: 'Hola',
	cuerpo: 'Texto',
	en_respuesta_a: '',
	referencias: [],
};

function redactar(props: { inicial?: Borrador; error?: string; repliesToEncrypted?: boolean } = {}) {
	return anotar(
		mount(ComposeComponent, {
			props: {
				inicial: props.inicial ?? BORRADOR,
				esRespuesta: false,
				enviando: false,
				cuentas: [],
				cuenta: 'ana',
				error: props.error,
				repliesToEncrypted: props.repliesToEncrypted,
			},
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

function enviarForm() {
	const form = document.body.querySelector('form');
	if (!form) throw new Error('no hay formulario');
	form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

describe('el redactor: firmar con S/MIME', () => {
	test('el interruptor está y arranca apagado', async () => {
		redactar();
		await asentar();

		expect(document.body.textContent).toContain(es['redactar.firmar']);
		expect(interruptor().getAttribute('aria-checked')).toBe('false');
	});

	test('apagado, el borrador sale SIN el campo `firmar`', async () => {
		const vista = redactar();
		await asentar();

		enviarForm();
		await asentar();

		const [borrador] = vista.emitted('enviar')?.[0] as [Borrador, string];
		expect('firmar' in borrador).toBe(true); // la clave existe con `undefined`…
		expect(borrador.firmar).toBeUndefined(); // …y `JSON.stringify` no la manda.
		expect(JSON.stringify(borrador)).not.toContain('firmar');
	});

	test('activo, el borrador sale con `firmar: true`', async () => {
		const vista = redactar();
		await asentar();

		interruptor().click();
		await asentar();
		expect(interruptor().getAttribute('aria-checked')).toBe('true');
		enviarForm();
		await asentar();

		const [borrador] = vista.emitted('enviar')?.[0] as [Borrador, string];
		expect(borrador.firmar).toBe(true);
		expect(JSON.parse(JSON.stringify(borrador)).firmar).toBe(true);
	});

	test('prendido y apagado otra vez, vuelve a no mandar el campo', async () => {
		const vista = redactar();
		await asentar();

		interruptor().click();
		await asentar();
		interruptor().click();
		await asentar();
		enviarForm();
		await asentar();

		const [borrador] = vista.emitted('enviar')?.[0] as [Borrador, string];
		expect(JSON.stringify(borrador)).not.toContain('firmar');
	});

	test('un borrador que ya traía `firmar: true` abre con el interruptor prendido', async () => {
		redactar({ inicial: { ...BORRADOR, firmar: true } });
		await asentar();

		expect(interruptor().getAttribute('aria-checked')).toBe('true');
	});
});

describe('el redactor: avisos dentro del formulario', () => {
	test('el error de envío se ve DENTRO del formulario', async () => {
		redactar({ error: 'No hay certificado para ana@ejemplo.org' });
		await asentar();

		const form = document.body.querySelector('form');
		expect(form?.textContent).toContain('No hay certificado para ana@ejemplo.org');
	});

	test('sin error no hay aviso de error', async () => {
		redactar({ error: '' });
		await asentar();

		expect(document.body.querySelector('form')?.textContent).not.toContain('No hay certificado');
	});

	test('al responder a un cifrado abierto, se avisa que la respuesta sale sin cifrar', async () => {
		redactar({ repliesToEncrypted: true });
		await asentar();

		expect(document.body.querySelector('form')?.textContent).toContain(es['redactar.respuestaACifrado']);
	});

	test('en un mensaje común el aviso no aparece', async () => {
		redactar({ repliesToEncrypted: false });
		await asentar();

		expect(document.body.textContent).not.toContain(es['redactar.respuestaACifrado']);
	});
});

/**
 * El cableado de la ventana: lo que `MailView` le pasa al redactor. Los
 * componentes de arriba prueban cada pieza; acá se prueba que estén conectadas
 * (un `:error` o un `:replies-to-encrypted` que no llega no falla en ningún
 * otro lado).
 */
describe('la ventana: de abrir un mensaje a responderlo', () => {
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

	test('responder a un cifrado abierto avisa que la respuesta sale sin cifrar', async () => {
		await abrirYResponder(abierto({ smime: smime({ encryption: 'opened' }) }));

		expect(document.body.querySelector('form')?.textContent).toContain(
			es['redactar.respuestaACifrado']
		);
	});

	test('responder a un mensaje sin cifrar no avisa nada', async () => {
		await abrirYResponder(abierto({ smime: smime({ signer: 'ana@ejemplo.org' }) }));

		expect(document.body.querySelector('form')).not.toBeNull();
		expect(document.body.textContent).not.toContain(es['redactar.respuestaACifrado']);
	});

	test('si el servicio rechaza el envío, el motivo queda dentro del formulario y no se cierra', async () => {
		fallar('enviar_mensaje', 'sin certificado para firmar con ana@ejemplo.org');
		await abrirYResponder(abierto());

		interruptor().click();
		await asentar();
		document.body
			.querySelector('form')
			?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
		await asentar();

		const enviado = invocaciones.find((i) => i.comando === 'enviar_mensaje');
		expect((enviado?.args as { borrador: Borrador }).borrador.firmar).toBe(true);
		const form = document.body.querySelector('form');
		expect(form).not.toBeNull();
		expect(form?.textContent).toContain('sin certificado para firmar con ana@ejemplo.org');
	});
});
