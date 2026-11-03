<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ActionButton, EmptyState, ListRow, LoadingState, Panel } from '@vasakgroup/vue-libvasak';
import { computed } from 'vue';
import type { Cuenta, PospuestoVisible } from '@/composables/use-correo';
import { interpolar } from '@/tools/interpolar';
import { type Pane, paneVisibility } from '@/tools/panes';
import { momentoLegible } from '@/tools/programar';

const props = defineProps<{
	/** Cuál de los tres paneles se ve. Sólo importa en una ventana angosta. */
	panel: Pane;
	pospuestos: PospuestoVisible[];
	cargando: boolean;
	/** Si se están viendo todas las cuentas juntas. */
	combinada: boolean;
	cuentas: Cuenta[];
}>();
const emit = defineEmits<{
	carpetas: [];
	devolver: [pospuesto: PospuestoVisible];
}>();

const { t, locale } = useI18n();

const nombres = computed(() => new Map(props.cuentas.map((c) => [c.account_id, c.display_name])));

/** El nombre de la cuenta, sólo cuando están todas juntas. */
function cuentaDe(p: PospuestoVisible): string {
	return props.combinada ? (nombres.value.get(p.account_id) ?? '') : '';
}

function cuandoVuelve(p: PospuestoVisible): string {
	return interpolar(
		t('posponer.vuelve'),
		momentoLegible(new Date(p.volver_a * 1000), locale.value)
	);
}
</script>

<template>
  <!-- Ocupa el lugar de la lista de mensajes: mismo ancho y mismo panel. -->
  <Panel
    padding="none"
    scroll
    class="w-full shrink-0 @three-panes/panes:w-80"
    :class="paneVisibility('list', panel)">
    <!-- Sólo en angosto, como en la lista: por acá se llega a las carpetas. -->
    <div class="border-ui-line-weak border-b p-1 @three-panes/panes:hidden">
      <ActionButton
        :label="t('posponer.vista')"
        variant="ghost"
        icon="pan-down-symbolic"
        icon-right
        class="max-w-full justify-start"
        @click="emit('carpetas')" />
    </div>

    <LoadingState v-if="cargando && pospuestos.length === 0" size="sm" :label="t('lista.cargando')" />
    <EmptyState v-else-if="pospuestos.length === 0" size="sm" icon="" :title="t('posponer.vacia')" />

    <ul v-else class="flex flex-col gap-0.5 p-1">
      <li v-for="p in pospuestos" :key="`${p.account_id}/${p.message_id}`">
        <ListRow class="px-2 py-1">
          <span class="min-w-0 truncate text-label-m" :title="p.asunto || p.message_id">
            {{ p.asunto || t('posponer.sinDatos') }}
          </span>
          <span v-if="p.de" class="min-w-0 truncate text-body-s text-tx-muted">{{ p.de }}</span>
          <span class="min-w-0 truncate text-body-xs text-tx-muted">
            {{ cuandoVuelve(p) }} · {{ interpolar(t('posponer.deLaCarpeta'), p.casilla_origen) }}
          </span>
          <span v-if="cuentaDe(p)" class="min-w-0 truncate text-body-xs text-tx-muted">{{ cuentaDe(p) }}</span>
          <ActionButton
            :label="t('posponer.devolver')"
            variant="ghost"
            size="sm"
            class="-ml-2 self-start"
            @click="emit('devolver', p)" />
        </ListRow>
      </li>
    </ul>
  </Panel>
</template>
