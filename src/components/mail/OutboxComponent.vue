<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ActionButton, ListRow, SectionHeading } from '@vasakgroup/vue-libvasak';
import type { Saliente } from '@/composables/use-correo';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';

defineProps<{ salientes: Saliente[] }>();
const emit = defineEmits<{ descartar: [id: string] }>();

const { t } = useI18n();

function attemptsOf(saliente: Saliente): string {
	return interpolar(
		t(claveSegunCantidad('salida.reintentando', saliente.intentos)),
		saliente.intentos
	);
}
</script>

<template>
  <section v-if="salientes.length > 0" class="flex flex-col gap-2">
    <!-- Lo que no salió va **a la vista**, no escondido en una carpeta que hay
         que ir a mirar. Un mensaje que la persona cree mandado y quedó trabado
         es de las peores cosas que puede hacer un cliente de correo: la
         conversación del otro lado nunca llega y nadie se entera hasta que es
         tarde. -->
    <SectionHeading as="h2" :title="t('salida.titulo')" class="px-1" />
    <ul class="flex flex-col gap-1">
      <li v-for="saliente in salientes" :key="saliente.id">
        <ListRow class="bg-ui-surface/70 px-2 py-1">
          <span class="truncate text-label-m" :title="saliente.borrador.asunto">
            {{ saliente.borrador.asunto || t('salida.sinAsunto') }}
          </span>
          <span class="truncate text-body-xs text-tx-muted">{{ saliente.borrador.para.join(', ') }}</span>

          <!-- Trabado se dice con su motivo. «No se pudo enviar» a secas no le
               dice a nadie si la dirección estaba mal escrita o si el servidor
               estaba caído, que son dos cosas con arreglos distintos. -->
          <template v-if="saliente.estado === 'trabado'">
            <span class="text-body-xs text-status-error">{{ t('salida.trabado') }}</span>
            <span v-if="saliente.ultimo_error" class="break-words text-body-xs text-tx-muted">
              {{ saliente.ultimo_error }}
            </span>
            <ActionButton
              :label="t('salida.descartar')"
              variant="ghost"
              size="sm"
              class="-ml-2 self-start"
              @click="emit('descartar', saliente.id)" />
          </template>
          <!-- Esperar su hora y estar saliendo son cosas distintas, y se ven
               igual si no se dicen: un mensaje programado para el lunes parecería
               uno que no se puede mandar desde hace tres días. -->
          <template v-else-if="saliente.esperando_su_hora">
            <span class="text-body-xs text-tx-muted">{{ t('salida.esperandoSuHora') }}</span>
            <ActionButton
              :label="t('salida.descartar')"
              variant="ghost"
              size="sm"
              class="-ml-2 self-start"
              @click="emit('descartar', saliente.id)" />
          </template>
          <span v-else-if="saliente.intentos > 0" class="text-body-xs text-status-warning">
            {{ attemptsOf(saliente) }}
          </span>
        </ListRow>
      </li>
    </ul>
  </section>
</template>
