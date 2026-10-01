<script lang="ts" setup>
import { invoke } from '@tauri-apps/api/core';
import { open as abrirDialogo } from '@tauri-apps/plugin-dialog';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	Dialog,
	DialogContent,
	DialogTitle,
	DropdownMenuItem,
	FormGroup,
	ListRow,
	Popover,
	PopoverContent,
	PopoverTrigger,
	SelectField,
	TextArea,
	TextInput,
} from '@vasakgroup/vue-libvasak';
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue';
import type { AdjuntoParaMandar, Borrador, Cuenta } from '@/composables/use-correo';
import { elegida, momentos, paraElServicio } from '@/tools/programar';
import { direcciones } from '@/tools/responder';

const props = defineProps<{
	/** Lo que ya trae escrito: vacío para uno nuevo, lleno para una respuesta. */
	inicial: Borrador;
	/** Si es una respuesta, para el título. */
	esRespuesta: boolean;
	enviando: boolean;
	/** Todas las conectadas, para poder elegir desde cuál sale. */
	cuentas: Cuenta[];
	/** Desde cuál sale. */
	cuenta: string;
}>();

const emit = defineEmits<{
	/** `cuando` es una hora en RFC 3339, o vacío para «con la ventana de siempre». */
	enviar: [borrador: Borrador, cuando: string];
	elegirCuenta: [accountId: string];
	cerrar: [];
}>();

const { t, locale } = useI18n();

const para = ref(props.inicial.para.join(', '));
const cc = ref(props.inicial.cc.join(', '));
const asunto = ref(props.inicial.asunto);
const cuerpo = ref(props.inicial.cuerpo);

/**
 * De qué cuenta sale, siempre a la vista.
 *
 * **No es un adorno.** Con la bandeja combinada, lo que se está mirando y lo que
 * responde pueden ser cuentas distintas, y una respuesta que sale con la
 * identidad equivocada no se deshace: la lee quien la recibe, con otra dirección
 * de remitente, y nadie se entera de este lado.
 *
 * Con una sola cuenta conectada se dice igual pero no se puede cambiar: no hay
 * a qué.
 */
const remitente = computed(
	() => props.cuentas.find((c) => c.account_id === props.cuenta)?.display_name ?? ''
);
const sePuedeElegir = computed(() => props.cuentas.length > 1);

const bodyField = useTemplateRef<InstanceType<typeof TextArea>>('bodyField');
const toField = useTemplateRef<InstanceType<typeof TextInput>>('toField');

/**
 * Sin destinatario no hay nada que mandar, y el botón lo dice apagándose.
 *
 * Es lo único que se valida acá: el resto lo revisa el servicio, que es quien
 * sabe qué es una dirección válida, y lo contesta en el acto.
 */
const sePuedeEnviar = computed(() => direcciones(para.value).length > 0 && !props.enviando);

/**
 * Si hay algo escrito que se perdería al cerrar.
 *
 * Se compara con **lo que se abrió** y no con lo que está vacío, a propósito:
 * una respuesta recién abierta ya trae destinatario, asunto y la cita, y
 * preguntar por eso sería preguntar por algo que se rehace apretando
 * «Responder» otra vez. Lo que no se puede rehacer es lo que la persona
 * escribió, y eso es exactamente lo que difiere del punto de partida.
 */
const hayAlgoEscrito = computed(
	() =>
		para.value.trim() !== props.inicial.para.join(', ') ||
		cc.value.trim() !== '' ||
		asunto.value.trim() !== props.inicial.asunto ||
		cuerpo.value.trim() !== props.inicial.cuerpo.trim()
);

/**
 * El foco en el campo, después del que pone el diálogo.
 *
 * `DialogContent` enfoca **el panel** al abrir, que es lo que corresponde a un
 * diálogo que pregunta algo: así un lector de pantalla lee el título antes que
 * la primera acción. Redactar no pregunta nada, es un formulario: lo útil es
 * entrar escribiendo, y por eso el foco termina en el campo.
 *
 * Los dos esperan un `nextTick` y las dos continuaciones se retoman en el
 * orden en que se pidieron. La del diálogo se pide antes —su observador
 * `immediate` corre mientras se arma el componente, o sea antes de que este
 * `onMounted` exista—, así que ésta llega después sin tener que esperar de
 * más. Lo comprobé sacando una espera que había puesto por las dudas: ninguna
 * prueba se movió.
 *
 * Igual es un orden que no se lee en el código, así que hay una prueba que
 * mira **dónde queda el foco** al abrir, y no que se haya llamado a `focus()`.
 */
onMounted(async () => {
	await nextTick();
	// El foco donde falta escribir: en una respuesta el destinatario y el
	// asunto ya están, así que ir al cuerpo ahorra dos tabulaciones.
	if (props.esRespuesta) {
		bodyField.value?.focus();
		// Y el cursor arriba de la cita, que es donde se escribe. `TextArea` no
		// expone el elemento: el `<textarea>` es su `$el`.
		(bodyField.value?.$el as HTMLTextAreaElement | undefined)?.setSelectionRange(0, 0);
	} else {
		toField.value?.focus();
	}
});

