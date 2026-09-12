<script lang="ts" setup>
/**
 * Donde se cambian las preferencias.
 *
 * Al pie del panel, detrás de un botón que las despliega: son tres cosas que se
 * tocan una vez y no se vuelven a mirar, y arriba competirían con las cuentas y
 * las carpetas, que es lo que se viene a usar.
 */
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ref } from 'vue';
import { usePreferencias } from '@/composables/use-preferencias';
import { interpolar } from '@/tools/interpolar';
import { MAX_SEGUNDOS_PARA_DESHACER } from '@/tools/preferencias';

const { t } = useI18n();
const { preferencias, guardando, cambiar } = usePreferencias();

const abierto = ref(false);

/**
 * Las opciones del cartel, de la que menos muestra a la que más.
 *
 * En ese orden y no alfabético: lo primero que se ve es lo más conservador, que
 * es además lo que está puesto. Quien baje por la lista va sabiendo que cada
 * paso muestra un poco más.
 */
const DETALLES = ['cantidad', 'remitente', 'asunto'] as const;
</script>

<template>
  <section class="flex flex-col gap-2">
    <button
      type="button"
      class="flex items-center justify-between rounded-corner px-2 py-1 text-left font-medium text-tx-muted text-xs uppercase hover:bg-ui-surface"
      :aria-expanded="abierto"
      @click="abierto = !abierto">
      {{ t('preferencias.titulo') }}
      <span aria-hidden="true">{{ abierto ? '−' : '+' }}</span>
    </button>

    <div v-if="abierto" class="flex flex-col gap-3 px-1 pb-1">
      <!-- Qué dice el cartel de correo nuevo.
           Esta la lee el servicio, que es el que muestra el cartel con la
           ventana cerrada: por eso las preferencias viven en un archivo y no
           adentro del navegador. Ver `tools/preferencias.ts`. -->
      <fieldset class="flex flex-col gap-1">
        <legend class="text-tx-muted text-xs">{{ t('preferencias.detalleDelAviso') }}</legend>
        <label
          v-for="detalle in DETALLES"
          :key="detalle"
          class="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="detalle-del-aviso"
            :value="detalle"
            :checked="preferencias.detalleDelAviso === detalle"
            :disabled="guardando"
            @change="cambiar({ detalleDelAviso: detalle })" />
          <span>{{ t(`preferencias.detalle.${detalle}`) }}</span>
        </label>
        <!-- Lo que se gana y lo que se pierde, dicho acá y no en la
             documentación: la pantalla puede estar bloqueada, compartida o
             proyectada, y quien elige esto tiene que poder tenerlo en cuenta. -->
        <p class="text-tx-muted text-xs">{{ t('preferencias.detalleAviso') }}</p>
      </fieldset>

      <!-- Cuánto dura la ventana para arrepentirse. Esta es sólo de la ventana:
           el servicio recibe una hora ya calculada. -->
      <label class="flex flex-col gap-1">
        <span class="text-tx-muted text-xs">{{ t('preferencias.segundosParaDeshacer') }}</span>
        <span class="flex items-center gap-2">
          <input
            type="range"
            min="0"
            :max="MAX_SEGUNDOS_PARA_DESHACER"
            step="5"
            class="min-w-0 flex-1"
            :value="preferencias.segundosParaDeshacer"
            :disabled="guardando"
            @change="
              cambiar({ segundosParaDeshacer: Number(($event.target as HTMLInputElement).value) })
            " />
          <span class="w-16 shrink-0 text-right text-sm tabular-nums">
            {{
              preferencias.segundosParaDeshacer === 0
                ? t('preferencias.sinEspera')
                : interpolar(t('preferencias.segundos'), preferencias.segundosParaDeshacer)
            }}
          </span>
        </span>
      </label>
    </div>
  </section>
</template>
