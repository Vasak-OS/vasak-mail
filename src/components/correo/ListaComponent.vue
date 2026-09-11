<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, nextTick, ref, watch } from 'vue';
import type { Cuenta, Resumen } from '@/composables/use-correo';
import { claveDe, esElMismo } from '@/tools/bandeja';
import { cuando } from '@/tools/fecha';
import type { Panel } from '@/tools/paneles';

const props = defineProps<{
	/** Cuál de los tres paneles se ve. Sólo importa en una ventana angosta. */
	panel: Panel;
	mensajes: Resumen[];
	abierto: Resumen | null;
	cargando: boolean;
	/** Si se están viendo todas las cuentas juntas. */
	combinada: boolean;
	/** Para poder decir de qué cuenta es cada fila cuando están juntas. */
	cuentas: Cuenta[];
	/** El nombre de la carpeta abierta, para el botón de la ventana angosta. */
	carpeta: string;
}>();
const emit = defineEmits<{ abrir: [mensaje: Resumen]; carpetas: [] }>();

const { t, locale } = useI18n();

/**
 * El botón de la carpeta, para recuperar el foco al volver a la lista.
 *
 * Mismo truco que el de volver en el mensaje: es `md:hidden`, así que enfocarlo
 * en una ventana ancha no hace nada y no hay que preguntar por el ancho. Sin
 * esto, al volver de un mensaje el foco se queda en un botón que ya no está en
 * pantalla y quien navega con el teclado empieza de nuevo desde arriba de todo.
 */
const botonCarpeta = ref<HTMLButtonElement | null>(null);

watch(
	() => props.panel,
	async (ahora, antes) => {
		if (ahora !== 'lista' || antes === 'lista') return;
		await nextTick();
		botonCarpeta.value?.focus();
	}
);

/** La hora si llegó hoy, el día si no. Ver `src/tools/fecha.ts`. */
function cuandoLlego(fecha: string): string {
	return cuando(fecha, locale.value, t('lista.sinFecha'));
}

const hayAlgo = computed(() => props.mensajes.length > 0);

/**
 * De qué cuenta es una fila, para mostrarlo en la bandeja combinada.
 *
 * **Sin esto la función es peligrosa y no sólo incómoda**: responder desde una
 * lista mezclada manda desde la cuenta del mensaje, y si no se ve cuál es, la
 * respuesta sale con una identidad que no era la que se creía. Es el error
 * clásico de una bandeja combinada y el más difícil de notar.
 *
 * Sólo cuando están juntas: con una sola cuenta a la vista, repetir su nombre en
 * cada fila es ruido.
 */
const nombres = computed(() => new Map(props.cuentas.map((c) => [c.account_id, c.display_name])));

function cuentaDe(mensaje: Resumen): string {
	return props.combinada ? (nombres.value.get(mensaje.account_id) ?? '') : '';
}
</script>

<template>
  <div
    class="w-full shrink-0 flex-col overflow-y-auto rounded-corner border border-ui-border bg-ui-surface/45 md:flex md:w-80"
    :class="panel === 'lista' ? 'flex' : 'hidden'">
    <!-- El nombre de la carpeta como botón, sólo en angosto: es por donde se
         llega a la lista de carpetas. Un botón con el nombre adentro dice a
         dónde lleva y qué se está mirando; un icono de menú, ninguna de las
         dos. De `md` para arriba las carpetas están al lado. -->
    <button
      ref="botonCarpeta"
      type="button"
      class="flex items-center gap-1 border-ui-border border-b px-3 py-2 text-left text-sm hover:bg-ui-surface md:hidden"
      @click="emit('carpetas')">
      <span class="truncate font-medium">{{ carpeta }}</span>
      <span class="text-tx-muted text-xs">▾</span>
    </button>

    <p v-if="cargando && !hayAlgo" class="p-3 text-tx-muted text-sm" role="status">
      {{ t('lista.cargando') }}
    </p>
    <p v-else-if="!hayAlgo" class="p-3 text-tx-muted text-sm">{{ t('lista.vacia') }}</p>

    <ul v-else class="flex flex-col">
      <!-- La clave es `(cuenta, carpeta, uid)` y no el `uid`: en la combinada
           el 7 de una cuenta y el 7 de otra son dos mensajes distintos, y con
           claves repetidas Vue reusa el nodo equivocado al actualizar. -->
      <li v-for="mensaje in mensajes" :key="claveDe(mensaje)">
        <button
          type="button"
          class="flex w-full flex-col gap-0.5 border-ui-border border-b px-3 py-2 text-left hover:bg-ui-surface/60"
          :class="{ 'bg-ui-surface': esElMismo(mensaje, abierto) }"
          :aria-current="esElMismo(mensaje, abierto) ? 'true' : undefined"
          @click="emit('abrir', mensaje)">
          <div class="flex w-full items-baseline gap-2">
            <!-- Sin leer se marca con el punto **y** con la negrita: el color
                 solo no se ve si no se distinguen los colores (WCAG 1.4.1), y
                 esto es lo que separa lo que falta leer de lo que no.

                 Con `role="img"`, que no es decoración: un `aria-label` sobre un
                 `span` pelado **no se expone**, porque un elemento sin rol no
                 admite nombre accesible. Sin el rol, el punto y el clip eran
                 invisibles para un lector de pantalla y toda la marca de «sin
                 leer» quedaba puesta en el color. -->
            <span
              v-if="mensaje.sin_leer"
              class="h-2 w-2 shrink-0 rounded-full bg-primary"
              role="img"
              :aria-label="t('lista.noLeido')"></span>
            <span
              class="flex-1 truncate text-sm"
              :class="mensaje.sin_leer ? 'font-semibold' : ''"
              :title="`${mensaje.de} <${mensaje.direccion}>`">
              {{ mensaje.de }}
            </span>
            <span class="shrink-0 text-tx-muted text-xs tabular-nums">
              {{ cuandoLlego(mensaje.fecha) }}
            </span>
          </div>
          <div class="flex w-full items-center gap-1">
            <span class="flex-1 truncate text-sm" :class="mensaje.sin_leer ? '' : 'text-tx-muted'">
              {{ mensaje.asunto || t('lista.sinAsunto') }}
            </span>
            <span
              v-if="mensaje.con_adjuntos"
              class="shrink-0 text-tx-muted text-xs"
              :title="t('lista.conAdjuntos')"
              role="img"
              :aria-label="t('lista.conAdjuntos')">📎</span>
          </div>
          <!-- De qué cuenta es. Sólo cuando están todas juntas: con una sola a
               la vista, repetir su nombre en cada fila es ruido. -->
          <span v-if="cuentaDe(mensaje)" class="truncate text-tx-muted text-xs">
            {{ cuentaDe(mensaje) }}
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>