/**
 * Los archivos pegados a este borrador.
 *
 * Se guardan acá y no en `props.inicial` porque el borrador inicial es lo que
 * llegó —una respuesta, o nada— y esto es lo que se agrega mientras se escribe.
 */
const adjuntos = ref<AdjuntoParaMandar[]>([...(props.inicial.adjuntos ?? [])]);
/** Lo que falló al adjuntar: un archivo muy grande, uno que no se pudo leer. */
const errorAdjunto = ref('');

/**
 * Abre el diálogo del sistema y lee lo que se elija.
 *
 * El diálogo del sistema y no un `<input type="file">`: es el que respeta el
 * portal, el que recuerda la última carpeta y el que se ve como el resto del
 * escritorio.
 *
 * Lee **esta** aplicación y no el servicio. El servicio corre como la persona y
 * podría leer cualquier archivo suyo; pasarle una ruta sería dejar que la
 * ventana elija qué lee.
 */
async function adjuntar() {
	errorAdjunto.value = '';
	let elegidos: string | string[] | null;
	try {
		elegidos = await abrirDialogo({ multiple: true, title: t('adjuntar.titulo') });
	} catch (e) {
		errorAdjunto.value = String(e);
		return;
	}
	if (!elegidos) {
		return;
	}

	for (const ruta of Array.isArray(elegidos) ? elegidos : [elegidos]) {
		try {
			adjuntos.value.push(await invoke<AdjuntoParaMandar>('leer_adjunto', { ruta }));
		} catch (e) {
			// Se dice cuál falló y se siguen los demás: que un archivo sea
			// demasiado grande no tiene por qué descartar los otros tres.
			errorAdjunto.value = String(e);
		}
	}
}

function removeAttachment(index: number) {
	adjuntos.value.splice(index, 1);
	errorAdjunto.value = '';
}

