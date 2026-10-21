<script lang="ts" setup>
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ActionButton, AlertMessage, FormGroup, PasswordField } from '@vasakgroup/vue-libvasak';
import { computed, onMounted, ref, watch } from 'vue';
import type { Cuenta } from '@/composables/use-correo';
import { interpolar } from '@/tools/interpolar';

/**
 * La identidad S/MIME de **una** cuenta: qué certificado tiene, y cómo
 * importarlo o quitarlo.
 *
 * Al servicio sólo llega la ruta del archivo: la lee el lado Rust y la pasa por
 * un descriptor sellado, así que ni el `.p12` ni la contraseña cruzan por acá
 * más tiempo del que dura el campo.
 */
const props = defineProps<{ cuenta: Cuenta }>();

interface SmimeState {
	present: boolean;
	email: string | null;
	not_after: string | null;
}

/** Los códigos cortos que devuelve el lado Rust; cualquier otro es genérico. */
const ERROR_CODES = [
	'WrongPassword',
	'TooBig',
	'AddressMismatch',
	'UnsupportedLegacy',
	'Malformed',
	'KeyringLocked',
] as const;

const { t, locale } = useI18n();

const state = ref<SmimeState | null>(null);
const path = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');

const fileName = computed(() => path.value.split(/[\\/]/).pop() ?? '');

/** Dicho como se lee: si no es una fecha, se muestra tal cual vino. */
const expires = computed(() => {
	const raw = state.value?.not_after;
	if (!raw) return '';
	const date = new Date(raw);
	return Number.isNaN(date.getTime())
		? raw
		: new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(date);
});

function messageFor(e: unknown): string {
	const code = String(e);
	return (ERROR_CODES as readonly string[]).includes(code)
		? t(`smime.error${code}`)
		: t('smime.errorFailed');
}

async function refresh() {
	try {
		state.value = await invoke<SmimeState>('estado_identidad_smime', {
			accountId: props.cuenta.account_id,
		});
	} catch (e) {
		state.value = null;
		error.value = messageFor(e);
	}
}

onMounted(refresh);
watch(
	() => props.cuenta.account_id,
	() => {
		path.value = '';
		password.value = '';
		error.value = '';
		refresh();
	}
);

async function pickFile() {
	error.value = '';
	try {
		const chosen = await openDialog({
			multiple: false,
			title: t('smime.elegirTitulo'),
			filters: [{ name: t('smime.filtro'), extensions: ['p12', 'pfx'] }],
		});
		if (typeof chosen === 'string') path.value = chosen;
	} catch (e) {
		error.value = String(e);
	}
}

async function importIdentity() {
	if (!path.value || !password.value || busy.value) return;
	busy.value = true;
	error.value = '';
	try {
		await invoke('importar_identidad_smime', {
			accountId: props.cuenta.account_id,
			ruta: path.value,
			contrasena: password.value,
		});
		// En el acto: la contraseña no tiene por qué seguir en memoria de la
		// ventana un instante más de lo que tardó el servicio en usarla.
		password.value = '';
		path.value = '';
		await refresh();
	} catch (e) {
		error.value = messageFor(e);
	} finally {
		busy.value = false;
	}
}

async function removeIdentity() {
	if (busy.value) return;
	busy.value = true;
	error.value = '';
	try {
		await invoke('quitar_identidad_smime', { accountId: props.cuenta.account_id });
		await refresh();
	} catch (e) {
		error.value = messageFor(e);
	} finally {
		busy.value = false;
	}
}
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
        @click="removeIdentity" />
    </template>

    <template v-else-if="state">
      <p class="text-body-xs text-tx-muted">{{ t('smime.ausente') }}</p>
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <ActionButton
          :label="t('smime.elegir')"
          variant="secondary"
          size="sm"
          icon="application-certificate-symbolic"
          icon-type="symbol"
          :disabled="busy"
          @click="pickFile" />
        <span v-if="fileName" class="min-w-0 flex-1 truncate text-body-xs" :title="path">{{ fileName }}</span>
      </div>
      <FormGroup v-slot="{ id }" :label="t('smime.contrasena')" custom-class="gap-0.5">
        <PasswordField
          :id="id"
          v-model="password"
          autocomplete="off"
          revealable
          :disabled="busy"
          @keydown.enter="importIdentity" />
      </FormGroup>
      <ActionButton
        :label="t('smime.importar')"
        variant="primary"
        size="sm"
        :disabled="busy || !path || !password"
        :loading="busy"
        class="self-start"
        @click="importIdentity" />
    </template>

    <AlertMessage v-if="error" tone="error" icon="dialog-error">
      <span class="break-words">{{ error }}</span>
    </AlertMessage>
  </div>
</template>
