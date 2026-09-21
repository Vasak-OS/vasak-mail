<script lang="ts" setup>
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { AlertMessage, Dialog, DialogContent, DialogTitle } from '@vasakgroup/vue-libvasak';
import { onMounted, ref } from 'vue';
import { guardarPreferencia, usePreferencias } from '@/composables/use-preferencias';
import { MAX_SEGUNDOS_PARA_DESHACER } from '@/tools/deshacer';
import { interpolar } from '@/tools/interpolar';

/**
 * Las preferencias de la ventana, en un diálogo del sistema.
 *
 * Declaraba `role="dialog"` y `aria-modal="true"` sin cumplir ninguna de las
 * dos: el foco nunca entraba y el Tab seguía recorriendo la lista de mensajes
 * de atrás. Ahora lo pone `DialogContent`, con Escape y el foco devuelto al
 * cerrar.
 */
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

// Éstas las tiene el composable, que es quien las usa: leerlas de nuevo acá
// dejaría dos copias y la de la ventana no se enteraría al cambiarlas.
const { vistaPorOmision, juegoDeAtajos, segundosParaDeshacer } = usePreferencias();

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

/** Guarda una de las de la ventana y la deja valiendo en el acto. */
async function elegirDeLaVentana(clave: string, valor: string | number) {
	error.value = '';
	try {
		await guardarPreferencia(clave, valor);
	} catch (e) {
		error.value = String(e);
	}
}

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
  <Dialog :open="abierto" @update:open="emit('cerrar')">
    <DialogContent class="max-h-full overflow-y-auto">
      <header class="mb-3 flex items-baseline justify-between gap-2">
        <DialogTitle>{{ t('preferencias.titulo') }}</DialogTitle>
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

      <fieldset class="mt-4 flex flex-col gap-1 border-ui-border border-t pt-3">
        <legend class="mb-1 font-medium text-sm">{{ t('preferencias.vista') }}</legend>
        <p class="mb-2 text-tx-muted text-xs">{{ t('preferencias.vistaPorQue') }}</p>
        <label
          v-for="v in ['formato', 'texto']"
          :key="v"
          class="flex items-center gap-2 rounded-corner px-2 py-1 text-sm hover:bg-ui-surface">
          <input
            type="radio"
            name="vista"
            :value="v"
            :checked="vistaPorOmision === v"
            @change="elegirDeLaVentana('vista_por_omision', v)" />
          {{ t(`preferencias.vista_${v}`) }}
        </label>
      </fieldset>

      <fieldset class="mt-4 flex flex-col gap-1 border-ui-border border-t pt-3">
        <legend class="mb-1 font-medium text-sm">{{ t('preferencias.atajos') }}</legend>
        <p class="mb-2 text-tx-muted text-xs">{{ t('preferencias.atajosPorQue') }}</p>
        <label
          v-for="j in ['gmail', 'vim']"
          :key="j"
          class="flex items-center gap-2 rounded-corner px-2 py-1 text-sm hover:bg-ui-surface">
          <input
            type="radio"
            name="atajos"
            :value="j"
            :checked="juegoDeAtajos === j"
            @change="elegirDeLaVentana('juego_de_atajos', j)" />
          {{ t(`preferencias.atajos_${j}`) }}
        </label>
      </fieldset>

      <fieldset class="mt-4 flex flex-col gap-1 border-ui-border border-t pt-3">
        <legend class="mb-1 font-medium text-sm">{{ t('preferencias.deshacer') }}</legend>
        <p class="mb-2 text-tx-muted text-xs">{{ t('preferencias.deshacerPorQue') }}</p>
        <span class="flex items-center gap-2">
          <input
            type="range"
            min="0"
            :max="MAX_SEGUNDOS_PARA_DESHACER"
            step="5"
            class="min-w-0 flex-1"
            :value="segundosParaDeshacer"
            :aria-label="t('preferencias.deshacer')"
            @change="
              elegirDeLaVentana(
                'segundos_para_deshacer',
                Number(($event.target as HTMLInputElement).value)
              )
            " />
          <span class="w-20 shrink-0 text-right text-sm tabular-nums">
            {{
              segundosParaDeshacer === 0
                ? t('preferencias.sinEspera')
                : interpolar(t('preferencias.segundos'), segundosParaDeshacer)
            }}
          </span>
        </span>
      </fieldset>
      <!-- En el aviso del sistema: guardar una preferencia y que falle es un
           error, y con `role="alert"` interrumpe en vez de esperar turno. -->
      <AlertMessage v-if="error" tone="error" icon="dialog-error" class="mt-3">
        {{ error }}
      </AlertMessage>
    </DialogContent>
  </Dialog>
</template>
