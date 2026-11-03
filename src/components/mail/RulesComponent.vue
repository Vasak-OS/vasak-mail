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

// Al abrir, elegir una cuenta y cargar sus reglas; escuchar el aviso del
// servicio para refrescar sin volver a pedirlo a mano.
watch(
	() => props.abierto,
	async (abierto) => {
		if (abierto) {
			if (!cuenta.value && props.cuentas.length > 0) {
				cuenta.value = props.cuentas[0].account_id;
			}
			await cargar(cuenta.value);
			dejarDeEscuchar = await listen('reglas-cambio', () => cargar(cuenta.value));
		} else {
			dejarDeEscuchar?.();
			dejarDeEscuchar = null;
		}
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
