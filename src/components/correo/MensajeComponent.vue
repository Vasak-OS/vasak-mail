<script lang="ts" setup>
import { invoke } from '@tauri-apps/api/core';
import { save as guardarDialogo } from '@tauri-apps/plugin-dialog';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, nextTick, ref, watch } from 'vue';
import type { Abierto, Adjunto, Resumen } from '@/composables/use-correo';
import { usePreferencias } from '@/composables/use-preferencias';
import { coloresDelTema, conLasImagenes, documentoDe } from '@/tools/formato';
import { interpolar } from '@/tools/interpolar';
import type { Panel } from '@/tools/paneles';

const props = defineProps<{
	/** Cuál de los tres paneles se ve. Sólo importa en una ventana angosta. */
	panel: Panel;
	abierto: Resumen | null;
	cuerpo: Abierto | null;
	cargando: boolean;
}>();
// El mensaje entero y no su `uid`: quien lo reciba necesita saber de qué cuenta
// y de qué carpeta salió, porque en la bandeja combinada el número solo no
// alcanza para encontrarlo. Ver `tools/bandeja.ts`.
const emit = defineEmits<{ marcarLeido: [mensaje: Resumen]; responder: []; volver: [] }>();

const { t, locale } = useI18n();

/**
 * Si se está mirando el formato o el texto pelado.
 *
 * El formato cuando lo hay, que es lo que la gente espera de un correo. La vista
 * de texto se queda como opción y **no desaparece**: es la que sirve cuando un
 * mensaje se ve raro, o cuando no se le tiene confianza a quien lo mandó.
 */
const { vistaPorOmision } = usePreferencias();

const conFormato = ref(vistaPorOmision.value === 'formato');

// Al cambiar de mensaje se vuelve a la vista de siempre. Que la elección se
// pegue al siguiente haría que un mensaje se viera distinto sin motivo
// aparente, y nadie recordaría haberlo pedido.
watch(
	() => props.abierto,
	() => {
		conFormato.value = vistaPorOmision.value === 'formato';
		// Las imágenes son del mensaje que estaba: dejarlas haría que el
		// siguiente apareciera con imágenes que nadie pidió para él.
		imagenes.value = new Map();
		falloAlTraer.value = 0;
	}
);

/** El formato del mensaje abierto, si trajo alguno. */
const formato = computed(() => props.cuerpo?.con_formato ?? null);

/**
 * Las imágenes que se trajeron, por dirección.
 *
 * Se vacía al cambiar de mensaje: son de ése. Y no se guarda nada entre
 * mensajes a propósito — que una imagen quede cargada para el próximo correo del
 * mismo remitente es una preferencia, y no hay dónde guardarla todavía.
 */
const imagenes = ref(new Map<string, string>());
const trayendo = ref(false);
const falloAlTraer = ref(0);

/**
 * Trae las imágenes que el servicio había bloqueado.
 *
 * **Sólo cuando alguien aprieta el botón.** Una imagen que se carga sola es el
 * aviso al remitente de que el mensaje se abrió, cuándo y desde qué conexión;
 * todo el trabajo de bloquearlas no serviría de nada si esto pasara solo.
 *
 * Las trae el servicio, no esta ventana: ver `imagenes.rs` del sincronizador.
 */
async function mostrarLasImagenes() {
	const saneado = formato.value;
	if (!saneado || trayendo.value) {
		return;
	}
	trayendo.value = true;
	falloAlTraer.value = 0;

	const traidas = new Map<string, string>();
	let fallaron = 0;

	// Una por una y no todas a la vez: son peticiones a servidores ajenos, y
	// veinte en paralelo desde el servicio es una ráfaga que además llama la
	// atención de cualquiera que mire el tráfico.
	for (const direccion of direccionesDe(saneado.html)) {
		try {
			const imagen = await invoke<{ tipo: string; base64: string }>('traer_imagen', {
				url: direccion,
			});
			traidas.set(direccion, `data:${imagen.tipo};base64,${imagen.base64}`);
		} catch (e) {
			// Una que falla no impide ver las otras. No se muestra el error de
			// cada una: son direcciones de un desconocido y lo único accionable
			// es cuántas no se pudieron.
			console.error('no se pudo traer una imagen del mensaje', e);
			fallaron += 1;
		}
	}

	imagenes.value = traidas;
	falloAlTraer.value = fallaron;
	trayendo.value = false;
}

