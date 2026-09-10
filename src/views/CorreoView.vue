<script lang="ts" setup>
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { onMounted, onUnmounted, ref } from 'vue';
import CuentasComponent from '@/components/correo/CuentasComponent.vue';
import ListaComponent from '@/components/correo/ListaComponent.vue';
import MensajeComponent from '@/components/correo/MensajeComponent.vue';
import RedactarComponent from '@/components/correo/RedactarComponent.vue';
import { type Borrador, useCorreo } from '@/composables/use-correo';
import { interpolar } from '@/tools/interpolar';
import { responder as armarRespuesta } from '@/tools/responder';

const { t, locale } = useI18n();
const {
	cuentas,
	elegida,
	mensajes,
	abierto,
	cuerpo,
	cargandoLista,
	cargandoMensaje,
	error,
	salientes,
	enviando,
	cargarCuentas,
	elegir,
	abrir,
	marcarLeido,
	enviar,
	descartarSaliente,
} = useCorreo();

/** El borrador abierto, o `null` si no hay ninguno. */
const redactando = ref<Borrador | null>(null);
const esRespuesta = ref(false);
/**
 * Desde qué cuenta se está escribiendo.
 *
 * Se guarda al abrir la ventana y no se vuelve a leer de `elegida`: entre
 * escribir y apretar «Enviar» se puede cambiar de casilla, y el mensaje saldría
 * desde la otra — con una dirección que no es la que se estaba mirando, y una
 * respuesta con la identidad equivocada.
 */
const cuentaDelBorrador = ref('');

const VACIO: Borrador = {
	para: [],
	cc: [],
	asunto: '',
	cuerpo: '',
	en_respuesta_a: '',
	referencias: [],
};

function escribir() {
	redactando.value = { ...VACIO };
	cuentaDelBorrador.value = elegida.value;
	esRespuesta.value = false;
}

/**
 * Abre una respuesta al mensaje que se está leyendo.
 *
 * El encabezado de la cita se arma acá, que es donde hay traducciones y donde
 * se sabe en qué idioma está la sesión.
 */
function responderAlAbierto() {
	if (!abierto.value || !cuerpo.value) {
		return;
	}
	const fecha = abierto.value.fecha
		? new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(
				new Date(abierto.value.fecha)
			)
		: '';
	const encabezado = interpolar(t('redactar.citado'), fecha, abierto.value.de);

	const respuesta = armarRespuesta(
		{
			asunto: abierto.value.asunto,
			texto: cuerpo.value.texto,
			de: abierto.value.direccion,
			responder_a: cuerpo.value.responder_a,
			fecha: abierto.value.fecha,
			message_id: cuerpo.value.message_id,
			referencias: cuerpo.value.referencias,
		},
		encabezado
	);

	// Campo por campo y no con un `as`: `armarRespuesta` no devuelve un
	// borrador, le falta el `cc`. Convencer al compilador de que sí lo es y
	// agregárselo en la línea siguiente es pedirle que no mire justo donde
	// hay que mirar — el día que el borrador tenga un campo más, el `as` lo
	// deja sin inicializar y nada avisa.
	//
	// **Responder no copia el `Cc`.** Sería «responder a todos», que es otra
	// cosa y otro botón: hacerlo por omisión manda la respuesta a gente que no
	// se eligió, y eso no se deshace.
	redactando.value = {
		para: respuesta.para,
		cc: [],
		asunto: respuesta.asunto,
		cuerpo: respuesta.cuerpo,
		en_respuesta_a: respuesta.en_respuesta_a,
		referencias: respuesta.referencias,
	};
	cuentaDelBorrador.value = elegida.value;
	esRespuesta.value = true;
}

async function enviarBorrador(borrador: Borrador) {
	// La ventana se cierra **sólo si quedó guardado**. Un borrador que el
	// servicio rechaza —una dirección mal escrita— tiene que seguir en pantalla
	// con el error a la vista, o lo que se escribió se pierde.
	if (await enviar(cuentaDelBorrador.value, borrador)) {
		redactando.value = null;
	}
}

let dejarDeEscuchar: UnlistenFn | null = null;
/**
 * Si la vista ya se desmontó.
 *
 * `onMounted` es asíncrono: `onUnmounted` puede correr **mientras** las promesas
 * de acá adentro siguen pendientes, y ahí `dejarDeEscuchar` todavía es `null`.
 * Sin esta marca, el `listen` terminaba después del desmontaje, nadie lo
 * cancelaba, y quedaba un oyente llamando a `cargarCuentas()` sobre un
 * composable descartado — uno más en cada ciclo de montar y desmontar.
 */
let desmontada = false;

onMounted(async () => {
	// El oyente **antes** de la primera carga. El sincronizador avisa cuando
	// llega correo; enganchándose después, un aviso que llegue durante esos dos
	// segundos se pierde y la lista queda vieja hasta el siguiente.
	try {
		const cancelar = await listen('correo-cambio', () => cargarCuentas());
		if (desmontada) {
			cancelar();
		} else {
			dejarDeEscuchar = cancelar;
		}
	} catch (e) {
		console.error('no se pudo escuchar los avisos de correo nuevo', e);
	}

	await cargarCuentas();
});

onUnmounted(() => {
	desmontada = true;
	dejarDeEscuchar?.();
});
</script>

<template>
  <!-- `relative` porque la ventana de redacción va encima, no en una ventana
       aparte: escribir un correo es algo que se hace y se termina. -->
  <div class="relative flex min-h-0 flex-1 flex-col">
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
      <CuentasComponent
        :cuentas="cuentas"
        :elegida="elegida"
        :salientes="salientes"
        @elegir="elegir"
        @escribir="escribir"
        @descartar="descartarSaliente" />
      <ListaComponent
        :mensajes="mensajes"
        :abierto="abierto"
        :cargando="cargandoLista"
        @abrir="abrir" />
      <MensajeComponent
        :abierto="abierto"
        :cuerpo="cuerpo"
        :cargando="cargandoMensaje"
        @marcar-leido="marcarLeido"
        @responder="responderAlAbierto" />
    </div>

    <RedactarComponent
      v-if="redactando"
      :inicial="redactando"
      :es-respuesta="esRespuesta"
      :enviando="enviando"
      @enviar="enviarBorrador"
      @cerrar="redactando = null" />
  </div>
</template>
