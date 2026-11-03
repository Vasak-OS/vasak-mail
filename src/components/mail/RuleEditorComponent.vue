<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	AlertMessage,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	FormGroup,
	SectionHeading,
	SelectField,
	SwitchRow,
	TextInput,
} from '@vasakgroup/vue-libvasak';
import { computed, ref, watch } from 'vue';
import {
	type Accion,
	accionDesde,
	type Campo,
	type Operador,
	type Prueba,
	type Regla,
	type TipoAccion,
	tipoDeAccion,
	useReglas,
} from '@/composables/use-reglas';

/**
 * Editor de una regla: su nombre, cuándo coincide (condiciones) y qué hace
 * (acciones). Crea una regla nueva (sin id) o reemplaza una existente.
 */
const props = defineProps<{ abierto: boolean; cuenta: string; regla: Regla }>();
const emit = defineEmits<{ cerrar: []; guardada: [] }>();

const { t } = useI18n();
const { crear, actualizar } = useReglas();

// Las condiciones se editan directas; las acciones se aplanan a (tipo, carpeta)
// para poder elegir el tipo con un selector y mostrar la carpeta sólo en
// `mover_a`. Se vuelven a armar al guardar.
const borrador = ref<Regla>(clon(props.regla));
const acciones = ref(props.regla.acciones.map(tipoDeAccion));
const guardando = ref(false);
const error = ref('');

const esNueva = computed(() => !borrador.value.id);

const CAMPOS: Campo[] = [
	'de',
	'para',
	'cc',
	'asunto',
	'responder_a',
	'list_id',
	'tamano',
	'tiene_adjuntos',
];
const PRUEBAS: Prueba[] = ['contiene', 'igual', 'empieza_con', 'mayor', 'menor'];
const OPERADORES: Operador[] = ['todas', 'cualquiera'];
const TIPOS: TipoAccion[] = ['marcar_leido', 'destacar', 'borrar', 'mover_a'];

function clon(regla: Regla): Regla {
	return JSON.parse(JSON.stringify(regla));
}

// Al reabrir con otra regla, se vuelve a cargar lo que trae.
watch(
	() => [props.abierto, props.regla] as const,
	() => {
		if (props.abierto) {
			borrador.value = clon(props.regla);
			acciones.value = props.regla.acciones.map(tipoDeAccion);
			error.value = '';
		}
	}
);

function agregarCondicion() {
	borrador.value.coincidencia.condiciones.push({
		campo: 'de',
		prueba: 'contiene',
		valor: '',
		negar: false,
	});
}

function quitarCondicion(i: number) {
	// Siempre queda al menos una: una regla sin condiciones el servicio la rechaza.
	if (borrador.value.coincidencia.condiciones.length > 1) {
		borrador.value.coincidencia.condiciones.splice(i, 1);
	}
}

function agregarAccion() {
	acciones.value.push({ tipo: 'marcar_leido', carpeta: '' });
}

function quitarAccion(i: number) {
	acciones.value.splice(i, 1);
}

async function guardar() {
	guardando.value = true;
	error.value = '';
	const regla: Regla = {
		...borrador.value,
		acciones: acciones.value.map((a): Accion => accionDesde(a.tipo, a.carpeta)),
	};
	const ok = esNueva.value
		? await crear(props.cuenta, regla)
		: await actualizar(props.cuenta, regla);
	guardando.value = false;
	if (ok) {
		emit('guardada');
		emit('cerrar');
	} else {
		error.value = useReglas().error.value;
	}
}
</script>

<template>
  <Dialog :open="abierto" @update:open="emit('cerrar')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ esNueva ? t('reglas.editor.nueva') : t('reglas.editor.editar') }}</DialogTitle>
      </DialogHeader>

      <div class="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-1">
        <AlertMessage v-if="error" tone="error" icon="dialog-error">{{ error }}</AlertMessage>

        <FormGroup v-slot="{ id }" :label="t('reglas.editor.nombre')" custom-class="gap-0.5">
          <TextInput :id="id" v-model="borrador.nombre" :placeholder="t('reglas.editor.nombrePista')" />
        </FormGroup>

        <!-- Cuándo coincide -->
        <section class="flex flex-col gap-2">
          <SectionHeading as="h3" :title="t('reglas.editor.cuandoCoincide')" />
          <SelectField :label="t('reglas.editor.operador')" v-model="borrador.coincidencia.operador">
            <option v-for="op in OPERADORES" :key="op" class="bg-ui-bg text-tx-main" :value="op">
              {{ t(`reglas.operador.${op}`) }}
            </option>
          </SelectField>

          <div
            v-for="(c, i) in borrador.coincidencia.condiciones"
            :key="i"
            class="flex flex-col gap-2 rounded-corner-m bg-ui-surface/70 p-2">
            <SelectField :label="t('reglas.editor.campo')" v-model="c.campo">
              <option v-for="campo in CAMPOS" :key="campo" class="bg-ui-bg text-tx-main" :value="campo">
                {{ t(`reglas.campo.${campo}`) }}
              </option>
            </SelectField>
            <SelectField :label="t('reglas.editor.prueba')" v-model="c.prueba">
              <option v-for="p in PRUEBAS" :key="p" class="bg-ui-bg text-tx-main" :value="p">
                {{ t(`reglas.prueba.${p}`) }}
              </option>
            </SelectField>
            <FormGroup v-slot="{ id }" :label="t('reglas.editor.valor')" custom-class="gap-0.5">
              <TextInput :id="id" v-model="c.valor" />
            </FormGroup>
            <SwitchRow v-model="c.negar" :label="t('reglas.editor.negar')" />
            <ActionButton
              v-if="borrador.coincidencia.condiciones.length > 1"
              :label="t('reglas.editor.quitarCondicion')"
              variant="ghost"
              size="sm"
              @click="quitarCondicion(i)" />
          </div>
          <ActionButton :label="t('reglas.editor.agregarCondicion')" variant="ghost" size="sm" @click="agregarCondicion" />
        </section>

        <!-- Qué hace -->
        <section class="flex flex-col gap-2">
          <SectionHeading as="h3" :title="t('reglas.editor.queHace')" />
          <div
            v-for="(a, i) in acciones"
            :key="i"
            class="flex flex-col gap-2 rounded-corner-m bg-ui-surface/70 p-2">
            <SelectField :label="t('reglas.editor.accion')" v-model="a.tipo">
              <option v-for="tipo in TIPOS" :key="tipo" class="bg-ui-bg text-tx-main" :value="tipo">
                {{ t(`reglas.accion.${tipo}`) }}
              </option>
            </SelectField>
            <FormGroup v-if="a.tipo === 'mover_a'" v-slot="{ id }" :label="t('reglas.editor.carpeta')" custom-class="gap-0.5">
              <TextInput :id="id" v-model="a.carpeta" />
            </FormGroup>
            <ActionButton :label="t('reglas.editor.quitarAccion')" variant="ghost" size="sm" @click="quitarAccion(i)" />
          </div>
          <ActionButton :label="t('reglas.editor.agregarAccion')" variant="ghost" size="sm" @click="agregarAccion" />
        </section>

        <SwitchRow v-model="borrador.detener" :label="t('reglas.editor.detener')" :description="t('reglas.editor.detenerPorQue')" />
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <ActionButton :label="t('reglas.editor.cancelar')" variant="ghost" @click="emit('cerrar')" />
        <ActionButton :label="t('reglas.editor.guardar')" :disabled="guardando" @click="guardar" />
      </div>
    </DialogContent>
  </Dialog>
</template>
