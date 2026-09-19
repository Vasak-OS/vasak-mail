<script lang="ts" setup>
/**
 * La ventana del correo.
 *
 * No dibuja nada propio: el borde, la esquina, el fondo, la barra y los tres
 * botones salen de `WindowFrame`, que es el mismo de todas las ventanas del
 * escritorio. Estaba copiado acá, y ya había derivado de las copias vecinas.
 *
 * De arriba viene además algo que esta copia no tenía: la barra puede ir
 * arriba, abajo, a la izquierda o a la derecha según `window.barPosition` en
 * `~/.config/vasak/vasak.conf`.
 *
 * `centro` es dónde se está parado —la carpeta y la cuenta—, centrado respecto
 * de la ventana entera y no de lo que sobra entre el icono y los controles:
 * entre columnas se corre lo suficiente como para que se note, porque los tres
 * botones ocupan más que el icono.
 *
 * `relative` en el marco porque la ventana de redacción va encima y no en una
 * ventana aparte: escribir un correo es algo que se hace y se termina.
 */
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { WindowFrame } from '@vasakgroup/vue-libvasak';

const { t } = useI18n();
</script>

<template>
  <WindowFrame
    class="relative"
    :minimize-label="t('ventana.minimizar')"
    :maximize-label="t('ventana.maximizar')"
    :close-label="t('ventana.cerrar')">
    <template v-if="$slots.identidad" #identidad><slot name="identidad" /></template>
    <template v-if="$slots.barra" #barra><slot name="barra" /></template>
    <template v-if="$slots.barraCentro" #centro><slot name="barraCentro" /></template>
    <template v-if="$slots.acciones" #acciones><slot name="acciones" /></template>

    <div class="flex min-h-0 min-w-0 flex-1">
      <slot />
    </div>
  </WindowFrame>
</template>
