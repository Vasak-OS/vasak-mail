<script lang="ts" setup>
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	AlertMessage,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	OptionGroup,
	Slider,
} from '@vasakgroup/vue-libvasak';
import { computed, onMounted, ref } from 'vue';
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
const LEVELS = ['cuenta', 'remitente', 'remitente_y_asunto'] as const;

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
		if (typeof valor === 'string' && (LEVELS as readonly string[]).includes(valor)) {
			detalle.value = valor;
		}
	} catch (e) {
		error.value = String(e);
	}
});

/** Las opciones de cada grupo, ya traducidas. */
const detailOptions = computed(() =>
	LEVELS.map((value) => ({ value, label: t(`preferencias.${value}`) }))
);
const viewOptions = computed(() =>
	['formato', 'texto'].map((value) => ({ value, label: t(`preferencias.vista_${value}`) }))
);
const shortcutOptions = computed(() =>
	['gmail', 'vim'].map((value) => ({ value, label: t(`preferencias.atajos_${value}`) }))
);

/** Cuánto se espera, dicho como se lee al lado del control y en voz alta. */
const undoText = computed(() =>
	segundosParaDeshacer.value === 0
		? t('preferencias.sinEspera')
		: interpolar(t('preferencias.segundos'), segundosParaDeshacer.value)
);

/** Guarda una de las de la ventana y la deja valiendo en el acto. */
async function chooseForWindow(clave: string, valor: string | number) {
	error.value = '';
	try {
		await guardarPreferencia(clave, valor);
	} catch (e) {
		error.value = String(e);
	}
}

async function chooseDetail(valor: string) {
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
      <!-- El cerrar con su texto y a la derecha, como estaba: lo dibuja el
           encabezado del sistema y cierra por el mismo camino que Escape. -->
      <DialogHeader :close-label="t('preferencias.cerrar')" close-style="label" class="mb-3">
        <DialogTitle>{{ t('preferencias.titulo') }}</DialogTitle>
      </DialogHeader>

      <!-- Cada grupo es un `radiogroup` del sistema: flechas para moverse,
           un solo Tab para entrar y salir, y el nombre en `label`. La leyenda
           que se ve es la misma frase, como encabezado. -->
      <section class="flex flex-col gap-1">
        <h3 class="mb-1 font-semibold text-label-m">{{ t('preferencias.cartel') }}</h3>
        <!-- Se dice por qué el primero es el que viene puesto. Una opción de
             privacidad sin el motivo se cambia sin pensarlo. -->
        <p class="mb-2 text-body-xs text-tx-muted">{{ t('preferencias.cartelPorQue') }}</p>
        <OptionGroup
          :model-value="detalle"
          :options="detailOptions"
          :label="t('preferencias.cartel')"
          size="sm"
          @change="chooseDetail" />
      </section>

      <p class="mt-3 text-body-xs text-tx-muted">{{ t('preferencias.conVarios') }}</p>

      <section class="mt-4 flex flex-col gap-1 border-ui-line-weak border-t pt-3">
        <h3 class="mb-1 font-semibold text-label-m">{{ t('preferencias.vista') }}</h3>
        <p class="mb-2 text-body-xs text-tx-muted">{{ t('preferencias.vistaPorQue') }}</p>
        <OptionGroup
          :model-value="vistaPorOmision"
          :options="viewOptions"
          :label="t('preferencias.vista')"
          size="sm"
          @change="(v: string) => chooseForWindow('vista_por_omision', v)" />
      </section>

      <section class="mt-4 flex flex-col gap-1 border-ui-line-weak border-t pt-3">
        <h3 class="mb-1 font-semibold text-label-m">{{ t('preferencias.atajos') }}</h3>
        <p class="mb-2 text-body-xs text-tx-muted">{{ t('preferencias.atajosPorQue') }}</p>
        <OptionGroup
          :model-value="juegoDeAtajos"
          :options="shortcutOptions"
          :label="t('preferencias.atajos')"
          size="sm"
          @change="(j: string) => chooseForWindow('juego_de_atajos', j)" />
      </section>

      <section class="mt-4 flex flex-col gap-1 border-ui-line-weak border-t pt-3">
        <h3 class="mb-1 font-semibold text-label-m">{{ t('preferencias.deshacer') }}</h3>
        <p class="mb-2 text-body-xs text-tx-muted">{{ t('preferencias.deshacerPorQue') }}</p>
        <!-- `lazy`: se guarda al soltar, no en cada paso del arrastre. Eran
             veinte escrituras del archivo por un solo cambio. -->
        <Slider
          :model-value="segundosParaDeshacer"
          :min="0"
          :max="MAX_SEGUNDOS_PARA_DESHACER"
          :step="5"
          :label="t('preferencias.deshacer')"
          :value-text="undoText"
          lazy
          @change="(v: number) => chooseForWindow('segundos_para_deshacer', v)">
          <template #end>
            <span class="inline-block w-20 text-right text-label-s text-tx-main tabular-nums">{{ undoText }}</span>
          </template>
        </Slider>
      </section>
      <!-- En el aviso del sistema: guardar una preferencia y que falle es un
           error, y con `role="alert"` interrumpe en vez de esperar turno. -->
      <AlertMessage v-if="error" tone="error" icon="dialog-error" class="mt-3">
        {{ error }}
      </AlertMessage>
    </DialogContent>
  </Dialog>
</template>
