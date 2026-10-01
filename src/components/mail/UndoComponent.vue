<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ToastArea, type ToastNotice } from '@vasakgroup/vue-libvasak';
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
const now = ref(new Date());
let clock: ReturnType<typeof setInterval> | null = null;

const seconds = computed(() => (props.hasta ? quedan(props.hasta, now.value) : 0));

function stop() {
	if (clock !== null) {
		clearInterval(clock);
		clock = null;
	}
}

watch(
	() => props.hasta,
	(valor) => {
		stop();
		if (!valor) return;
		now.value = new Date();
		clock = setInterval(() => {
			now.value = new Date();
			if (quedan(valor, now.value) === 0) {
				stop();
				// Se avisa una sola vez, con el reloj ya parado: el cartel se va
				// solo cuando el mensaje efectivamente salió.
				emit('vencio');
			}
		}, 250);
	},
	{ immediate: true }
);

onUnmounted(stop);

/**
 * El aviso, en la bandeja de avisos del sistema: la superficie que flota, al
 * pie y al centro —que es donde no tapa lo que se está leyendo—, con el botón de deshacer como acción. Uno solo, o ninguno.
 *
 * `tone: 'info'` le da `role="status"` y no `alert`: es información, no un
 * problema.
 */
const toasts = computed<ToastNotice[]>(() =>
	props.hasta && seconds.value > 0
		? [
				{
					id: 'undo-send',
					tone: 'info',
					message: interpolar(t('deshacer.enCamino'), String(seconds.value)),
					action: { label: t('deshacer.boton') },
				},
			]
		: []
);
</script>

<template>
  <ToastArea :toasts="toasts" position="bottom-center" @action="emit('deshacer')" />
</template>
