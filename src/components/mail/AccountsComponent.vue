<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	Badge,
	EmptyState,
	ListRow,
	Panel,
	SectionHeading,
} from '@vasakgroup/vue-libvasak';
import { computed } from 'vue';
import OutboxComponent from '@/components/mail/OutboxComponent.vue';
import type { Casilla, Cuenta, Saliente } from '@/composables/use-correo';
import { TODAS } from '@/tools/bandeja';
import { nombreDeCasilla } from '@/tools/casillas';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';
import { type Pane, paneVisibility } from '@/tools/panes';

const props = defineProps<{
	/** Cuál de los tres paneles se ve. Sólo importa en una ventana angosta. */
	panel: Pane;
	cuentas: Cuenta[];
	elegida: string;
	casillas: Casilla[];
	casilla: string;
	salientes: Saliente[];
	/** Cuánto correo sin leer hay entre todas, para la entrada de arriba. */
	sinLeerEnTotal: number;
}>();
const emit = defineEmits<{
	elegir: [accountId: string];
	elegirCasilla: [ruta: string];
	escribir: [];
	descartar: [id: string];
}>();

const { t } = useI18n();

function unreadOf(cuenta: Cuenta): string {
	return unreadLabel(cuenta.sin_leer);
}

function unreadLabel(count: number): string {
	return interpolar(t(claveSegunCantidad('cuentas.sinLeer', count)), count);
}

/**
 * La entrada de «Todas» se muestra sólo con más de una cuenta.
 *
 * Con una sola es lo mismo con un clic de más, y encima confunde: parecen dos
 * bandejas distintas que siempre dicen lo mismo.
 */
const severalAccounts = computed(() => props.cuentas.length > 1);

/**
 * Las carpetas que se pueden abrir, con las conocidas primero.
 *
 * El orden no es el del servidor a propósito: entrada, enviados, borradores,
 * archivo, spam y papelera arriba, y después lo que la persona haya creado, por
 * nombre. El del servidor suele ser alfabético y deja «Enviados» entre dos
 * carpetas cualquiera.
 *
 * Las `\Noselect` se sacan: existen sólo como rama de la jerarquía, y
 * ofrecerlas para abrir es ofrecer un error.
 */
const ORDER = ['entrada', 'enviados', 'borradores', 'archivo', 'spam', 'papelera', 'todo'];

const sortedFolders = computed(() =>
	props.casillas
		.filter((c) => c.seleccionable)
		.slice()
		.sort((a, b) => {
			const ia = ORDER.indexOf(a.uso);
			const ib = ORDER.indexOf(b.uso);
			if (ia !== ib) {
				return (ia < 0 ? ORDER.length : ia) - (ib < 0 ? ORDER.length : ib);
			}
			return a.nombre.localeCompare(b.nombre);
		})
);

/** Ver `tools/casillas.ts`, que es donde está la regla y sus pruebas. */
function folderName(c: Casilla): string {
	return nombreDeCasilla(c, t);
}
</script>

<template>
  <Panel
    as="aside"
    padding="sm"
    scroll
    class="w-full shrink-0 gap-2 @three-panes/panes:w-52"
    :class="paneVisibility('folders', panel)">
    <!-- Las carpetas van al lado cuando entran los tres paneles, y solas —con todo
         el ancho— cuando se las pide en una ventana angosta (`panel`). Hasta la
         0.18 este panel no miraba `panel`: en angosto quedaba siempre a la vista
         y la lista se salía por la derecha. -->
    <!-- Sin ninguna cuenta, lo que hace falta es decir **qué hacer**. Una lista
         vacía sin explicación se lee como una aplicación rota. -->
    <EmptyState
      v-if="cuentas.length === 0"
      size="sm"
      icon=""
      :title="t('cuentas.sinCuentasTitulo')"
      :note="t('cuentas.sinCuentasDescripcion')" />

    <template v-else>
      <ActionButton :label="t('redactar.nuevo')" full-width @click="emit('escribir')" />

      <SectionHeading as="h2" :title="t('cuentas.titulo')" class="px-1 pt-1" />
      <!-- Cada cuenta es una fila con dos líneas: el nombre y, debajo, lo que
           falta leer o que no se pudo leer. Por la segunda línea no sirve
           `SideButton`. -->
      <ul class="flex flex-col gap-0.5">
        <!-- Todo junto, arriba de las cuentas. Es lo que se mira casi siempre
             cuando hay más de una casilla, así que va donde cae el ojo. -->
        <li v-if="severalAccounts">
          <ListRow
            role="button"
            :selected="elegida === TODAS"
            class="px-2 py-1"
            @click="emit('elegir', TODAS)">
            <span class="truncate text-label-m">{{ t('cuentas.todas') }}</span>
            <Badge
              v-if="sinLeerEnTotal > 0"
              tone="accent"
              class="mt-0.5 self-start"
              :label="unreadLabel(sinLeerEnTotal)" />
          </ListRow>
        </li>
        <li v-for="cuenta in cuentas" :key="cuenta.account_id">
          <ListRow
            role="button"
            :selected="cuenta.account_id === elegida"
            class="px-2 py-1"
            @click="emit('elegir', cuenta.account_id)">
            <span class="truncate text-label-m font-normal" :title="cuenta.display_name">
              {{ cuenta.display_name }}
            </span>
            <!-- El error va **con la cuenta**, no en un cartel aparte: un cero
                 sin explicación se lee como «no tenés correo», que es lo
                 contrario de lo que pasa. -->
            <Badge
              v-if="cuenta.error"
              tone="warning"
              class="mt-0.5 self-start"
              :label="t('cuentas.noSePudo')" />
            <Badge
              v-else-if="cuenta.sin_leer > 0"
              tone="accent"
              class="mt-0.5 self-start"
              :label="unreadOf(cuenta)" />
          </ListRow>
        </li>
      </ul>

      <!-- Las carpetas de la cuenta elegida. Si el servidor no contestó el
           LIST la lista queda vacía y no se dibuja nada: se ve la de entrada,
           que es lo que se veía antes de que existieran. -->
      <template v-if="sortedFolders.length > 0">
        <SectionHeading as="h2" :title="t('casillas.titulo')" class="mt-2 px-1" />
        <ul class="flex flex-col gap-0.5">
          <li v-for="c in sortedFolders" :key="c.ruta">
            <ListRow
              role="button"
              :selected="c.ruta === casilla"
              class="px-2 py-1"
              @click="emit('elegirCasilla', c.ruta)">
              <span class="truncate text-label-m font-normal" :title="c.nombre">{{ folderName(c) }}</span>
            </ListRow>
          </li>
        </ul>
      </template>
    </template>

    <!-- **Fuera del bloque de las cuentas.** La cola es del servicio y no de
         una cuenta: un mensaje trabado por una cuenta que después se borró
         quedaba invisible, y con él el único botón para descartarlo. Que la
         lista de cuentas esté vacía —o que no se haya podido leer— no puede
         esconder correo que alguien escribió. -->
    <OutboxComponent :salientes="salientes" @descartar="emit('descartar', $event)" />
  </Panel>
</template>
