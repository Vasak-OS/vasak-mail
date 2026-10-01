<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	EmptyState,
	ListRow,
	LoadingState,
	Panel,
	SearchField,
	StatusDot,
	ThemeIcon,
} from '@vasakgroup/vue-libvasak';
import { computed, nextTick, ref, watch } from 'vue';
import type { Cuenta, Resumen } from '@/composables/use-correo';
import { claveDe, esElMismo } from '@/tools/bandeja';
import type { Alcance } from '@/tools/busqueda';
import { cuando } from '@/tools/fecha';
import { pickFocusTarget, ROW_SELECTORS } from '@/tools/focus';
import { type Pane, paneVisibility, shouldRescueFocus } from '@/tools/panes';

const props = defineProps<{
	/** Cuál de los tres paneles se ve. Sólo importa en una ventana angosta. */
	panel: Pane;
	mensajes: Resumen[];
	abierto: Resumen | null;
	cargando: boolean;
	/** Si se están viendo todas las cuentas juntas. */
	combinada: boolean;
	/** Para poder decir de qué cuenta es cada fila cuando están juntas. */
	cuentas: Cuenta[];
	/** El nombre de la carpeta abierta, para el botón de la ventana angosta. */
	carpeta: string;
	/** Lo que se escribió en el buscador. */
	consulta: string;
	/** Qué se está mostrando: todo, el filtro local, o lo que trajo el servidor. */
	queSeVe: Alcance;
	buscandoEnElServidor: boolean;
}>();
const emit = defineEmits<{
	abrir: [mensaje: Resumen];
	carpetas: [];
	buscar: [texto: string];
	buscarEnElServidor: [];
	limpiar: [];
}>();

const { t, locale } = useI18n();

/**
 * El botón de la carpeta, para recuperar el foco al volver a la lista.
 *
 * Mismo truco que el de volver en el mensaje: se esconde cuando entran los tres
 * paneles —por la consulta de contenedor `@three-panes/panes:hidden`—, así que
 * enfocarlo en una ventana ancha no hace nada y no hay que preguntar por el
 * ancho. Sin esto, al volver de un mensaje el foco se queda en un botón que ya
 * no está en pantalla y quien navega con el teclado empieza de nuevo desde
 * arriba de todo.
 *
 * Es el `ActionButton` de la librería, que no expone el elemento: se alcanza
 * por `$el`, que es el `<button>` mismo.
 */
const folderButton = ref<InstanceType<typeof ActionButton> | null>(null);

/** El panel entero, para poder preguntar si el foco cayó adentro. */
const root = ref<InstanceType<typeof Panel> | null>(null);

/**
 * El panel se puede enfocar desde el código pero no con el Tab: es el último
 * recurso de `pickFocusTarget` cuando la lista está vacía. Va por `v-bind`
 * porque `Panel` no declara `tabindex` y lo pasa como atributo.
 */
const FOCUSABLE_ROOT = { tabindex: -1 } as const;

function rootElement(): HTMLElement | null {
	return (root.value?.$el as HTMLElement | undefined) ?? null;
}

watch(
	() => props.panel,
	async (ahora, antes) => {
		await nextTick();
		// Se pregunta **después** del `nextTick`, no antes: en ese rato el panel
		// se dibujó y alguien más pudo haber puesto el foco donde quería. Ver
		// `shouldRescueFocus`, que es donde está el porqué.
		const inside = rootElement()?.contains(document.activeElement) ?? false;
		if (shouldRescueFocus(ahora, antes, inside)) {
			(folderButton.value?.$el as HTMLElement | undefined)?.focus();
		}
	}
);

const search = ref<InstanceType<typeof SearchField> | null>(null);

