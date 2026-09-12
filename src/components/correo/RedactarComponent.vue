<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, nextTick, onMounted, ref } from 'vue';
import type { Borrador, Cuenta } from '@/composables/use-correo';
import { elegida, momentos, paraElServicio } from '@/tools/programar';
import { direcciones } from '@/tools/responder';

const props = defineProps<{
	/** Lo que ya trae escrito: vacío para uno nuevo, lleno para una respuesta. */
	inicial: Borrador;
	/** Si es una respuesta, para el título. */
	esRespuesta: boolean;
	enviando: boolean;
	/** Todas las conectadas, para poder elegir desde cuál sale. */
	cuentas: Cuenta[];
	/** Desde cuál sale. */
	cuenta: string;
}>();

const emit = defineEmits<{
	/** `cuando` es una hora en RFC 3339, o vacío para «con la ventana de siempre». */
	enviar: [borrador: Borrador, cuando: string];
	elegirCuenta: [accountId: string];
	cerrar: [];
}>();

const { t, locale } = useI18n();

const para = ref(props.inicial.para.join(', '));
const cc = ref(props.inicial.cc.join(', '));
const asunto = ref(props.inicial.asunto);
const cuerpo = ref(props.inicial.cuerpo);

/**
 * De qué cuenta sale, siempre a la vista.
 *
 * **No es un adorno.** Con la bandeja combinada, lo que se está mirando y lo que
 * responde pueden ser cuentas distintas, y una respuesta que sale con la
 * identidad equivocada no se deshace: la lee quien la recibe, con otra dirección
 * de remitente, y nadie se entera de este lado.
 *
 * Con una sola cuenta conectada se dice igual pero no se puede cambiar: no hay
 * a qué.
 */
const remitente = computed(
	() => props.cuentas.find((c) => c.account_id === props.cuenta)?.display_name ?? ''
);
const sePuedeElegir = computed(() => props.cuentas.length > 1);

const campoCuerpo = useTemplateRef<HTMLTextAreaElement>('campoCuerpo');
const campoPara = useTemplateRef<HTMLInputElement>('campoPara');
const dialogo = useTemplateRef<HTMLElement>('dialogo');

/**
 * Adónde vuelve el foco al cerrar.
 *
 * Sin esto, cerrar la ventana deja el foco en el `body` y quien recorre con el
 * teclado tiene que volver a atravesar la aplicación entera para llegar al
 * botón que acaba de apretar.
 */
let devolverElFoco: HTMLElement | null = null;

/**
 * Sin destinatario no hay nada que mandar, y el botón lo dice apagándose.
 *
 * Es lo único que se valida acá: el resto lo revisa el servicio, que es quien
 * sabe qué es una dirección válida, y lo contesta en el acto.
 */
const sePuedeEnviar = computed(() => direcciones(para.value).length > 0 && !props.enviando);

/**
 * Si hay algo escrito que se perdería al cerrar.
 *
 * Se compara con **lo que se abrió** y no con lo que está vacío, a propósito:
 * una respuesta recién abierta ya trae destinatario, asunto y la cita, y
 * preguntar por eso sería preguntar por algo que se rehace apretando
 * «Responder» otra vez. Lo que no se puede rehacer es lo que la persona
 * escribió, y eso es exactamente lo que difiere del punto de partida.
 */
const hayAlgoEscrito = computed(
	() =>
		para.value.trim() !== props.inicial.para.join(', ') ||
		cc.value.trim() !== '' ||
		asunto.value.trim() !== props.inicial.asunto ||
		cuerpo.value.trim() !== props.inicial.cuerpo.trim()
);

onMounted(async () => {
	devolverElFoco = document.activeElement as HTMLElement | null;
	await nextTick();
	// El foco donde falta escribir: en una respuesta el destinatario y el
	// asunto ya están, así que ir al cuerpo ahorra dos tabulaciones.
	if (props.esRespuesta) {
		campoCuerpo.value?.focus();
		// Y el cursor arriba de la cita, que es donde se escribe.
		campoCuerpo.value?.setSelectionRange(0, 0);
	} else {
		campoPara.value?.focus();
	}
});

onUnmounted(() => devolverElFoco?.focus());

/**
 * Mantiene el foco adentro.
 *
 * Un diálogo modal que deja salir el foco con `Tab` es un diálogo modal a
 * medias: quien recorre con el teclado termina apretando botones de la ventana
 * de atrás, que están tapados y no responden a `Escape`. El ciclo se cierra a
 * mano — `inert` sobre lo de atrás sería más limpio, pero depende de la versión
 * del motor y esto anda en todas.
 */
