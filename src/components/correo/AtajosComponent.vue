<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { Dialog, DialogContent, DialogTitle } from '@vasakgroup/vue-libvasak';
import { computed } from 'vue';
import { type Accion, teclasPorAccion } from '@/tools/atajos';

/**
 * La ayuda de atajos, en un diálogo del sistema.
 *
 * Declaraba `role="dialog"` y `aria-modal="true"` y no cumplía ninguna de las
 * dos cosas que eso promete: el foco nunca entraba —se quedaba en el botón de
 * atrás— y el Tab seguía recorriendo la lista de mensajes que el velo tapaba.
 * Un lector de pantalla anunciaba un diálogo modal, y el teclado seguía en la
 * pantalla anterior.
 *
 * Eso ahora lo pone `DialogContent`, junto con Escape y la devolución del foco
 * al cerrar. Y el título pasa a ser `DialogTitle`, que se registra solo para
 * que el `aria-labelledby` lo apunte: mejor que repetir el texto en un
 * `aria-label`, que es una segunda copia que puede quedarse vieja.
 *
 * El ancho propio —`w-80`— se va con lo demás. Sobreescribir el del sistema no
 * es estable: las dos clases van en el mismo atributo y ahí gana la que
 * Tailwind haya emitido después en la hoja, no la que se escribió última.
 */
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
  <Dialog :open="abierto" @update:open="emit('cerrar')">
    <DialogContent class="max-h-full overflow-y-auto">
      <header class="mb-3 flex items-baseline justify-between gap-2">
        <DialogTitle>{{ t('atajos.titulo') }}</DialogTitle>
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
    </DialogContent>
  </Dialog>
</template>
