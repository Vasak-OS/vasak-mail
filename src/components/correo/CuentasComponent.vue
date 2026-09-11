<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed } from 'vue';
import SalidaComponent from '@/components/correo/SalidaComponent.vue';
import type { Casilla, Cuenta, Saliente } from '@/composables/use-correo';
import { TODAS } from '@/tools/bandeja';
import { nombreDeCasilla } from '@/tools/casillas';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';

const props = defineProps<{
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

function sinLeerDe(cuenta: Cuenta): string {
	return cuantosSinLeer(cuenta.sin_leer);
}

function cuantosSinLeer(cuantos: number): string {
	return interpolar(t(claveSegunCantidad('cuentas.sinLeer', cuantos)), cuantos);
}

/**
 * La entrada de «Todas» se muestra sólo con más de una cuenta.
 *
 * Con una sola es lo mismo con un clic de más, y encima confunde: parecen dos
 * bandejas distintas que siempre dicen lo mismo.
 */
const hayVarias = computed(() => props.cuentas.length > 1);

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
const ORDEN = ['entrada', 'enviados', 'borradores', 'archivo', 'spam', 'papelera', 'todo'];

const ordenadas = computed(() =>
	props.casillas
		.filter((c) => c.seleccionable)
		.slice()
		.sort((a, b) => {
			const ia = ORDEN.indexOf(a.uso);
			const ib = ORDEN.indexOf(b.uso);
			if (ia !== ib) {
				return (ia < 0 ? ORDEN.length : ia) - (ib < 0 ? ORDEN.length : ib);
			}
			return a.nombre.localeCompare(b.nombre);
		})
);

/** Ver `tools/casillas.ts`, que es donde está la regla y sus pruebas. */
function nombreDe(c: Casilla): string {
	return nombreDeCasilla(c, t);
}
</script>

<template>
  <aside class="flex w-52 shrink-0 flex-col gap-2 overflow-y-auto rounded-corner border border-ui-border bg-ui-surface/45 p-3">
    <!-- Sin ninguna cuenta, lo que hace falta es decir **qué hacer**. Una lista
         vacía sin explicación se lee como una aplicación rota. -->
    <div v-if="cuentas.length === 0" class="flex flex-col gap-1">
      <p class="font-medium text-sm">{{ t('cuentas.sinCuentasTitulo') }}</p>
      <p class="text-tx-muted text-xs">{{ t('cuentas.sinCuentasDescripcion') }}</p>
    </div>

    <template v-else>
      <button
        type="button"
        class="rounded-corner bg-primary px-2 py-1 text-sm text-tx-on-primary"
        @click="emit('escribir')">
        {{ t('redactar.nuevo') }}
      </button>

      <h2 class="font-medium text-tx-muted text-xs uppercase">{{ t('cuentas.titulo') }}</h2>
      <ul class="flex flex-col gap-1">
        <!-- Todo junto, arriba de las cuentas. Es lo que se mira casi siempre
             cuando hay más de una casilla, así que va donde cae el ojo. -->
        <li v-if="hayVarias">
          <button
            type="button"
            class="flex w-full flex-col items-start gap-0.5 rounded-corner px-2 py-1 text-left hover:bg-ui-surface"
            :class="{ 'bg-ui-surface': elegida === TODAS }"
            :aria-current="elegida === TODAS ? 'true' : undefined"
            @click="emit('elegir', TODAS)">
            <span class="w-full truncate font-medium text-sm">{{ t('cuentas.todas') }}</span>
            <span v-if="sinLeerEnTotal > 0" class="text-primary text-xs">
              {{ cuantosSinLeer(sinLeerEnTotal) }}
            </span>
          </button>
        </li>
        <li v-for="cuenta in cuentas" :key="cuenta.account_id">
          <button
            type="button"
            class="flex w-full flex-col items-start gap-0.5 rounded-corner px-2 py-1 text-left hover:bg-ui-surface"
            :class="{ 'bg-ui-surface': cuenta.account_id === elegida }"
            :aria-current="cuenta.account_id === elegida ? 'true' : undefined"
            @click="emit('elegir', cuenta.account_id)">
            <span class="w-full truncate text-sm" :title="cuenta.display_name">
              {{ cuenta.display_name }}
            </span>
            <!-- El error va **con la cuenta**, no en un cartel aparte: un cero
                 sin explicación se lee como «no tenés correo», que es lo
                 contrario de lo que pasa. -->
            <span v-if="cuenta.error" class="text-status-warning text-xs">
              {{ t('cuentas.noSePudo') }}
            </span>
            <span v-else-if="cuenta.sin_leer > 0" class="text-primary text-xs">
              {{ sinLeerDe(cuenta) }}
            </span>
          </button>
        </li>
      </ul>

      <!-- Las carpetas de la cuenta elegida. Si el servidor no contestó el
           LIST la lista queda vacía y no se dibuja nada: se ve la de entrada,
           que es lo que se veía antes de que existieran. -->
      <template v-if="ordenadas.length > 0">
        <h2 class="mt-2 font-medium text-tx-muted text-xs uppercase">
          {{ t('casillas.titulo') }}
        </h2>
        <ul class="flex flex-col gap-1">
          <li v-for="c in ordenadas" :key="c.ruta">
            <button
              type="button"
              class="w-full truncate rounded-corner px-2 py-1 text-left text-sm hover:bg-ui-surface"
              :class="{ 'bg-ui-surface': c.ruta === casilla }"
              :aria-current="c.ruta === casilla ? 'true' : undefined"
              :title="c.nombre"
              @click="emit('elegirCasilla', c.ruta)">
              {{ nombreDe(c) }}
            </button>
          </li>
        </ul>
      </template>
    </template>

    <!-- **Fuera del bloque de las cuentas.** La cola es del servicio y no de
         una cuenta: un mensaje trabado por una cuenta que después se borró
         quedaba invisible, y con él el único botón para descartarlo. Que la
         lista de cuentas esté vacía —o que no se haya podido leer— no puede
         esconder correo que alguien escribió. -->
    <SalidaComponent :salientes="salientes" @descartar="emit('descartar', $event)" />
  </aside>
</template>