function atraparElFoco(evento: KeyboardEvent) {
	// `select` entre los demás: el desplegable de «Desde» es el primer elemento
	// del formulario, así que si no entra en esta lista la trampa lo saltea al
	// dar la vuelta y no hay forma de llegar a él con el teclado.
	const dentro = dialogo.value?.querySelectorAll<HTMLElement>(
		'input, select, textarea, button:not([disabled])'
	);
	if (!dentro || dentro.length === 0) {
		return;
	}
	const primero = dentro[0];
	const ultimo = dentro[dentro.length - 1];

	if (evento.shiftKey && document.activeElement === primero) {
		evento.preventDefault();
		ultimo.focus();
	} else if (!evento.shiftKey && document.activeElement === ultimo) {
		evento.preventDefault();
		primero.focus();
	}
}

/** Si está abierto el menú de programar. */
const programando = ref(false);
/** Lo que se escribió en el control de fecha y hora, si se usó. */
const aMano = ref('');

const opciones = computed(() => momentos(new Date()));

/** La hora de una opción, en el idioma de la sesión. */
function aQueHora(cuando: Date): string {
	return new Intl.DateTimeFormat(locale.value, {
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
	}).format(cuando);
}

/**
 * Programa y manda. La hora se pasa al servicio en UTC.
 *
 * Una hora que ya pasó no llega hasta acá: `momentos` no ofrece las que
 * pasaron y `elegida` rechaza las que se escriban a mano. Programar para antes
 * de ahora haría salir el mensaje en el acto, que es lo contrario de lo que se
 * pidió — y sin nada que lo explique.
 */
function programar(cuando: Date) {
	programando.value = false;
	if (!sePuedeEnviar.value) {
		return;
	}
	emit('enviar', armar(), paraElServicio(cuando));
}

function programarAMano() {
	const cuando = elegida(aMano.value, new Date());
	if (cuando) {
		programar(cuando);
	}
}

/** El borrador con lo que hay en pantalla. */
function armar(): Borrador {
	return {
		...props.inicial,
		para: direcciones(para.value),
		cc: direcciones(cc.value),
		asunto: asunto.value,
		cuerpo: cuerpo.value,
	};
}

function enviar() {
	if (!sePuedeEnviar.value) {
		return;
	}
	// Vacío quiere decir «con la ventana para arrepentirse de siempre»: la hora
	// la calcula quien dibuja ese botón, no esta ventana.
	emit('enviar', armar(), '');
}

function cerrar() {
	// Preguntar antes de tirar lo que alguien escribió. Es barato y lo otro no
	// se deshace.
	if (hayAlgoEscrito.value && !window.confirm(t('redactar.descartarBorrador'))) {
		return;
	}
	emit('cerrar');
}
</script>