/**
 * Pone el foco en el buscador, y **dice si lo consiguió**.
 *
 * Lo segundo es lo que importa. En una ventana angosta este panel entero está
 * `hidden` cuando se está leyendo un mensaje, y enfocar algo que no se dibuja no
 * hace nada ni falla: la tecla de buscar parecería rota. Devolviendo si el foco
 * llegó, quien llama puede volver a la lista y reintentar, sin que ninguno de
 * los dos tenga que preguntar cuánto mide la ventana.
 *
 * Enfocar y comprobar lo hace ahora el campo, que es quien tiene el elemento:
 * acá alcanzarlo pediría `$el`, que es `any`.
 */
function focusSearch(): boolean {
	return search.value?.focus() ?? false;
}

defineExpose({ focusSearch });

/**
 * Escape en el buscador: limpia **y** devuelve el foco a la lista.
 *
 * Limpiar solo dejaba el foco adentro del campo, y ahí los atajos de una tecla
 * no se disparan a propósito —escribir una «r» tiene que escribir una «r»—, así
 * que había que apretar Tab para que `j` y `k` volvieran a andar. Arrepentirse
 * de una búsqueda y quedar sin teclado es el peor momento para pedir una tecla
 * más.
 *
 * Se espera un `nextTick` porque limpiar cambia la lista: las filas que el
 * filtro escondía vuelven, y la del mensaje abierto puede no ser la misma de
 * antes. Enfocar antes de eso apuntaría a una fila que está por desaparecer.
 */
