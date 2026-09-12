<script lang="ts" setup>
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { onMounted, ref } from 'vue';

defineProps<{ abierto: boolean }>();
const emit = defineEmits<{ cerrar: [] }>();

const { t } = useI18n();

/**
 * Cuánto cuenta el cartel de correo nuevo.
 *
 * El orden es de menos a más y el primero es el que vale cuando nadie eligió:
 * la pantalla puede estar bloqueada, compartida o proyectada, y quién te
 * escribe es un dato tan personal como lo que te escribió.
 */
const ESCALONES = ['cuenta', 'remitente', 'remitente_y_asunto'] as const;

const detalle = ref<string>('cuenta');
const error = ref('');

onMounted(async () => {
	try {
		const guardado = JSON.parse(await invoke<string>('leer_preferencias'));
		const valor = guardado?.detalle_del_aviso;
		// Sólo si es uno de los que existen. Un valor raro en el archivo no
		// puede dejar el selector mostrando algo que no es ninguna opción.
		if (typeof valor === 'string' && (ESCALONES as readonly string[]).includes(valor)) {
			detalle.value = valor;
		}
	} catch (e) {
		error.value = String(e);
	}
});

async function elegir(valor: string) {
	const antes = detalle.value;
	// Se pinta primero y se corrige si falla: un selector que tarda en moverse
	// hace que lo aprieten dos veces.
	detalle.value = valor;
	error.value = '';
	try {
		await invoke('poner_preferencia', { clave: 'detalle_del_aviso', valor });
	} catch (e) {
		detalle.value = antes;
		error.value = String(e);
	}
}
</script>

<template>
  <div
    v-if="abierto"
    class="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
    @click.self="emit('cerrar')">
    <div
      role="dialog"
      aria-modal="true"
      :aria-label="t('preferencias.titulo')"
      class="max-h-full w-96 overflow-y-auto rounded-corner border border-ui-border bg-ui-bg p-4 shadow-lg">
      <header class="mb-3 flex items-baseline justify-between gap-2">
        <h2 class="font-medium text-lg text-tx-main">{{ t('preferencias.titulo') }}</h2>
        <button
          type="button"
          class="rounded-corner px-2 py-0.5 text-sm text-tx-muted hover:bg-ui-surface"
          @click="emit('cerrar')">
          {{ t('preferencias.cerrar') }}
        </button>
      </header>

      <fieldset class="flex flex-col gap-1">
        <legend class="mb-1 font-medium text-sm">{{ t('preferencias.cartel') }}</legend>
        <!-- Se dice por qué el primero es el que viene puesto. Una opción de
             privacidad sin el motivo se cambia sin pensarlo. -->
        <p class="mb-2 text-tx-muted text-xs">{{ t('preferencias.cartelPorQue') }}</p>

        <label
          v-for="escalon in ESCALONES"
          :key="escalon"
          class="flex items-center gap-2 rounded-corner px-2 py-1 text-sm hover:bg-ui-surface">
          <input
            type="radio"
            name="detalle"
            :value="escalon"
            :checked="detalle === escalon"
            @change="elegir(escalon)" />
          {{ t(`preferencias.${escalon}`) }}
        </label>
      </fieldset>

      <p class="mt-3 text-tx-muted text-xs">{{ t('preferencias.conVarios') }}</p>
      <p v-if="error" class="mt-2 text-status-warning text-xs" role="status">{{ error }}</p>
    </div>
  </div>
</template>
