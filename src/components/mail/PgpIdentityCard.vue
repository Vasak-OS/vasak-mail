<script lang="ts" setup>
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ActionButton, AlertMessage, FormGroup, PasswordField } from '@vasakgroup/vue-libvasak';
import { computed, onMounted, ref, watch } from 'vue';
import type { Cuenta } from '@/composables/use-correo';

/**
 * La identidad OpenPGP de **una** cuenta: qué clave tiene, y cómo importarla o
 * quitarla. Calca `SmimeIdentityCard`: al servicio sólo llega la ruta del
 * archivo, que lee el lado Rust y pasa por descriptores sellados. La contraseña
 * puede quedar vacía: una clave sin proteger es válida.
 */
const props = defineProps<{ cuenta: Cuenta }>();

interface PgpState {
	present: boolean;
	fingerprint: string | null;
	uids: string[];
}

/** Los códigos cortos que devuelve el lado Rust; cualquier otro es genérico. */
const ERROR_CODES = [
	'WrongPassword',
	'TooBig',
	'AddressMismatch',
	'Malformed',
	'KeyringLocked',
] as const;

const { t } = useI18n();

const state = ref<PgpState | null>(null);
const path = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');

const fileName = computed(() => path.value.split(/[\\/]/).pop() ?? '');

function messageFor(e: unknown): string {
	const code = String(e);
	return (ERROR_CODES as readonly string[]).includes(code)
		? t(`pgp.error${code}`)
		: t('pgp.errorFailed');
}

async function refresh() {
	try {
		state.value = await invoke<PgpState>('estado_identidad_pgp', {
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
			title: t('pgp.elegirTitulo'),
			filters: [{ name: t('pgp.filtro'), extensions: ['asc', 'gpg', 'pgp', 'key'] }],
		});
		if (typeof chosen === 'string') path.value = chosen;
	} catch (e) {
		error.value = String(e);
	}
}

async function importIdentity() {
	if (!path.value || busy.value) return;
	busy.value = true;
	error.value = '';
	try {
		await invoke('importar_identidad_pgp', {
			accountId: props.cuenta.account_id,
			ruta: path.value,
			contrasena: password.value,
		});
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
		await invoke('quitar_identidad_pgp', { accountId: props.cuenta.account_id });
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
      <p v-if="state.uids.length" class="min-w-0 break-words text-body-s font-semibold">{{ state.uids.join(', ') }}</p>
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
        @click="removeIdentity" />
    </template>

    <template v-else-if="state">
      <p class="text-body-xs text-tx-muted">{{ t('pgp.ausente') }}</p>
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <ActionButton
          :label="t('pgp.elegir')"
          variant="secondary"
          size="sm"
          icon="application-certificate-symbolic"
          icon-type="symbol"
          :disabled="busy"
          @click="pickFile" />
        <span v-if="fileName" class="min-w-0 flex-1 truncate text-body-xs" :title="path">{{ fileName }}</span>
      </div>
      <FormGroup v-slot="{ id }" :label="t('pgp.contrasena')" custom-class="gap-0.5">
        <PasswordField
          :id="id"
          v-model="password"
          autocomplete="off"
          revealable
          :disabled="busy"
          @keydown.enter="importIdentity" />
      </FormGroup>
      <ActionButton
        :label="t('pgp.importar')"
        variant="primary"
        size="sm"
        :disabled="busy || !path"
        :loading="busy"
        class="self-start"
        @click="importIdentity" />
    </template>

    <AlertMessage v-if="error" tone="error" icon="dialog-error">
      <span class="break-words">{{ error }}</span>
    </AlertMessage>
  </div>
</template>
