<script lang="ts" setup>
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import AtajosComponent from '@/components/correo/AtajosComponent.vue';
import CuentasComponent from '@/components/correo/CuentasComponent.vue';
import DeshacerComponent from '@/components/correo/DeshacerComponent.vue';
import ListaComponent from '@/components/correo/ListaComponent.vue';
import MensajeComponent from '@/components/correo/MensajeComponent.vue';
import RedactarComponent from '@/components/correo/RedactarComponent.vue';
import { type Borrador, type Resumen, useCorreo } from '@/composables/use-correo';
import { useReactiveIcons } from '@/composables/useReactiveIcon';
import WindowAppLayout from '@/layouts/WindowAppLayout.vue';
import { Atajos } from '@/tools/atajos';
import { claveDe } from '@/tools/bandeja';
import { nombreDeCasilla } from '@/tools/casillas';
import { interpolar } from '@/tools/interpolar';
import { panelVisible } from '@/tools/paneles';
import { responder as armarRespuesta } from '@/tools/responder';

const { t, locale } = useI18n();
const {
	cuentas,
	combinada,
	sinLeerEnTotal,
	elegida,
	casillas,
	casilla,
	mensajes,
	visibles,
	consulta,
	queSeVe,
	buscandoEnElServidor,
	escribirEnElBuscador,
	limpiarBusqueda,
	buscarEnElServidor,
	abierto,
	cuerpo,
	cargandoLista,
	cargandoMensaje,
	error,
	salientes,
	enviando,
	cargarCuentas,
	elegir,
	elegirCasilla,
	abrir,
	cerrar,
	marcarLeido,
	enviar,
	enCamino,
	deshacerEnvio,
	olvidarEnvio,
	descartarSaliente,
} = useCorreo();

const { actualizar, icono } = useReactiveIcons({
	actualizar: 'view-refresh',
	// El icono de la aplicación, no un símbolo: es la identidad de la ventana y
	// va a color, como en el resto del escritorio.
	icono: { name: 'internet-mail', type: 'icon' },
});

/**
 * Dónde está parada la ventana: la carpeta abierta y de qué cuenta.
 *
 * Es lo que va al medio de la barra, por el mismo motivo por el que el
 * calendario pone ahí el mes: es la única cosa que dice qué se está mirando, y
 * con varias cuentas conectadas equivocarse de casilla es fácil y no se nota.
 */
const dondeEstoy = computed(() => {
	// En la combinada no hay una cuenta que nombrar, y la carpeta es la de
	// entrada de todas: se dice así y no con el nombre de una.
	if (combinada.value) {
		return { carpeta: t('cuentas.todas'), cuenta: '' };
	}
	const abierta = casillas.value.find((c) => c.ruta === casilla.value);
	return {
		carpeta: abierta ? nombreDeCasilla(abierta, t) : t('casillas.entrada'),
		cuenta: cuentas.value.find((c) => c.account_id === elegida.value)?.display_name ?? '',
	};
});

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
	adjuntos: [],
};

function escribir() {
	redactando.value = { ...VACIO };
	// En la combinada no hay una cuenta elegida, así que se toma la primera y se
	// muestra cuál es en la ventana de redacción, donde se puede cambiar. Mandar
	// desde «todas» no quiere decir nada, y adivinar en silencio es cómo sale un
	// correo con la identidad equivocada.
	cuentaDelBorrador.value = combinada.value ? (cuentas.value[0]?.account_id ?? '') : elegida.value;
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
	// **La cuenta del mensaje y no la elegida.** En la bandeja combinada son dos
	// cosas distintas, y responder desde la elegida mandaba la respuesta con la
	// identidad de otra casilla — a alguien que le escribió a la primera.
	cuentaDelBorrador.value = abierto.value.account_id;
	esRespuesta.value = true;
}

/**
 * Deshacer: saca el mensaje de la cola y **devuelve lo escrito** a la ventana.
 *
 * Sacarlo y perder el texto no sería deshacer, sería borrar. Si ya salió, el
 * composable devuelve `null` y acá no se abre nada: prometer deshacer algo que
 * ya se mandó es peor que no ofrecerlo.
 */
async function volverAAbrirLoQueSeMando() {
	const borrador = await deshacerEnvio();
	if (borrador) {
		redactando.value = borrador;
		esRespuesta.value = false;
	}
}

async function enviarBorrador(borrador: Borrador, cuando: string) {
	// La ventana se cierra **sólo si quedó guardado**. Un borrador que el
	// servicio rechaza —una dirección mal escrita— tiene que seguir en pantalla
	// con el error a la vista, o lo que se escribió se pierde.
	if (await enviar(cuentaDelBorrador.value, borrador, cuando)) {
		redactando.value = null;
	}
}

