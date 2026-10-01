<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle, Kbd } from '@vasakgroup/vue-libvasak';
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
const shortcuts = computed(() =>
	teclasPorAccion(props.mapa).map(({ accion, teclas }) => ({
		accion,
		teclas,
		what: t(`atajos.${accion satisfies Accion}`),
	}))
);
</script>

<template>
  <Dialog :open="abierto" @update:open="emit('cerrar')">
    <DialogContent class="max-h-full overflow-y-auto">
      <DialogHeader :close-label="t('atajos.cerrar')" close-style="label" class="mb-3">
        <DialogTitle>{{ t('atajos.titulo') }}</DialogTitle>
      </DialogHeader>

      <ul class="flex flex-col gap-1.5 text-body-s">
        <li v-for="a in shortcuts" :key="a.accion" class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <!-- `min-w-24` y la fila que baja: en un diálogo angosto las teclas
               pasan abajo en lugar de dejar el nombre en una columna de una
               letra. -->
          <span class="min-w-24 flex-1 break-words text-tx-main">{{ a.what }}</span>
          <!-- Cada tecla, o secuencia de teclas, es una alternativa: van una al
               lado de la otra y no unidas con «+», que sería decir que se
               aprietan juntas. -->
          <span class="ml-auto flex shrink-0 flex-wrap justify-end gap-1">
            <Kbd v-for="tecla in a.teclas" :key="tecla">{{ tecla }}</Kbd>
          </span>
        </li>
      </ul>

      <p class="mt-3 text-body-xs text-tx-muted">{{ t('atajos.nota') }}</p>
    </DialogContent>
  </Dialog>
</template>
