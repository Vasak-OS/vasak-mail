<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	DropdownMenuItem,
	FormGroup,
	Popover,
	PopoverContent,
	PopoverTrigger,
	TextInput,
} from '@vasakgroup/vue-libvasak';
import { ref, watch } from 'vue';
import { elegida, momentos } from '@/tools/programar';

/**
 * El menú de horas de siempre —esta tarde, mañana, el lunes, o una a mano—
 * para elegir cuándo vuelve un mensaje pospuesto o cuándo recordar un
 * seguimiento. Las horas las calcula `tools/programar.ts`; acá sólo se dibujan.
 */
const props = withDefaults(
	defineProps<{
		label: string;
		/** El título del menú. */
		titulo: string;
		/** Lo que dice el botón de la hora escrita a mano. */
		confirmar: string;
		variant?: 'primary' | 'secondary' | 'ghost';
		size?: 'sm' | 'md';
		side?: 'top' | 'bottom';
		disabled?: boolean;
	}>(),
	{ variant: 'secondary', size: 'md', side: 'bottom', disabled: false }
);
const emit = defineEmits<{ elegir: [cuando: Date] }>();

const { t, locale } = useI18n();

const abierto = ref(false);
const aMano = ref('');
/** Se recalculan al abrir: «esta tarde» deja de ofrecerse cuando pasa. */
const opciones = ref(momentos(new Date()));

watch(abierto, (ahora) => {
	if (ahora) {
		opciones.value = momentos(new Date());
		aMano.value = '';
	}
});

function atWhatTime(cuando: Date): string {
	return new Intl.DateTimeFormat(locale.value, {
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
	}).format(cuando);
}

function elegir(cuando: Date) {
	abierto.value = false;
	emit('elegir', cuando);
}

function elegirLaEscrita() {
	const cuando = elegida(aMano.value, new Date());
	if (cuando) {
		elegir(cuando);
	}
}
</script>

<template>
  <Popover v-model:open="abierto">
    <PopoverTrigger as-child :disabled="props.disabled">
      <ActionButton
        :label="props.label"
        :variant="props.variant"
        :size="props.size"
        :title="props.titulo"
        :disabled="props.disabled" />
    </PopoverTrigger>
    <PopoverContent :side="props.side" align="end" padding="sm" :label="props.titulo" class="w-60">
      <div class="flex flex-col">
        <DropdownMenuItem v-for="opcion in opciones" :key="opcion.clave" @select="elegir(opcion.cuando)">
          <span class="flex min-w-0 items-baseline justify-between gap-2">
            <span class="min-w-0 truncate">{{ t(opcion.clave) }}</span>
            <span class="shrink-0 text-body-xs text-tx-muted">{{ atWhatTime(opcion.cuando) }}</span>
          </span>
        </DropdownMenuItem>
      </div>

      <FormGroup v-slot="{ id }" :label="t('programar.aMano')" custom-class="mt-2 gap-1">
        <TextInput :id="id" v-model="aMano" type="datetime-local" />
      </FormGroup>
      <ActionButton
        :label="props.confirmar"
        full-width
        class="mt-2"
        :disabled="!elegida(aMano, new Date())"
        @click="elegirLaEscrita()" />
    </PopoverContent>
  </Popover>
</template>