/** Si está a la vista la lista de atajos. */
const mostrandoAtajos = ref(false);

/** Si se pidió cambiar de carpeta. Sólo cambia lo que se ve en angosto. */
const pidieronCarpetas = ref(false);

/**
 * Qué panel se ve cuando no entran los tres.
 *
 * Se **deduce** de lo que la aplicación ya sabe en vez de guardarse aparte: un
 * estado paralelo se desincroniza —abrir un mensaje con la tecla `j` y que el
 * panel no cambie— y la forma de que eso no pase es que no exista.
 */
const panel = computed(() => panelVisible(abierto.value !== null, pidieronCarpetas.value));

const atajos = new Atajos();

/**
 * Moverse por la lista abre el mensaje, y eso es a propósito.
 *
 * Con el panel del mensaje siempre a la vista, una selección que no abre nada
 * obligaría a apretar dos teclas para leer cada correo y a dibujar un segundo
 * resaltado —el seleccionado y el abierto— que en tres paneles no se distingue
 * de nada. El día que haya una ventana angosta, donde el mensaje tapa la lista,
 * ahí sí hacen falta las dos cosas.
 */
function moverse(cuanto: number) {
	if (visibles.value.length === 0) {
		return;
	}
	const lista = visibles.value;
	const actual = abierto.value
		? lista.findIndex((m) => claveDe(m) === claveDe(abierto.value as Resumen))
		: -1;
	// Desde ninguno, `j` abre el primero y `k` el último: es lo que se espera de
	// entrar por arriba o por abajo.
	const siguiente = actual < 0 ? (cuanto > 0 ? 0 : mensajes.value.length - 1) : actual + cuanto;
	const destino = mensajes.value[siguiente];
	if (destino) {
		abrir(destino);
	}
}

/**
 * Elegir una cuenta o una carpeta devuelve a la lista.
 *
 * En una ventana angosta, quedarse en el panel de carpetas después de elegir
 * una obliga a un toque más para ver lo que se acaba de pedir. En una ancha no
 * cambia nada: el panel de carpetas está siempre a la vista.
 */
async function elegirCuenta(accountId: string) {
	pidieronCarpetas.value = false;
	await elegir(accountId);
}

async function elegirCarpeta(ruta: string) {
	pidieronCarpetas.value = false;
	await elegirCasilla(ruta);
}

/** Vuelve a la lista, venga de donde venga. */
function volverALaLista() {
	pidieronCarpetas.value = false;
	cerrar();
}

function alApretar(evento: KeyboardEvent) {
	// La lista de atajos se cierra con Escape, y eso no pasa por el mapa: es de
	// este diálogo y no una acción de la aplicación.
	if (evento.key === 'Escape' && mostrandoAtajos.value) {
		mostrandoAtajos.value = false;
		return;
	}
	// Con la ventana de redacción abierta el teclado es suyo. Sus propios atajos
	// —Escape para cerrar, Tab para la trampa de foco— los maneja ella.
	if (redactando.value) {
		return;
	}

	const accion = atajos.apretar(evento);
	// Una secuencia a medias también consume la tecla: la `g` de `g i` no tiene
	// que llegar a la página.
	if (accion || atajos.esperando()) {
		evento.preventDefault();
	}

	switch (accion) {
		case 'siguiente':
			moverse(1);
			break;
		case 'anterior':
			moverse(-1);
			break;
		case 'abrir':
			if (!abierto.value) moverse(1);
			break;
		case 'volver':
			volverALaLista();
			break;
		case 'responder':
			responderAlAbierto();
			break;
		case 'redactar':
			escribir();
			break;
		case 'actualizar':
			cargarCuentas();
			break;
		case 'irALaEntrada':
			elegirCasilla('INBOX');
			break;
		case 'ayuda':
			mostrandoAtajos.value = true;
			break;
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
	// En la ventana entera y no en un elemento: los atajos tienen que andar sin
	// que haya que hacer clic en la lista primero, que es lo que pasaría si el
	// oyente colgara de un panel.
	window.addEventListener('keydown', alApretar);

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
	window.removeEventListener('keydown', alApretar);
	dejarDeEscuchar?.();
});
</script>

