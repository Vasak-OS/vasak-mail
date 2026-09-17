<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed } from 'vue';
import { type Accion, teclasPorAccion } from '@/tools/atajos';

const props = defineProps<{
	abierto: boolean;
	/**
	 * El juego de teclas que está en uso.
	 *
	 * Llega por propiedad y no se toma por omisión: tomarlo por omisión era el
	 * error que tenía esto. `teclasPorAccion()` sin argumento da el de Gmail
	 * siempre, así que con el juego estilo Vim elegido la ayuda listaba teclas
	 * que no eran las que respondían.
	 */
	mapa: Readonly<Record<string, Accion>>;
}>();
const emit = defineEmits<{ cerrar: [] }>();

const { t } = useI18n();

/**
 * La lista sale del mismo mapa que ejecuta los atajos.
 *
 * Escribirla a mano sería tener dos listas de lo mismo: la que se muestra y la
 * que funciona. La que quede vieja es la que se muestra, y una ayuda que miente
 * es peor que no tener ayuda.
 */
const atajos = computed(() =>
	teclasPorAccion(props.mapa).map(({ accion, teclas }) => ({
		accion,
		teclas,
		que: t(`atajos.${accion satisfies Accion}`),
	}))
);
</script>

<template>
  <!-- `dialog` y no un `div` con aspecto de diálogo: el rol y el estado modal
       son lo que hace que un lector de pantalla anuncie que se abrió algo
       encima, en vez de leer la lista de mensajes que quedó atrás. -->
  <div
    v-if="abierto"
    class="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
    @click.self="emit('cerrar')">
    <div
      role="dialog"
      aria-modal="true"
      :aria-label="t('atajos.titulo')"
      class="max-h-full w-80 overflow-y-auto rounded-corner border border-ui-border bg-ui-bg p-4 shadow-lg">
      <header class="mb-3 flex items-baseline justify-between gap-2">
        <h2 class="font-medium text-lg text-tx-main">{{ t('atajos.titulo') }}</h2>
        <button
          type="button"
          class="rounded-corner px-2 py-0.5 text-sm text-tx-muted hover:bg-ui-surface"
          @click="emit('cerrar')">
          {{ t('atajos.cerrar') }}
        </button>
      </header>

      <ul class="flex flex-col gap-1.5 text-sm">
        <li v-for="a in atajos" :key="a.accion" class="flex items-baseline justify-between gap-3">
          <span class="text-tx-main">{{ a.que }}</span>
          <span class="flex shrink-0 gap-1">
            <kbd
              v-for="tecla in a.teclas"
              :key="tecla"
              class="rounded-corner border border-ui-border bg-ui-surface px-1.5 font-mono text-xs">
              {{ tecla }}
            </kbd>
          </span>
        </li>
      </ul>

      <p class="mt-3 text-tx-muted text-xs">{{ t('atajos.nota') }}</p>
    </div>
  </div>
</template>
