<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue';
import type { Borrador } from '@/composables/use-correo';
import { direcciones } from '@/tools/responder';

const props = defineProps<{
	/** Lo que ya trae escrito: vacío para uno nuevo, lleno para una respuesta. */
	inicial: Borrador;
	/** Si es una respuesta, para el título. */
	esRespuesta: boolean;
	enviando: boolean;
}>();

const emit = defineEmits<{
	enviar: [borrador: Borrador];
	cerrar: [];
}>();

const { t } = useI18n();

const para = ref(props.inicial.para.join(', '));
const cc = ref(props.inicial.cc.join(', '));
const asunto = ref(props.inicial.asunto);
const cuerpo = ref(props.inicial.cuerpo);

const campoCuerpo = useTemplateRef<HTMLTextAreaElement>('campoCuerpo');
const campoPara = useTemplateRef<HTMLInputElement>('campoPara');

/**
 * Sin destinatario no hay nada que mandar, y el botón lo dice apagándose.
 *
 * Es lo único que se valida acá: el resto lo revisa el servicio, que es quien
 * sabe qué es una dirección válida, y lo contesta en el acto.
 */
const sePuedeEnviar = computed(() => direcciones(para.value).length > 0 && !props.enviando);

/** Si hay algo escrito que se perdería al cerrar. */
const hayAlgoEscrito = computed(
	() =>
		para.value.trim() !== props.inicial.para.join(', ') ||
		cc.value.trim() !== '' ||
		asunto.value.trim() !== props.inicial.asunto ||
		cuerpo.value.trim() !== props.inicial.cuerpo.trim()
);

onMounted(async () => {
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

function enviar() {
	if (!sePuedeEnviar.value) {
		return;
	}
	emit('enviar', {
		...props.inicial,
		para: direcciones(para.value),
		cc: direcciones(cc.value),
		asunto: asunto.value,
		cuerpo: cuerpo.value,
	});
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
    role="dialog"
    aria-modal="true"
    :aria-label="esRespuesta ? t('redactar.tituloRespuesta') : t('redactar.titulo')"
    @keydown.escape="cerrar()">
    <form
      class="flex max-h-full w-full max-w-2xl flex-col gap-2 rounded-corner border border-ui-border bg-ui-bg p-4 shadow-lg"
      @submit.prevent="enviar()">
      <h2 class="font-title text-lg">
        {{ esRespuesta ? t('redactar.tituloRespuesta') : t('redactar.titulo') }}
      </h2>

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
