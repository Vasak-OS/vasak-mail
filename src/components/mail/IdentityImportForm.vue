<script lang="ts" setup>
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ActionButton, FormGroup, PasswordField } from '@vasakgroup/vue-libvasak';
import { computed, ref } from 'vue';

/**
 * Elegir el archivo de una identidad (S/MIME u OpenPGP), escribir su
 * contraseña e importar. Los textos salen de `<ns>.*`. Sólo emite `submit`:
 * leer el archivo es del lado Rust, acá no pasa más que la ruta.
 */
const props = defineProps<{
	ns: 'smime' | 'pgp';
	extensions: string[];
	busy: boolean;
	/** Si hace falta contraseña (una clave OpenPGP puede no tenerla). */
	requirePassword: boolean;
}>();
const emit = defineEmits<{ submit: [path: string, password: string] }>();

const { t } = useI18n();
const path = ref('');
const password = ref('');
const pickError = ref('');
const fileName = computed(() => path.value.split(/[\\/]/).pop() ?? '');
const ready = computed(() => !!path.value && (!props.requirePassword || !!password.value));

async function pickFile() {
	pickError.value = '';
	try {
		const chosen = await openDialog({
			multiple: false,
			title: t(`${props.ns}.elegirTitulo`),
			filters: [{ name: t(`${props.ns}.filtro`), extensions: props.extensions }],
		});
		if (typeof chosen === 'string') path.value = chosen;
	} catch (e) {
		pickError.value = String(e);
	}
}

/** En el acto de importar bien: la contraseña no sigue en memoria de la ventana. */
defineExpose({
	reset() {
		path.value = '';
		password.value = '';
	},
});

function submit() {
	if (!ready.value || props.busy) return;
	emit('submit', path.value, password.value);
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2">
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <ActionButton
        :label="t(`${ns}.elegir`)"
        variant="secondary"
        size="sm"
        icon="application-certificate-symbolic"
        icon-type="symbol"
        :disabled="busy"
        @click="pickFile" />
      <span v-if="fileName" class="min-w-0 flex-1 truncate text-body-xs" :title="path">{{ fileName }}</span>
    </div>
    <p v-if="pickError" class="break-words text-body-xs">{{ pickError }}</p>
    <FormGroup v-slot="{ id }" :label="t(`${ns}.contrasena`)" custom-class="gap-0.5">
      <PasswordField :id="id" v-model="password" autocomplete="off" revealable :disabled="busy" @keydown.enter="submit" />
    </FormGroup>
    <ActionButton
      :label="t(`${ns}.importar`)"
      variant="primary"
      size="sm"
      :disabled="busy || !ready"
      :loading="busy"
      class="self-start"
      @click="submit" />
  </div>
</template>
