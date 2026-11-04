<script lang="ts" setup>
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	AlertMessage,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	EmptyState,
	ListRow,
	SectionHeading,
	SelectField,
	SwitchRow,
} from '@vasakgroup/vue-libvasak';
import { onBeforeUnmount, ref, watch } from 'vue';
import RuleEditorComponent from '@/components/mail/RuleEditorComponent.vue';
import type { Cuenta } from '@/composables/use-correo';
import { type Regla, reglaNueva, useReglas } from '@/composables/use-reglas';

/**
 * Las reglas de correo de una cuenta, en un diálogo del sistema. Se listan en
 * orden de prioridad (la primera que coincide manda si tiene «detener»), se
 * prenden/apagan, se reordenan y se editan.
 */
const props = withDefaults(defineProps<{ abierto: boolean; cuentas?: Cuenta[] }>(), {
	cuentas: () => [],
});
const emit = defineEmits<{ cerrar: [] }>();

const { t } = useI18n();
const { reglas, cargando, error, cargar, borrar, alternarActiva, mover } = useReglas();

const cuenta = ref('');
const editando = ref<Regla | null>(null);
let dejarDeEscuchar: UnlistenFn | null = null;

// Deja `cuenta` en una de la lista: la que estaba si sigue, si no la primera (o
// vacía). Cubre que la lista llegue tarde o que la cuenta elegida se vaya.
function elegirCuentaValida() {
	const ids = props.cuentas.map((c) => c.account_id);
	if (!ids.includes(cuenta.value)) {
		cuenta.value = ids[0] ?? '';
	}
}

// Si la lista de cuentas cambia con el diálogo abierto, re-elegir.
watch(
	() => props.cuentas,
	() => {
		if (props.abierto) {
			elegirCuentaValida();
		}
	},
	{ deep: true }
);

// Al abrir: elegir cuenta, enganchar el aviso del servicio **antes** de cargar
// (para no perderse uno que llegue durante la carga) y cargar. El reorden/edición
// de la cuenta la maneja el watcher de `cuenta`; el contador de `useReglas`
// descarta cualquier carga vieja, así que una carga de más es inocua.
watch(
	() => props.abierto,
	async (abierto) => {
		if (!abierto) {
			dejarDeEscuchar?.();
			dejarDeEscuchar = null;
			return;
		}
		elegirCuentaValida();
		const dejar = await listen('reglas-cambio', () => cargar(cuenta.value));
		// Pudo cerrarse mientras se registraba: no dejar un oyente colgado.
		if (props.abierto) {
			dejarDeEscuchar = dejar;
		} else {
			dejar();
		}
		await cargar(cuenta.value);
	}
);

watch(cuenta, (id) => cargar(id));

onBeforeUnmount(() => dejarDeEscuchar?.());

function nueva() {
	editando.value = reglaNueva();
}

async function eliminar(regla: Regla) {
	await borrar(cuenta.value, regla.id);
}
</script>

<template>
  <Dialog :open="abierto" @update:open="emit('cerrar')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('reglas.titulo') }}</DialogTitle>
      </DialogHeader>

      <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto p-1">
        <AlertMessage v-if="error" tone="error" icon="dialog-error">{{ error }}</AlertMessage>

        <SelectField v-if="cuentas.length > 1" :label="t('reglas.cuenta')" v-model="cuenta">
          <option v-for="c in cuentas" :key="c.account_id" class="bg-ui-bg text-tx-main" :value="c.account_id">
            {{ c.display_name }}
          </option>
        </SelectField>

        <SectionHeading as="h3" :title="t('reglas.tus')" />

        <EmptyState v-if="!cargando && reglas.length === 0" :title="t('reglas.vacia')" />

        <!-- Cada regla: nombre, prioridad (subir/bajar), prender/apagar, editar y
             borrar. El orden de la lista ES la prioridad. -->
        <ListRow v-for="(regla, i) in reglas" :key="regla.id">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <div class="flex flex-col">
              <ActionButton
                :label="t('reglas.subir')"
                variant="ghost"
                size="sm"
                :disabled="i === 0"
                @click="mover(cuenta, regla.id, 'arriba')" />
              <ActionButton
                :label="t('reglas.bajar')"
                variant="ghost"
                size="sm"
                :disabled="i === reglas.length - 1"
                @click="mover(cuenta, regla.id, 'abajo')" />
            </div>
            <span class="min-w-0 flex-1 truncate text-body-s">
              {{ regla.nombre || t('reglas.sinNombre') }}
            </span>
            <SwitchRow
              :model-value="regla.activa"
              :label="t('reglas.activa')"
              @update:model-value="() => alternarActiva(cuenta, regla)" />
            <ActionButton :label="t('reglas.editar')" variant="ghost" size="sm" @click="editando = regla" />
            <ActionButton :label="t('reglas.borrar')" variant="ghost" size="sm" @click="eliminar(regla)" />
          </div>
        </ListRow>

        <ActionButton :label="t('reglas.nueva')" full-width @click="nueva" />
      </div>

      <div class="flex justify-end pt-2">
        <ActionButton :label="t('reglas.cerrar')" variant="ghost" @click="emit('cerrar')" />
      </div>
    </DialogContent>

    <RuleEditorComponent
      v-if="editando"
      :abierto="editando !== null"
      :cuenta="cuenta"
      :regla="editando"
      @guardada="cargar(cuenta)"
      @cerrar="editando = null" />
  </Dialog>
</template>
