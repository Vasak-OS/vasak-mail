<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import type { Saliente } from '@/composables/use-correo';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';

defineProps<{ salientes: Saliente[] }>();
const emit = defineEmits<{ descartar: [id: string] }>();

const { t } = useI18n();

function intentosDe(saliente: Saliente): string {
	return interpolar(
		t(claveSegunCantidad('salida.reintentando', saliente.intentos)),
		saliente.intentos
	);
}
</script>

<template>
  <!-- Lo que no salió va **a la vista**, no escondido en una carpeta que hay
       que ir a mirar. Un mensaje que la persona cree mandado y quedó trabado es
       de las peores cosas que puede hacer un cliente de correo: la conversación
       del otro lado nunca llega y nadie se entera hasta que es tarde. -->
  <section v-if="salientes.length > 0" class="flex flex-col gap-2">
    <h2 class="font-medium text-tx-muted text-xs uppercase">{{ t('salida.titulo') }}</h2>
    <ul class="flex flex-col gap-1">
      <li
        v-for="saliente in salientes"
        :key="saliente.id"
        class="flex flex-col gap-0.5 rounded-corner-sm bg-ui-surface/40 px-2 py-1">
        <span class="truncate text-sm" :title="saliente.borrador.asunto">
          {{ saliente.borrador.asunto || t('salida.sinAsunto') }}
        </span>
        <span class="truncate text-tx-muted text-xs">{{ saliente.borrador.para.join(', ') }}</span>

        <!-- Trabado se dice con su motivo. «No se pudo enviar» a secas no le
             dice a nadie si la dirección estaba mal escrita o si el servidor
             estaba caído, que son dos cosas con arreglos distintos. -->
        <template v-if="saliente.estado === 'trabado'">
          <span class="text-status-error text-xs">{{ t('salida.trabado') }}</span>
          <span v-if="saliente.ultimo_error" class="text-tx-muted text-xs">
            {{ saliente.ultimo_error }}
          </span>
          <button
            type="button"
            class="self-start rounded-corner px-1 text-tx-muted text-xs hover:bg-ui-surface"
            @click="emit('descartar', saliente.id)">
            {{ t('salida.descartar') }}
          </button>
        </template>
        <span v-else-if="saliente.intentos > 0" class="text-status-warning text-xs">
          {{ intentosDe(saliente) }}
        </span>
      </li>
    </ul>
  </section>
</template>