<template>
  <!-- Sobre la ventana y no en una ventana aparte: escribir un correo es una
       cosa que se hace y se termina, y una ventana más para cerrar después no
       aporta nada. `Escape` cierra, que es lo que la gente prueba. -->
  <div
    class="absolute inset-0 z-10 flex items-center justify-center bg-ui-bg/60 p-4"
    ref="dialogo"
    role="dialog"
    aria-modal="true"
    :aria-label="esRespuesta ? t('redactar.tituloRespuesta') : t('redactar.titulo')"
    @keydown.escape="cerrar()"
    @keydown.tab="atraparElFoco">
    <form
      class="flex max-h-full w-full max-w-2xl flex-col gap-2 rounded-corner border border-ui-border bg-ui-bg p-4 shadow-lg"
      @submit.prevent="enviar()">
      <h2 class="font-title text-lg">
        {{ esRespuesta ? t('redactar.tituloRespuesta') : t('redactar.titulo') }}
      </h2>

      <!-- Desde qué cuenta sale, arriba de todo: es lo primero que hay que
           poder comprobar cuando hay más de una casilla. -->
      <label class="flex flex-col gap-0.5">
        <span class="text-tx-muted text-xs">{{ t('redactar.desde') }}</span>
        <select
          v-if="sePuedeElegir"
          class="rounded-corner-sm border border-ui-border-strong bg-ui-surface px-2 py-1 text-sm text-tx-main"
          :value="cuenta"
          @change="emit('elegirCuenta', ($event.target as HTMLSelectElement).value)">
          <option
            v-for="c in cuentas"
            :key="c.account_id"
            class="bg-ui-bg text-tx-main"
            :value="c.account_id">
            {{ c.display_name }}
          </option>
        </select>
        <span v-else class="px-2 py-1 text-sm">{{ remitente }}</span>
      </label>

      <label class="flex flex-col gap-0.5">
        <span class="text-tx-muted text-xs">{{ t('redactar.para') }}</span>
        <input
          ref="campoPara"
          v-model="para"
          type="text"
          class="rounded-corner-sm border border-ui-border-strong bg-ui-surface/40 px-2 py-1 text-sm"
          :placeholder="t('redactar.variasDirecciones')"
          autocomplete="off" />
      </label>

      <label class="flex flex-col gap-0.5">
        <span class="text-tx-muted text-xs">{{ t('redactar.cc') }}</span>
        <input
          v-model="cc"
          type="text"
          class="rounded-corner-sm border border-ui-border-strong bg-ui-surface/40 px-2 py-1 text-sm"
          autocomplete="off" />
      </label>

      <label class="flex flex-col gap-0.5">
        <span class="text-tx-muted text-xs">{{ t('redactar.asunto') }}</span>
        <input
          v-model="asunto"
          type="text"
          class="rounded-corner-sm border border-ui-border-strong bg-ui-surface/40 px-2 py-1 text-sm"
          autocomplete="off" />
      </label>

      <label class="flex min-h-0 flex-1 flex-col gap-0.5">
        <span class="text-tx-muted text-xs">{{ t('redactar.cuerpo') }}</span>
        <textarea
          ref="campoCuerpo"
          v-model="cuerpo"
          rows="12"
          class="min-h-40 flex-1 resize-none rounded-corner-sm border border-ui-border-strong bg-ui-surface/40 px-2 py-1 font-sans text-sm"></textarea>
      </label>

      <!-- Se dice porque cambia lo que la persona espera del botón: «Enviar» no
           espera al servidor, guarda el mensaje y lo manda cuando pueda. Sin
           esto, cerrar la ventana enseguida da miedo. -->
      <p class="text-tx-muted text-xs">{{ t('redactar.seEncola') }}</p>

      <div class="flex justify-end gap-2 pt-1">
        <button
          type="button"
          class="rounded-corner px-3 py-1 text-sm hover:bg-ui-surface"
          @click="cerrar()">
          {{ t('redactar.cancelar') }}
        </button>
        <!-- Programar va **al lado** de enviar y no adentro de un menú de tres
             puntos: es una forma de mandar, no una preferencia escondida. -->
        <div class="relative">
          <button
            type="button"
            class="rounded-corner border border-ui-border px-2 py-1 text-sm hover:bg-ui-surface disabled:opacity-50"
            :disabled="!sePuedeEnviar"
            :aria-expanded="programando"
            :title="t('programar.titulo')"
            @click="programando = !programando">
            {{ t('programar.boton') }}
          </button>

          <div
            v-if="programando"
            class="absolute bottom-full right-0 z-10 mb-1 w-60 rounded-corner border border-ui-border bg-ui-bg p-2 shadow-lg">
            <ul class="flex flex-col">
              <li v-for="opcion in opciones" :key="opcion.clave">
                <button
                  type="button"
                  class="flex w-full items-baseline justify-between gap-2 rounded-corner px-2 py-1 text-left text-sm hover:bg-ui-surface"
                  @click="programar(opcion.cuando)">
                  <span>{{ t(opcion.clave) }}</span>
                  <span class="text-tx-muted text-xs">{{ aQueHora(opcion.cuando) }}</span>
                </button>
              </li>
            </ul>

            <label class="mt-2 flex flex-col gap-1 text-tx-muted text-xs">
              {{ t('programar.aMano') }}
              <input
                v-model="aMano"
                type="datetime-local"
                class="rounded-corner border border-ui-border bg-ui-bg px-2 py-1 text-sm text-tx-main" />
            </label>
            <button
              type="button"
              class="mt-1 w-full rounded-corner bg-primary px-2 py-1 text-sm text-tx-on-primary disabled:opacity-50"
              :disabled="!elegida(aMano, new Date())"
              @click="programarAMano()">
              {{ t('programar.confirmar') }}
            </button>
          </div>
        </div>

        <button
          type="submit"
          class="rounded-corner bg-primary px-3 py-1 text-sm text-tx-on-primary disabled:opacity-50"
          :disabled="!sePuedeEnviar">
          {{ enviando ? t('redactar.enviando') : t('redactar.enviar') }}
        </button>
      </div>
    </form>
  </div>
</template>
