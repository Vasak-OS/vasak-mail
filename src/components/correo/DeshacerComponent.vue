<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, onUnmounted, ref, watch } from 'vue';
import { quedan } from '@/tools/deshacer';
import { interpolar } from '@/tools/interpolar';

const props = defineProps<{
	/** Hasta cuándo se puede deshacer, en RFC 3339. `null` si no hay nada. */
	hasta: string | null;
}>();
const emit = defineEmits<{ deshacer: []; vencio: [] }>();

const { t } = useI18n();

/**
 * El reloj, no un contador.
 *
 * Un contador que se decrementa cada segundo se atrasa cuando la ventana está
 * en segundo plano o el equipo suspende, y el cartel terminaría ofreciendo
 * deshacer algo que ya salió. Se vuelve a preguntar la hora cada vez.
 */
const ahora = ref(new Date());
let reloj: ReturnType<typeof setInterval> | null = null;

const segundos = computed(() => (props.hasta ? quedan(props.hasta, ahora.value) : 0));

function parar() {
	if (reloj !== null) {
		clearInterval(reloj);
		reloj = null;
	}
}

watch(
	() => props.hasta,
	(valor) => {
		parar();
		if (!valor) return;
		ahora.value = new Date();
		reloj = setInterval(() => {
			ahora.value = new Date();
			if (quedan(valor, ahora.value) === 0) {
				parar();
				// Se avisa una sola vez, con el reloj ya parado: el cartel se va
				// solo cuando el mensaje efectivamente salió.
				emit('vencio');
			}
		}, 250);
	},
	{ immediate: true }
);

onUnmounted(parar);
</script>

<template>
  <!-- Encima de todo y al pie, que es donde no tapa lo que se está leyendo.
       `role="status"` y no `alert`: es información, no un problema. -->
  <div
    v-if="hasta && segundos > 0"
    class="-translate-x-1/2 absolute bottom-3 left-1/2 z-30 flex items-center gap-3 rounded-corner border border-ui-border bg-ui-bg px-3 py-2 shadow-lg"
    role="status">
    <span class="text-sm">
      {{ interpolar(t('deshacer.enCamino'), String(segundos)) }}
    </span>
    <button
      type="button"
      class="rounded-corner bg-primary px-2 py-0.5 text-sm text-tx-on-primary"
      @click="emit('deshacer')">
      {{ t('deshacer.boton') }}
    </button>
  </div>
</template>