/** Las direcciones que el saneador guardó, en orden y sin repetir. */
function direccionesDe(html: string): string[] {
	const encontradas = new Set<string>();
	for (const coincidencia of html.matchAll(/\bdata-vsk-src="([^"]*)"/gi)) {
		encontradas.add(coincidencia[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
	}
	return [...encontradas];
}

/**
 * El documento que va adentro del contenedor aislado.
 *
 * Los colores se leen del tema en cada mensaje: un documento aislado no hereda
 * nada, y sin esto el mensaje sale blanco en una ventana oscura.
 */
const documento = computed(() => {
	const saneado = formato.value;
	if (!saneado) {
		return '';
	}
	const conImagenes = imagenes.value.size > 0;
	const cuerpo = conImagenes ? conLasImagenes(saneado.html, imagenes.value) : saneado.html;
	// La política se abre a `data:` **sólo** cuando hay algo que mostrar, y
	// nunca a la red: ver `tools/formato.ts`.
	return documentoDe(cuerpo, coloresDelTema(document.documentElement), conImagenes);
});

function imagenesBloqueadas(cuantas: number): string {
	return interpolar(t('mensaje.imagenesBloqueadas'), cuantas);
}

/**
 * El botón de volver, para mandarle el foco al abrir un mensaje.
 *
 * Es `md:hidden`, o sea que en una ventana ancha no se dibuja — y enfocar algo
 * que no se dibuja no hace nada. Eso es lo que hace que esto no necesite
 * preguntar el ancho de la ventana: en ancho, donde la lista sigue a la vista y
 * moverle el foco a alguien sería quitárselo a la lista, la llamada es inocua;
 * en angosto, donde el mensaje reemplazó a la lista, el foco lo sigue.
 */
const botonVolver = ref<HTMLButtonElement | null>(null);

/**
 * Los adjuntos que se están bajando, por su número de parte.
 *
 * Un conjunto y no uno solo: con dos guardados en curso, el segundo pisaba al
 * primero y el `finally` del que terminara antes desbloqueaba los dos botones
 * mientras el otro seguía viajando.
 */
const guardando = ref<Set<string>>(new Set());
/** Lo último que pasó al guardar: dónde quedó, o qué falló. */
const avisoGuardar = ref('');

/**
 * Baja un adjunto y lo guarda donde la persona elija.
 *
 * **El nombre del mensaje es una sugerencia.** Llega saneado del servicio —sin
 * separadores de ruta, sin `..`— pero aun así sólo se propone: el destino lo
 * elige la persona en el diálogo del sistema, que es lo que hace que la ruta
 * sea suya. Ver `adjuntos.rs` del sincronizador.
 */
async function guardar(adjunto: Adjunto) {
	if (!props.abierto) {
		return;
	}
	avisoGuardar.value = '';

	// **De qué mensaje es, antes de abrir el diálogo.** Elegir el destino puede
	// tardar lo que tarde, y mientras tanto se puede cambiar de mensaje con un
	// clic o con la tecla `j`. Leer `props.abierto` después pediría el número de
	// parte de este adjunto con la identidad del mensaje nuevo: se bajaría otro
	// archivo y se escribiría en el destino que se acaba de elegir.
	const de = {
		accountId: props.abierto.account_id,
		casilla: props.abierto.casilla,
		uid: props.abierto.uid,
	};

	let destino: string | null;
	try {
		destino = await guardarDialogo({ defaultPath: adjunto.nombre });
	} catch (e) {
		avisoGuardar.value = String(e);
		return;
	}
	if (!destino) {
		return;
	}

	// Sobre una copia: Vue no ve una mutación de un `Set` en su lugar, y los
	// botones no se enterarían de que hay algo en curso.
	guardando.value = new Set(guardando.value).add(adjunto.parte);
	try {
		const recortado = await invoke<boolean>('guardar_adjunto', {
			...de,
			parte: adjunto.parte,
			destino,
		});
		// Si puede estar cortado se dice. Guardar un archivo incompleto sin
		// avisar deja algo que no abre ningún programa y ninguna explicación.
		avisoGuardar.value = recortado
			? t('mensaje.guardadoCortado')
			: interpolar(t('mensaje.guardadoEn'), destino);
	} catch (e) {
		avisoGuardar.value = String(e);
	} finally {
		const quedan = new Set(guardando.value);
		quedan.delete(adjunto.parte);
		guardando.value = quedan;
	}
}

watch(
	() => props.abierto,
	async (ahora) => {
		if (!ahora) return;
		await nextTick();
		botonVolver.value?.focus();
	}
);

const cuando = computed(() => {
	const fecha = props.abierto?.fecha;
	if (!fecha) {
		return t('lista.sinFecha');
	}
	const momento = new Date(fecha);
	if (Number.isNaN(momento.getTime())) {
		return t('lista.sinFecha');
	}
	return new Intl.DateTimeFormat(locale.value, {
		dateStyle: 'full',
		timeStyle: 'short',
	}).format(momento);
});
</script>

<template>
  <section
    class="min-w-0 flex-1 flex-col overflow-y-auto rounded-corner border border-ui-border bg-ui-surface/45 md:flex"
    :class="panel === 'mensaje' ? 'flex' : 'hidden'">
    <p v-if="!abierto" class="p-4 text-tx-muted text-sm">{{ t('mensaje.elegiUno') }}</p>

    <template v-else>
      <header class="flex flex-col gap-1 border-ui-border border-b p-4">
        <!-- Sólo en angosto: de `md` para arriba la lista está al lado y no hay
             de dónde volver. Un botón que no lleva a ningún lado confunde. -->
        <button
          ref="botonVolver"
          type="button"
          class="-ml-1 mb-1 self-start rounded-corner px-2 py-0.5 text-sm text-tx-muted hover:bg-ui-surface md:hidden"
          @click="emit('volver')">
          ← {{ t('mensaje.volver') }}
        </button>
        <h1 class="font-title text-lg">{{ abierto.asunto || t('lista.sinAsunto') }}</h1>
        <p class="text-sm">
          <span class="text-tx-muted">{{ t('mensaje.de') }}: </span>
          <span>{{ abierto.de }}</span>
          <!-- La dirección **siempre**, al lado del nombre y no en su lugar.
               Ponerse de nombre «soporte@banco.com» y escribir desde otra
               dirección es el fraude más común que hay, y mostrar sólo el
               nombre es exactamente lo que lo hace funcionar. Va en un tono
               distinto para que se lea como lo que es: el dato, no la firma. -->
          <span class="text-tx-muted">&lt;{{ abierto.direccion }}&gt;</span>
        </p>
        <p class="text-tx-muted text-xs">
          <span>{{ t('mensaje.cuando') }}: </span>{{ cuando }}
        </p>

        <div class="flex gap-2 pt-1">
          <!-- Responder sólo cuando el mensaje ya está traído: la respuesta
               necesita el identificador del original y la cita del texto, y las
               dos cosas vienen con el cuerpo. Un botón que a veces arma una
               respuesta a medias es peor que un botón que aparece un segundo
               después. -->
          <button
            v-if="cuerpo"
            type="button"
            class="rounded-corner bg-primary px-2 py-0.5 text-sm text-tx-on-primary"
            @click="emit('responder')">
            {{ t('redactar.responder') }}
          </button>
          <button
            v-if="abierto.sin_leer"
            type="button"
            class="rounded-corner border border-ui-border-strong px-2 py-0.5 text-sm hover:bg-ui-surface"
            @click="emit('marcarLeido', abierto)">
            {{ t('mensaje.marcarLeido') }}
          </button>
        </div>
      </header>

      <p v-if="cargando" class="p-4 text-tx-muted text-sm" role="status">
        {{ t('lista.cargando') }}
      </p>

      <template v-else-if="cuerpo">
        <!-- Los dos avisos existen porque callarlos hace perder cosas: un texto
             que termina a la mitad parece un mensaje roto, y un adjunto que no
             se nombra es un archivo que la persona no sabe que recibió. -->
        <!-- Con nombre y tipo, que es lo que faltaba. Todavía no se pueden
             abrir, y el aviso lo dice: enterarse de que vino un archivo y no
             saber cuál sigue siendo perder el archivo, sólo que más despacio.

             El nombre viene saneado del sincronizador. Se muestra en un `<li>`
             y no en un enlace ni en nada que lo interprete: lo eligió quien
             mandó el mensaje. -->
        <div
          v-if="cuerpo.adjuntos.length > 0"
          class="mx-4 mt-3 rounded-corner bg-ui-surface/60 p-2 text-xs">
          <p>📎 {{ t('mensaje.adjuntos') }}</p>
          <ul class="mt-1 flex flex-col gap-1">
            <li
              v-for="a in cuerpo.adjuntos"
              :key="a.parte"
              class="flex items-baseline justify-between gap-2">
              <span class="truncate" :title="a.tipo">{{ a.nombre }}</span>
              <button
                type="button"
                class="shrink-0 rounded-corner border border-ui-border px-1.5 hover:bg-ui-surface disabled:opacity-50"
                :disabled="guardando.has(a.parte)"
                @click="guardar(a)">
                {{ guardando.has(a.parte) ? t('mensaje.guardando') : t('mensaje.guardar') }}
              </button>
            </li>
          </ul>
          <p v-if="avisoGuardar" class="mt-1 text-tx-muted" role="status">{{ avisoGuardar }}</p>
        </div>

        <!-- El mensaje con su formato, **adentro de un contenedor cerrado**.
             El servicio ya lo saneó; esto es la otra mitad, y ninguna reemplaza
             a la otra. `sandbox` vacío es el máximo de restricciones: sin
             permiso para ejecutar nada, sin identidad propia, sin formularios y
             sin poder navegar la ventana que lo contiene. Aunque un `<script>`
             se hubiera escapado del saneado, acá no corre.

             El documento que va adentro trae además su propia política, que no
             deja cargar nada. Ver `tools/formato.ts`. -->
        <template v-if="conFormato && formato">
          <!-- El botón existe porque la decisión es de la persona y no de quien
               escribió el correo. Se va en cuanto se aprieta: lo que queda es lo
               que no se pudo traer, si hubo algo. -->
          <div
            v-if="formato.imagenes_bloqueadas > 0 && imagenes.size === 0"
            class="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-corner bg-ui-surface/60 p-2 text-xs"
            role="status">
            <span class="min-w-0 flex-1">
              {{ imagenesBloqueadas(formato.imagenes_bloqueadas) }}
            </span>
            <button
              type="button"
              class="shrink-0 rounded-corner border border-ui-border-strong px-2 py-0.5 hover:bg-ui-surface disabled:opacity-50"
              :disabled="trayendo"
              @click="mostrarLasImagenes()">
              {{ trayendo ? t('mensaje.trayendoImagenes') : t('mensaje.mostrarImagenes') }}
            </button>
          </div>
          <p
            v-else-if="falloAlTraer > 0"
            class="mx-4 mt-3 rounded-corner bg-ui-surface/60 p-2 text-status-warning text-xs"
            role="status">
            {{ interpolar(t('mensaje.imagenesQueFallaron'), falloAlTraer) }}
          </p>
          <iframe
            :srcdoc="documento"
            sandbox=""
            referrerpolicy="no-referrer"
            class="min-h-0 w-full flex-1 border-0"
            :title="t('mensaje.cuerpo')"></iframe>
        </template>

        <!-- `white-space: pre-wrap` y no HTML.
             El texto lo escribió cualquiera que sepa la dirección de la persona:
             se muestra, no se interpreta. Vue escapa el contenido de una
             interpolación, así que nada de acá se convierte en marcado ni carga
             una imagen remota — que es lo que le confirmaría al remitente que se
             leyó, y desde qué dirección IP. -->
        <pre
          v-else
          class="min-w-0 flex-1 whitespace-pre-wrap break-words p-4 font-sans text-sm">{{ cuerpo.texto }}</pre>

        <p v-if="cuerpo.recortado" class="mx-4 mb-3 rounded-corner bg-ui-surface/60 p-2 text-xs">
          {{ t('mensaje.recortado') }}
        </p>

        <!-- Poder volver al texto pelado es parte de la función, no un resto de
             la versión anterior: es la vista que sirve cuando un mensaje se ve
             raro o cuando no se le tiene confianza a quien lo mandó. -->
        <div class="flex items-center gap-2 px-4 pb-4">
          <button
            v-if="formato"
            type="button"
            class="rounded-corner border border-ui-border-strong px-2 py-0.5 text-xs hover:bg-ui-surface"
            @click="conFormato = !conFormato">
            {{ conFormato ? t('mensaje.verTextoPelado') : t('mensaje.verConFormato') }}
          </button>
          <span v-if="!formato" class="text-tx-muted text-xs">{{ t('mensaje.soloTexto') }}</span>
        </div>
      </template>
    </template>
  </section>
</template>
