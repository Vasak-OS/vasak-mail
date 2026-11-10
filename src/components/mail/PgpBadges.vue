<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { Chip, Popover, PopoverContent, PopoverTrigger } from '@vasakgroup/vue-libvasak';
import { ref } from 'vue';
import type { PgpView } from '@/tools/pgp';

/**
 * Los distintivos de un mensaje firmado o cifrado con OpenPGP. Informativos,
 * como los de S/MIME: sin rojo ni verde ni escudo, y la explicación a un clic.
 * Qué decir y por qué: `tools/pgp.ts`. El cifrado que no se pudo abrir lo dice
 * un aviso donde iría el texto, no un distintivo.
 */
defineProps<{ view: PgpView }>();

const { t } = useI18n();
const explaining = ref(false);

const SIGNATURE_KEYS = {
	known: 'Conocida',
	unknown: 'Desconocida',
	unverifiable: 'NoVerificable',
} as const;
</script>

<template>
  <div v-if="view.signature || view.encryption === 'opened'" class="flex min-w-0 flex-wrap gap-2 pt-1">
    <Chip
      v-if="view.encryption === 'opened'"
      :label="t('pgp.cifrado')"
      icon="channel-secure-symbolic"
      :title="t('pgp.cifradoPorQue')" />

    <Popover v-if="view.signature" v-model:open="explaining">
      <PopoverTrigger as-child>
        <Chip
          interactive
          :label="t(`pgp.firma${SIGNATURE_KEYS[view.signature]}`)"
          icon="application-certificate-symbolic"
          :title="t(`pgp.firma${SIGNATURE_KEYS[view.signature]}`)" />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" padding="sm" :label="t('pgp.firmaTitulo')" class="w-72 max-w-full">
        <p class="font-semibold text-label-s">{{ t(`pgp.firma${SIGNATURE_KEYS[view.signature]}`) }}</p>
        <p class="mt-1 break-words text-body-s">{{ t(`pgp.firma${SIGNATURE_KEYS[view.signature]}PorQue`) }}</p>
        <p v-if="view.fingerprint" class="mt-2 break-all text-body-xs text-tx-muted">
          {{ t('pgp.huella') }}: <span class="font-mono">{{ view.fingerprint }}</span>
        </p>
      </PopoverContent>
    </Popover>
  </div>
</template>