async function leaveSearch() {
	emit('limpiar');
	await nextTick();
	const row = (selector: string) => rootElement()?.querySelector<HTMLElement>(selector) ?? null;
	pickFocusTarget({
		// `aria-current` ya marca cuál está abierto: se lee de la plantilla en vez
		// de llevar una segunda cuenta de lo mismo.
		open: row(ROW_SELECTORS.open),
		first: row(ROW_SELECTORS.first),
		container: rootElement(),
	})?.focus();
}

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
  <Panel
    ref="root"
    v-bind="FOCUSABLE_ROOT"
    padding="none"
    scroll
    class="w-full shrink-0 @three-panes/panes:w-80"
    :class="paneVisibility('list', panel)">
    <!-- La lista ocupa todo el ancho cuando va sola y 20rem cuando entran los
         tres paneles. Cuál se ve en angosto lo decide `panel`; «angosto» lo
         decide la fila de la ventana (`@container/panes` en `MailView.vue`), no
         la pantalla. -->
    <!-- El nombre de la carpeta como botón, sólo en angosto: es por donde se
         llega a la lista de carpetas. Un botón con el nombre adentro dice a
         dónde lleva y qué se está mirando; un icono de menú, ninguna de las
         dos. Cuando entran los tres, las carpetas están al lado. -->
    <div class="border-ui-line-weak border-b p-1 @three-panes/panes:hidden">
      <ActionButton
        ref="folderButton"
        :label="carpeta"
        variant="ghost"
        icon="pan-down-symbolic"
        icon-right
        class="max-w-full justify-start"
        @click="emit('carpetas')" />
    </div>

    <!-- El buscador. Mientras se escribe filtra lo que ya está, que es
         instantáneo; con Enter se le pregunta al servidor, que es el único que
         tiene el correo entero. Ésa es exactamente la división del campo del
         sistema: `update:modelValue` en cada tecla y `search` cuando hay que
         buscar de verdad. El rebote se queda en cero —lo de fábrica— porque
         acá «buscar de verdad» es hablar con el servidor IMAP, y hacerlo en
         cada pausa de escritura sería una consulta por pausa.

         Escape no lo decide el campo, a propósito: qué significa depende de
         dónde viva. Acá limpia y devuelve el foco a la lista. -->
    <div class="border-ui-line-weak border-b p-2">
      <SearchField
        ref="search"
        :model-value="consulta"
        :placeholder="t('buscar.campo')"
        :label="t('buscar.campo')"
        :busy="buscandoEnElServidor"
        @update:model-value="(texto: string) => emit('buscar', texto)"
        @search="emit('buscarEnElServidor')"
        @clear="leaveSearch"
        @keydown.escape="leaveSearch" />

      <!-- **Decir qué se está mostrando no es cosmético.** «Los últimos
           doscientos que coinciden» y «todo lo que el servidor encontró» son
           respuestas distintas a la misma pregunta, y sin esto la lista cambia
           de significado sin aviso: alguien concluye que un mensaje no existe
           cuando lo que pasa es que está más atrás. -->
      <p v-if="buscandoEnElServidor" class="mt-1 text-body-xs text-tx-muted" role="status">
        {{ t('buscar.preguntando') }}
      </p>
      <p v-else-if="queSeVe === 'local'" class="mt-1 text-body-xs text-tx-muted">
        {{ t('buscar.soloLoQueEsta') }}
      </p>
      <p v-else-if="queSeVe === 'servidor'" class="mt-1 text-body-xs text-tx-muted" role="status">
        {{ t('buscar.delServidor') }}
      </p>
    </div>

    <LoadingState v-if="cargando && !hayAlgo" size="sm" :label="t('lista.cargando')" />
    <!-- Sin icono: el panel es angosto y la frase ya dice todo. -->
    <EmptyState v-else-if="!hayAlgo" size="sm" icon="" :title="t('lista.vacia')" />

    <ul v-else class="flex flex-col gap-0.5 p-1">
      <!-- La clave es `(cuenta, carpeta, uid)` y no el `uid`: en la combinada
           el 7 de una cuenta y el 7 de otra son dos mensajes distintos, y con
           claves repetidas Vue reusa el nodo equivocado al actualizar.

           `role="button"` y `selected`: es `ListRow` la que pone el
           `aria-current` en la fila abierta, y lo que buscan los selectores de
           `tools/focus.ts`. -->
      <li v-for="mensaje in mensajes" :key="claveDe(mensaje)">
        <ListRow
          role="button"
          :selected="esElMismo(mensaje, abierto)"
          @click="emit('abrir', mensaje)">
          <span class="flex w-full min-w-0 items-center gap-2">
            <!-- Sin leer se marca con el punto **y** con la negrita: el color
                 solo no se ve si no se distinguen los colores (WCAG 1.4.1), y
                 esto es lo que separa lo que falta leer de lo que no.

                 Con nombre: `StatusDot` con `label` se expone como imagen con
                 nombre accesible, que es lo que hacía falta para que la marca
                 de «sin leer» no quedara puesta sólo en el color. -->
            <StatusDot v-if="mensaje.sin_leer" tone="accent" :label="t('lista.noLeido')" />
            <span
              class="min-w-0 flex-1 truncate text-label-m"
              :class="mensaje.sin_leer ? 'font-semibold' : 'font-normal'"
              :title="`${mensaje.de} <${mensaje.direccion}>`">
              {{ mensaje.de }}
            </span>
            <span class="shrink-0 text-label-xs font-normal text-tx-muted tabular-nums">
              {{ cuandoLlego(mensaje.fecha) }}
            </span>
          </span>
          <span class="flex w-full min-w-0 items-center gap-1">
            <span
              class="min-w-0 flex-1 truncate text-body-s font-normal"
              :class="mensaje.sin_leer ? '' : 'text-tx-muted'">
              {{ mensaje.asunto || t('lista.sinAsunto') }}
            </span>
            <span
              v-if="mensaje.con_adjuntos"
              class="shrink-0"
              :title="t('lista.conAdjuntos')"
              role="img"
              :aria-label="t('lista.conAdjuntos')">
              <ThemeIcon name="mail-attachment-symbolic" type="symbol" :size="16" />
            </span>
          </span>
          <!-- De qué cuenta es. Sólo cuando están todas juntas: con una sola a
               la vista, repetir su nombre en cada fila es ruido. -->
          <span v-if="cuentaDe(mensaje)" class="truncate text-body-xs font-normal text-tx-muted">
            {{ cuentaDe(mensaje) }}
          </span>
        </ListRow>
      </li>
    </ul>
  </Panel>
</template>
