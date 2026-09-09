<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed } from 'vue';
import type { Resumen } from '@/composables/use-correo';
import { cuando } from '@/tools/fecha';

const props = defineProps<{
	mensajes: Resumen[];
	abierto: Resumen | null;
	cargando: boolean;
}>();
const emit = defineEmits<{ abrir: [mensaje: Resumen] }>();

const { t, locale } = useI18n();

/** La hora si llegó hoy, el día si no. Ver `src/tools/fecha.ts`. */
function cuandoLlego(fecha: string): string {
	return cuando(fecha, locale.value, t('lista.sinFecha'));
}

const hayAlgo = computed(() => props.mensajes.length > 0);
</script>

<template>
  <div class="flex w-80 shrink-0 flex-col overflow-y-auto border-ui-border border-r">
    <p v-if="cargando && !hayAlgo" class="p-3 text-tx-muted text-sm" role="status">
      {{ t('lista.cargando') }}
    </p>
    <p v-else-if="!hayAlgo" class="p-3 text-tx-muted text-sm">{{ t('lista.vacia') }}</p>

    <ul v-else class="flex flex-col">
      <li v-for="mensaje in mensajes" :key="mensaje.uid">
        <button
          type="button"
          class="flex w-full flex-col gap-0.5 border-ui-border border-b px-3 py-2 text-left hover:bg-ui-surface/60"
          :class="{ 'bg-ui-surface': mensaje.uid === abierto?.uid }"
          :aria-current="mensaje.uid === abierto?.uid ? 'true' : undefined"
          @click="emit('abrir', mensaje)">
          <div class="flex w-full items-baseline gap-2">
            <!-- Sin leer se marca con el punto **y** con la negrita: el color
                 solo no se ve si no se distinguen los colores (WCAG 1.4.1), y
                 esto es lo que separa lo que falta leer de lo que no. -->
            <span
              v-if="mensaje.sin_leer"
              class="h-2 w-2 shrink-0 rounded-full bg-primary"
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
              :aria-label="t('lista.conAdjuntos')">📎</span>
          </div>
        </button>
      </li>
    </ul>
  </div>
</template>
