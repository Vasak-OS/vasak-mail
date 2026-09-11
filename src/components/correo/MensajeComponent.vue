<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed } from 'vue';
import type { Abierto, Resumen } from '@/composables/use-correo';

const props = defineProps<{
	abierto: Resumen | null;
	cuerpo: Abierto | null;
	cargando: boolean;
}>();
// El mensaje entero y no su `uid`: quien lo reciba necesita saber de qué cuenta
// y de qué carpeta salió, porque en la bandeja combinada el número solo no
// alcanza para encontrarlo. Ver `tools/bandeja.ts`.
const emit = defineEmits<{ marcarLeido: [mensaje: Resumen]; responder: [] }>();

const { t, locale } = useI18n();

const cuando = computed(() => {
	const fecha = props.abierto?.fecha;
	if (!fecha) {
		return t('lista.sinFecha');
	}
	const momento = new Date(fecha);
	if (Number.isNaN(momento.getTime())) {
		return t('lista.sinFecha');
	}
	return new Intl.DateTimeFormat(locale.value, {
		dateStyle: 'full',
		timeStyle: 'short',
	}).format(momento);
});
</script>

<template>
  <section class="flex min-w-0 flex-1 flex-col overflow-y-auto rounded-corner border border-ui-border bg-ui-surface/45">
    <p v-if="!abierto" class="p-4 text-tx-muted text-sm">{{ t('mensaje.elegiUno') }}</p>

    <template v-else>
      <header class="flex flex-col gap-1 border-ui-border border-b p-4">
        <h1 class="font-title text-lg">{{ abierto.asunto || t('lista.sinAsunto') }}</h1>
        <p class="text-sm">
          <span class="text-tx-muted">{{ t('mensaje.de') }}: </span>
          <span>{{ abierto.de }}</span>
          <!-- La dirección **siempre**, al lado del nombre y no en su lugar.
               Ponerse de nombre «soporte@banco.com» y escribir desde otra
               dirección es el fraude más común que hay, y mostrar sólo el
               nombre es exactamente lo que lo hace funcionar. Va en un tono
               distinto para que se lea como lo que es: el dato, no la firma. -->
          <span class="text-tx-muted">&lt;{{ abierto.direccion }}&gt;</span>
        </p>
        <p class="text-tx-muted text-xs">
          <span>{{ t('mensaje.cuando') }}: </span>{{ cuando }}
        </p>

        <div class="flex gap-2 pt-1">
          <!-- Responder sólo cuando el mensaje ya está traído: la respuesta
               necesita el identificador del original y la cita del texto, y las
               dos cosas vienen con el cuerpo. Un botón que a veces arma una
               respuesta a medias es peor que un botón que aparece un segundo
               después. -->
          <button
            v-if="cuerpo"
            type="button"
            class="rounded-corner bg-primary px-2 py-0.5 text-sm text-tx-on-primary"
            @click="emit('responder')">
            {{ t('redactar.responder') }}
          </button>
          <button
            v-if="abierto.sin_leer"
            type="button"
            class="rounded-corner border border-ui-border-strong px-2 py-0.5 text-sm hover:bg-ui-surface"
            @click="emit('marcarLeido', abierto)">
            {{ t('mensaje.marcarLeido') }}
          </button>
        </div>
      </header>

      <p v-if="cargando" class="p-4 text-tx-muted text-sm" role="status">
        {{ t('lista.cargando') }}
      </p>

      <template v-else-if="cuerpo">
        <!-- Los dos avisos existen porque callarlos hace perder cosas: un texto
             que termina a la mitad parece un mensaje roto, y un adjunto que no
             se nombra es un archivo que la persona no sabe que recibió. -->
        <!-- Con nombre y tipo, que es lo que faltaba. Todavía no se pueden
             abrir, y el aviso lo dice: enterarse de que vino un archivo y no
             saber cuál sigue siendo perder el archivo, sólo que más despacio.

             El nombre viene saneado del sincronizador. Se muestra en un `<li>`
             y no en un enlace ni en nada que lo interprete: lo eligió quien
             mandó el mensaje. -->
        <div
          v-if="cuerpo.adjuntos.length > 0"
          class="mx-4 mt-3 rounded-corner bg-ui-surface/60 p-2 text-xs">
          <p>📎 {{ t('mensaje.adjuntos') }}</p>
          <ul class="mt-1 flex flex-col gap-0.5">
            <li v-for="a in cuerpo.adjuntos" :key="a.parte" class="truncate" :title="a.tipo">
              {{ a.nombre }}
            </li>
          </ul>
        </div>

        <!-- `white-space: pre-wrap` y no HTML.
             El texto lo escribió cualquiera que sepa la dirección de la persona:
             se muestra, no se interpreta. Vue escapa el contenido de una
             interpolación, así que nada de acá se convierte en marcado ni carga
             una imagen remota — que es lo que le confirmaría al remitente que se
             leyó, y desde qué dirección IP. -->
        <pre
          class="min-w-0 flex-1 whitespace-pre-wrap break-words p-4 font-sans text-sm">{{ cuerpo.texto }}</pre>

        <p v-if="cuerpo.recortado" class="mx-4 mb-3 rounded-corner bg-ui-surface/60 p-2 text-xs">
          {{ t('mensaje.recortado') }}
        </p>
        <p class="px-4 pb-4 text-tx-muted text-xs">{{ t('mensaje.soloTexto') }}</p>
      </template>
    </template>
  </section>
</template>
