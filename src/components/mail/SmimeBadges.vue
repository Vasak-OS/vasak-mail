<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { Chip, Popover, PopoverContent, PopoverTrigger } from '@vasakgroup/vue-libvasak';
import { ref } from 'vue';
import { interpolar } from '@/tools/interpolar';
import type { SmimeView } from '@/tools/smime';

/**
 * Los distintivos de un mensaje firmado o cifrado.
 *
 * **Informativos, no de alarma ni de aprobación.** «Firmado, no verificado» no
 * es un error —la firma cerró— ni una garantía —nadie comprobó que una
 * autoridad respalde el certificado—, así que no lleva rojo ni verde ni escudo:
 * una pastilla neutra con el icono de certificado, y la explicación a un clic.
 * Qué decir y por qué: `tools/smime.ts`.
 *
 * El cifrado que no se pudo abrir **no** está acá: ése no es un dato al margen
 * sino que el mensaje no se puede leer, y lo dice un aviso donde iría el texto.
 */
defineProps<{ view: SmimeView }>();

const { t } = useI18n();

/** Si está abierta la explicación de la firma. */
const explaining = ref(false);
</script>

<template>
  <!-- `flex-wrap` y `min-w-0`: en una ventana angosta las dos pastillas pasan a
       renglones y la del firmante largo se corta con puntos suspensivos, sin
       desbordar. El contenedor es el del panel, no la pantalla. -->
  <div v-if="view.signer || view.encryption === 'opened'" class="flex min-w-0 flex-wrap gap-2 pt-1">
    <Chip
      v-if="view.encryption === 'opened'"
      :label="t('smime.cifrado')"
      icon="channel-secure-symbolic"
      :title="t('smime.cifradoPorQue')" />

    <Popover v-if="view.signer" v-model:open="explaining">
      <PopoverTrigger as-child>
        <Chip
          interactive
          :label="interpolar(t('smime.firmadoNoVerificado'), view.signer)"
          icon="application-certificate-symbolic"
          :title="interpolar(t('smime.firmadoNoVerificado'), view.signer)" />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" padding="sm" :label="t('smime.firmaTitulo')" class="w-72 max-w-full">
        <p class="font-semibold text-label-s">{{ t('smime.firmaTitulo') }}</p>
        <p class="mt-1 break-words text-body-s">{{ t('smime.firmaPorQue') }}</p>
      </PopoverContent>
    </Popover>
  </div>
</template>