<template>
  <WindowAppLayout>
    <template #barra>
      <!-- El icono de la aplicación, a la izquierda de todo, como en el resto
           del escritorio. Reemplaza al título escrito: el nombre de la ventana
           ya lo dice el icono. -->
      <img :src="icono" class="h-6 w-6 shrink-0" :alt="t('app.nombre')" />

      <!-- Lo que sigue se va contra los controles de la ventana, que es donde
           está el botón de actualizar en el resto de las aplicaciones. -->
      <span class="flex-1"></span>

      <!-- El estado de carga se dice, no se insinúa con un icono girando: sin
           esto, un servidor lento y una casilla vacía se ven igual. -->
      <span v-if="cargandoLista" class="text-tx-muted text-xs" role="status">
        {{ t('lista.cargando') }}
      </span>
      <button
        type="button"
        class="rounded-corner border border-ui-border bg-ui-bg/80 p-1 hover:bg-ui-surface disabled:opacity-50"
        :aria-label="t('lista.actualizar')"
        :title="t('lista.actualizar')"
        :disabled="cargandoLista"
        @click="cargarCuentas()">
        <img :src="actualizar" class="h-6 w-6" alt="" />
      </button>
    </template>

    <!-- Dónde se está parado, centrado en la barra entera y no en lo que sobra
         entre el icono y los controles de la ventana.

         `aria-live` porque al cambiar de carpeta es lo único que lo anuncia:
         quien no ve la lista no tiene otra pista de que cambió. -->
    <template #barraCentro>
      <span class="flex items-baseline gap-2" aria-live="polite">
        <span class="font-title text-base">{{ dondeEstoy.carpeta }}</span>
        <span v-if="dondeEstoy.cuenta" class="max-w-56 truncate text-tx-muted text-xs">
          {{ dondeEstoy.cuenta }}
        </span>
      </span>
    </template>

    <!-- `relative` porque la ventana de redacción va encima, no en una ventana
         aparte: escribir un correo es algo que se hace y se termina. -->
    <div class="relative flex min-h-0 flex-1 flex-col">
      <AtajosComponent :abierto="mostrandoAtajos" @cerrar="mostrandoAtajos = false" />

      <!-- La ventana para arrepentirse. Va sobre todo lo demás porque es lo
           único con tiempo: si no se ve, no sirve. -->
      <DeshacerComponent
        :hasta="enCamino?.hasta ?? null"
        @deshacer="volverAAbrirLoQueSeMando"
        @vencio="olvidarEnvio" />
      <!-- Lo que falló va a la vista y no a la consola: una casilla vacía y una
           que no se pudo leer se ven idénticas, y la diferencia importa. -->
      <p
        v-if="error"
        class="border-ui-border border-b px-3 py-2 text-status-warning text-xs"
        role="status">
        {{ error }}
      </p>

      <!-- Las secciones separadas por aire y no por líneas: cada una es una
           superficie redondeada, como los paneles del escritorio. -->
      <div class="flex min-h-0 flex-1 gap-1 p-1">
        <CuentasComponent
          :panel="panel"
          :cuentas="cuentas"
          :elegida="elegida"
          :casillas="casillas"
          :casilla="casilla"
          :salientes="salientes"
          :sin-leer-en-total="sinLeerEnTotal"
          @elegir="elegirCuenta"
          @elegir-casilla="elegirCarpeta"
          @escribir="escribir"
          @descartar="descartarSaliente" />
        <ListaComponent
          :panel="panel"
          :carpeta="dondeEstoy.carpeta"
          :consulta="consulta"
          :que-se-ve="queSeVe"
          :buscando-en-el-servidor="buscandoEnElServidor"
          :mensajes="visibles"
          :abierto="abierto"
          :cargando="cargandoLista"
          :combinada="combinada"
          :cuentas="cuentas"
          @abrir="abrir"
          @carpetas="pidieronCarpetas = true"
          @buscar="escribirEnElBuscador"
          @buscar-en-el-servidor="buscarEnElServidor"
          @limpiar="limpiarBusqueda" />
        <MensajeComponent
          :panel="panel"
          :abierto="abierto"
          :cuerpo="cuerpo"
          :cargando="cargandoMensaje"
          @marcar-leido="marcarLeido"
          @responder="responderAlAbierto"
          @volver="volverALaLista" />
      </div>

      <RedactarComponent
        v-if="redactando"
        :inicial="redactando"
        :es-respuesta="esRespuesta"
        :enviando="enviando"
        :cuentas="cuentas"
        :cuenta="cuentaDelBorrador"
        @elegir-cuenta="cuentaDelBorrador = $event"
        @enviar="enviarBorrador"
        @cerrar="redactando = null" />
    </div>
  </WindowAppLayout>
</template>
