<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import SalidaComponent from '@/components/correo/SalidaComponent.vue';
import type { Cuenta, Saliente } from '@/composables/use-correo';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';

defineProps<{ cuentas: Cuenta[]; elegida: string; salientes: Saliente[] }>();
const emit = defineEmits<{
	elegir: [accountId: string];
	escribir: [];
	descartar: [id: string];
}>();

const { t } = useI18n();

function sinLeerDe(cuenta: Cuenta): string {
	return interpolar(t(claveSegunCantidad('cuentas.sinLeer', cuenta.sin_leer)), cuenta.sin_leer);
}
</script>

<template>
  <aside class="flex w-52 shrink-0 flex-col gap-2 overflow-y-auto border-ui-border border-r p-3">
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
    </template>

    <!-- **Fuera del bloque de las cuentas.** La cola es del servicio y no de
         una cuenta: un mensaje trabado por una cuenta que después se borró
         quedaba invisible, y con él el único botón para descartarlo. Que la
         lista de cuentas esté vacía —o que no se haya podido leer— no puede
         esconder correo que alguien escribió. -->
    <SalidaComponent :salientes="salientes" @descartar="emit('descartar', $event)" />
  </aside>
</template>
