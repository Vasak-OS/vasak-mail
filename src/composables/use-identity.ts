import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { onMounted, ref, watch } from 'vue';

/** Los códigos cortos que devuelve el lado Rust; cualquier otro es genérico. */
const ERROR_CODES = new Set([
	'WrongPassword',
	'TooBig',
	'AddressMismatch',
	'UnsupportedLegacy',
	'Malformed',
	'KeyringLocked',
]);

/**
 * El estado de la identidad (S/MIME o OpenPGP) de una cuenta y las operaciones
 * sobre ella. `ns` es el esquema: elige los comandos `*_identidad_<ns>` y las
 * claves de texto `<ns>.error*`.
 */
export function useIdentity<S>(ns: 'smime' | 'pgp', accountId: () => string) {
	const { t } = useI18n();
	const state = ref<S | null>(null);
	const busy = ref(false);
	const error = ref('');

	function messageFor(e: unknown): string {
		const code = String(e);
		return ERROR_CODES.has(code) ? t(`${ns}.error${code}`) : t(`${ns}.errorFailed`);
	}

	async function refresh() {
		try {
			state.value = await invoke<S>(`estado_identidad_${ns}`, { accountId: accountId() });
		} catch (e) {
			state.value = null;
			error.value = messageFor(e);
		}
	}

	/** `importar` o `quitar`, con los argumentos extra del comando. */
	async function run(action: 'importar' | 'quitar', args: Record<string, string> = {}) {
		if (busy.value) return false;
		busy.value = true;
		error.value = '';
		try {
			await invoke(`${action}_identidad_${ns}`, { accountId: accountId(), ...args });
			await refresh();
			return true;
		} catch (e) {
			error.value = messageFor(e);
			return false;
		} finally {
			busy.value = false;
		}
	}

	onMounted(refresh);
	watch(accountId, () => {
		error.value = '';
		void refresh();
	});

	return { state, busy, error, run };
}
