<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ActionButton, AlertMessage } from '@vasakgroup/vue-libvasak';
import { computed, ref } from 'vue';
import IdentityImportForm from '@/components/mail/IdentityImportForm.vue';
import type { Cuenta } from '@/composables/use-correo';
import { useIdentity } from '@/composables/use-identity';
import { interpolar } from '@/tools/interpolar';

/**
 * La identidad S/MIME de **una** cuenta: qué certificado tiene, y cómo
 * importarlo o quitarlo. Al servicio sólo llega la ruta del archivo: la lee el
 * lado Rust y la pasa por un descriptor sellado, así que ni el `.p12` ni la
 * contraseña cruzan por acá más tiempo del que dura el campo.
 */
const props = defineProps<{ cuenta: Cuenta }>();

interface SmimeState {
	present: boolean;
	email: string | null;
	not_after: string | null;
}

const { t, locale } = useI18n();
const form = ref<InstanceType<typeof IdentityImportForm> | null>(null);
const { state, busy, error, run } = useIdentity<SmimeState>('smime', () => props.cuenta.account_id);

/** Dicho como se lee: si no es una fecha, se muestra tal cual vino. */
const expires = computed(() => {
	const raw = state.value?.not_after;
	if (!raw) return '';
	const date = new Date(raw);
	return Number.isNaN(date.getTime())
		? raw
		: new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(date);
});
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2 rounded-corner-m border border-ui-line-weak bg-ui-surface/70 p-3">
    <h4 class="truncate font-semibold text-label-s">{{ cuenta.display_name }}</h4>

    <template v-if="state?.present">
      <p class="min-w-0 break-words text-body-s">
        <span class="font-semibold">{{ state.email }}</span>
        <span v-if="expires" class="text-tx-muted"> · {{ interpolar(t('smime.vence'), expires) }}</span>
      </p>
      <ActionButton
        :label="t('smime.quitar')"
        variant="danger"
        size="sm"
        icon="edit-delete-symbolic"
        icon-type="symbol"
        :disabled="busy"
        class="self-start"
        @click="run('quitar')" />
    </template>

    <template v-else-if="state">
      <p class="text-body-xs text-tx-muted">{{ t('smime.ausente') }}</p>
      <IdentityImportForm
        ref="form"
        :key="cuenta.account_id"
        ns="smime"
        :extensions="['p12', 'pfx']"
        :busy="busy"
        :require-password="true"
        @submit="async (ruta, contrasena) => (await run('importar', { ruta, contrasena })) && form?.reset()" />
    </template>

    <AlertMessage v-if="error" tone="error" icon="dialog-error">
      <span class="break-words">{{ error }}</span>
    </AlertMessage>
  </div>
</template>
