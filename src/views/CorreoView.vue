<script lang="ts" setup>
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { onMounted, onUnmounted } from 'vue';
import CuentasComponent from '@/components/correo/CuentasComponent.vue';
import ListaComponent from '@/components/correo/ListaComponent.vue';
import MensajeComponent from '@/components/correo/MensajeComponent.vue';
import { useCorreo } from '@/composables/use-correo';

const { t } = useI18n();
const {
	cuentas,
	elegida,
	mensajes,
	abierto,
	cuerpo,
	cargandoLista,
	cargandoMensaje,
	error,
	cargarCuentas,
	elegir,
	abrir,
	marcarLeido,
} = useCorreo();

let dejarDeEscuchar: UnlistenFn | null = null;

onMounted(async () => {
	await cargarCuentas();
	// El sincronizador avisa cuando llega correo. Sin esto habría que apretar
	// «Actualizar» para enterarse de algo que el servicio ya sabe.
	try {
		dejarDeEscuchar = await listen('correo-cambio', () => cargarCuentas());
	} catch (e) {
		console.error('no se pudo escuchar los avisos de correo nuevo', e);
	}
});

onUnmounted(() => dejarDeEscuchar?.());
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <header class="flex items-center gap-2 border-ui-border border-b px-3 py-2">
      <h1 class="font-title text-lg">{{ t('app.nombre') }}</h1>
      <span class="flex-1"></span>
      <span v-if="cargandoLista" class="text-tx-muted text-xs" role="status">
        {{ t('lista.cargando') }}
      </span>
      <button
        v-else
        type="button"
        class="rounded-corner px-2 py-0.5 text-sm text-tx-muted hover:bg-ui-surface"
        @click="cargarCuentas()">
        {{ t('lista.actualizar') }}
      </button>
    </header>

    <!-- Lo que falló va a la vista y no a la consola: una casilla vacía y una
         que no se pudo leer se ven idénticas, y la diferencia importa. -->
    <p v-if="error" class="border-ui-border border-b px-3 py-2 text-status-warning text-xs" role="status">
      {{ error }}
    </p>

    <div class="flex min-h-0 flex-1">
      <CuentasComponent :cuentas="cuentas" :elegida="elegida" @elegir="elegir" />
      <ListaComponent
        :mensajes="mensajes"
        :abierto="abierto"
        :cargando="cargandoLista"
        @abrir="abrir" />
      <MensajeComponent
        :abierto="abierto"
        :cuerpo="cuerpo"
        :cargando="cargandoMensaje"
        @marcar-leido="marcarLeido" />
    </div>
  </div>
</template>
