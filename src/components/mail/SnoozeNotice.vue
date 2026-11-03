<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ToastArea, type ToastNotice } from '@vasakgroup/vue-libvasak';
import { computed, onUnmounted, watch } from 'vue';
import { interpolar } from '@/tools/interpolar';
import { momentoLegible } from '@/tools/programar';

/** Cuánto se ofrece deshacer. Más que el de enviar: acá no hay nada que salga. */
const SEGUNDOS = 8;

const props = defineProps<{
	/** Cuándo vuelve lo que se acaba de posponer. `null` si no hay aviso. */
	volverA: Date | null;
	/** Si hay con qué deshacerlo. */
	sePuedeDeshacer: boolean;
}>();
const emit = defineEmits<{ deshacer: []; vencio: [] }>();

const { t, locale } = useI18n();

let reloj: ReturnType<typeof setTimeout> | null = null;

function parar() {
	if (reloj !== null) {
		clearTimeout(reloj);
		reloj = null;
	}
}

watch(
	() => props.volverA,
	(valor) => {
		parar();
		if (valor) {
			reloj = setTimeout(() => emit('vencio'), SEGUNDOS * 1000);
		}
	},
	{ immediate: true }
);
onUnmounted(parar);

const toasts = computed<ToastNotice[]>(() =>
	props.volverA
		? [
				{
					id: 'snooze',
					tone: 'info',
					message: interpolar(t('posponer.pospuesto'), momentoLegible(props.volverA, locale.value)),
					action: props.sePuedeDeshacer ? { label: t('posponer.deshacer') } : undefined,
				},
			]
		: []
);
</script>

<template>
  <ToastArea :toasts="toasts" position="bottom-center" @action="emit('deshacer')" />
</template>
