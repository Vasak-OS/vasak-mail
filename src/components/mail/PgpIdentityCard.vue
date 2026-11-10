<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ActionButton, AlertMessage } from '@vasakgroup/vue-libvasak';
import { ref } from 'vue';
import IdentityImportForm from '@/components/mail/IdentityImportForm.vue';
import type { Cuenta } from '@/composables/use-correo';
import { useIdentity } from '@/composables/use-identity';

/**
 * La identidad OpenPGP de **una** cuenta: qué clave tiene, y cómo importarla o
 * quitarla. Al servicio sólo llega la ruta del archivo (la lee el lado Rust y
 * la pasa por descriptores sellados). La contraseña puede quedar vacía: una
 * clave sin proteger es válida.
 */
const props = defineProps<{ cuenta: Cuenta }>();

interface PgpState {
	present: boolean;
	fingerprint: string | null;
	uids: string[];
}

const { t } = useI18n();
const form = ref<InstanceType<typeof IdentityImportForm> | null>(null);
const { state, busy, error, run } = useIdentity<PgpState>('pgp', () => props.cuenta.account_id);
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2 rounded-corner-m border border-ui-line-weak bg-ui-surface/70 p-3">
    <h4 class="truncate font-semibold text-label-s">{{ cuenta.display_name }}</h4>

    <template v-if="state?.present">
      <p v-if="state.uids.length" class="min-w-0 break-words font-semibold text-body-s">{{ state.uids.join(', ') }}</p>
      <p v-if="state.fingerprint" class="min-w-0 break-all text-body-xs text-tx-muted">
        {{ t('pgp.huella') }}: <span class="font-mono">{{ state.fingerprint }}</span>
      </p>
      <ActionButton
        :label="t('pgp.quitar')"
        variant="danger"
        size="sm"
        icon="edit-delete-symbolic"
        icon-type="symbol"
        :disabled="busy"
        class="self-start"
        @click="run('quitar')" />
    </template>

    <template v-else-if="state">
      <p class="text-body-xs text-tx-muted">{{ t('pgp.ausente') }}</p>
      <IdentityImportForm
        ref="form"
        :key="cuenta.account_id"
        ns="pgp"
        :extensions="['asc', 'gpg', 'pgp', 'key']"
        :busy="busy"
        :require-password="false"
        @submit="async (ruta, contrasena) => (await run('importar', { ruta, contrasena })) && form?.reset()" />
    </template>

    <AlertMessage v-if="error" tone="error" icon="dialog-error">
      <span class="break-words">{{ error }}</span>
    </AlertMessage>
  </div>
</template>