/** El tamaño en la unidad que se entienda. */
function sizeOf(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Si está abierto el menú de programar. */
const programando = ref(false);
/** Lo que se escribió en el control de fecha y hora, si se usó. */
const aMano = ref('');

const scheduleOptions = computed(() => momentos(new Date()));

/** La hora de una opción, en el idioma de la sesión. */
function atWhatTime(cuando: Date): string {
	return new Intl.DateTimeFormat(locale.value, {
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
	}).format(cuando);
}

/**
 * Programa y manda. La hora se pasa al servicio en UTC.
 *
 * Una hora que ya pasó no llega hasta acá: `momentos` no ofrece las que
 * pasaron y `elegida` rechaza las que se escriban a mano. Programar para antes
 * de ahora haría salir el mensaje en el acto, que es lo contrario de lo que se
 * pidió — y sin nada que lo explique.
 */
function programar(cuando: Date) {
	programando.value = false;
	if (!sePuedeEnviar.value) {
		return;
	}
	emit('enviar', armar(), paraElServicio(cuando));
}

function scheduleTyped() {
	const cuando = elegida(aMano.value, new Date());
	if (cuando) {
		programar(cuando);
	}
}

/** El borrador con lo que hay en pantalla. */
function armar(): Borrador {
	return {
		...props.inicial,
		para: direcciones(para.value),
		cc: direcciones(cc.value),
		asunto: asunto.value,
		cuerpo: cuerpo.value,
		adjuntos: adjuntos.value,
	};
}

function enviar() {
	if (!sePuedeEnviar.value) {
		return;
	}
	// Vacío quiere decir «con la ventana para arrepentirse de siempre»: la hora
	// la calcula quien dibuja ese botón, no esta ventana.
	emit('enviar', armar(), '');
}

function cerrar() {
	// Preguntar antes de tirar lo que alguien escribió. Es barato y lo otro no
	// se deshace.
	if (hayAlgoEscrito.value && !window.confirm(t('redactar.descartarBorrador'))) {
		return;
	}
	emit('cerrar');
}
</script>

<template>
  <Dialog :open="true" @update:open="cerrar()">
    <DialogContent size="lg" class="flex max-h-full flex-col">
      <!-- `overflow-y-auto`: en una ventana baja o angosta el formulario no
           entra entero, y antes los botones de abajo quedaban cortados fuera
           del panel, sin forma de llegar a «Enviar». Ahora se desplaza. -->
      <form class="flex max-h-full min-h-0 min-w-0 flex-col gap-2 overflow-y-auto" @submit.prevent="enviar()">
        <DialogTitle class="font-title">
          {{ esRespuesta ? t('redactar.tituloRespuesta') : t('redactar.titulo') }}
        </DialogTitle>

        <!-- Desde qué cuenta sale, arriba de todo: es lo primero que hay que
             poder comprobar cuando hay más de una casilla. -->
        <SelectField
          v-if="sePuedeElegir"
          :label="t('redactar.desde')"
          :model-value="cuenta"
          @update:model-value="(id: string) => emit('elegirCuenta', id)">
          <option
            v-for="c in cuentas"
            :key="c.account_id"
            class="bg-ui-bg text-tx-main"
            :value="c.account_id">
            {{ c.display_name }}
          </option>
        </SelectField>
        <div v-else class="flex min-w-0 flex-col gap-0.5">
          <span class="font-semibold text-label-s">{{ t('redactar.desde') }}</span>
          <span class="truncate px-2 py-1 text-body-s">{{ remitente }}</span>
        </div>

        <FormGroup v-slot="{ id }" :label="t('redactar.para')" custom-class="gap-0.5">
          <TextInput
            :id="id"
            ref="toField"
            v-model="para"
            :placeholder="t('redactar.variasDirecciones')"
            autocomplete="off" />
        </FormGroup>

        <FormGroup v-slot="{ id }" :label="t('redactar.cc')" custom-class="gap-0.5">
          <TextInput :id="id" v-model="cc" autocomplete="off" />
        </FormGroup>

        <FormGroup v-slot="{ id }" :label="t('redactar.asunto')" custom-class="gap-0.5">
          <TextInput :id="id" v-model="asunto" autocomplete="off" />
        </FormGroup>

        <FormGroup v-slot="{ id }" :label="t('redactar.cuerpo')" custom-class="flex-1 shrink-0 gap-0.5">
          <TextArea
            :id="id"
            ref="bodyField"
            v-model="cuerpo"
            :rows="12"
            resize="none"
            class="min-h-40 flex-1" />
        </FormGroup>

        <!-- Lo que se va a mandar pegado.
             El tamaño va al lado del nombre porque es lo que decide si el mensaje
             llega: casi ningún servidor avisa hasta que se intenta, y para
             entonces el mensaje ya viajó. -->
        <ul v-if="adjuntos.length" class="flex flex-col gap-1">
          <li v-for="(adjunto, index) in adjuntos" :key="`${adjunto.nombre}-${index}`">
            <ListRow class="border border-ui-line bg-ui-surface/70 px-2 py-1" :meta="sizeOf(adjunto.bytes)">
              <span class="truncate text-body-s">{{ adjunto.nombre }}</span>
              <template #trailing>
                <ActionButton
                  label=""
                  variant="ghost"
                  size="sm"
                  icon="window-close-symbolic"
                  :icon-alt="t('adjuntar.sacar')"
                  :title="t('adjuntar.sacar')"
                  @click="removeAttachment(index)" />
              </template>
            </ListRow>
          </li>
        </ul>

        <!-- Que un archivo falle no descarta los otros, así que esto es un aviso y
             no un error del formulario: los que sí entraron están en la lista de
             arriba. -->
        <p v-if="errorAdjunto" class="break-words text-body-xs text-status-warning">{{ errorAdjunto }}</p>

        <!-- Se dice porque cambia lo que la persona espera del botón: «Enviar» no
             espera al servidor, guarda el mensaje y lo manda cuando pueda. Sin
             esto, cerrar la ventana enseguida da miedo. -->
        <p class="text-body-xs text-tx-muted">{{ t('redactar.seEncola') }}</p>

        <!-- `flex-wrap`: en una ventana angosta los cuatro no entran en una
             fila, y antes el primero quedaba cortado contra el borde. -->
        <div class="flex flex-wrap justify-end gap-2 pt-1">
          <ActionButton :label="t('redactar.cancelar')" variant="ghost" @click="cerrar()" />
          <ActionButton
            :label="t('adjuntar.boton')"
            variant="secondary"
            icon="mail-attachment-symbolic"
            @click="adjuntar()" />

          <!-- Programar va **al lado** de enviar y no adentro de un menú de tres
               puntos: es una forma de mandar, no una preferencia escondida. -->
          <Popover v-model:open="programando">
            <PopoverTrigger as-child :disabled="!sePuedeEnviar">
              <ActionButton
                :label="t('programar.boton')"
                variant="secondary"
                :title="t('programar.titulo')"
                :disabled="!sePuedeEnviar" />
            </PopoverTrigger>
            <PopoverContent side="top" align="end" padding="sm" :label="t('programar.titulo')" class="w-60">
              <div class="flex flex-col">
                <DropdownMenuItem
                  v-for="opcion in scheduleOptions"
                  :key="opcion.clave"
                  @select="programar(opcion.cuando)">
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
                :label="t('programar.confirmar')"
                full-width
                class="mt-2"
                :disabled="!elegida(aMano, new Date())"
                @click="scheduleTyped()" />
            </PopoverContent>
          </Popover>

          <ActionButton
            type="submit"
            :label="enviando ? t('redactar.enviando') : t('redactar.enviar')"
            :disabled="!sePuedeEnviar" />
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
