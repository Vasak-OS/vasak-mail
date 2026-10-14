//! El correo, tal como lo entrega `vasak-accounts-sync`.
//!
//! ── Esta aplicación no habla IMAP ───────────────────────────────────────────
//!
//! Y no es una etapa pendiente: es lo que hace que sea segura de tener abierta.
//!
//! El correo lo lee el sincronizador, que corre como servicio del usuario y ya
//! tiene la conexión abierta esperando avisos del servidor. Esta ventana le pide
//! la lista y el texto por el bus de sesión. Con eso:
//!
//! - **Nunca toca una credencial.** No pide `account.email`, no ve una
//!   contraseña, no manda un `LOGIN`. Un `vasak-mail` reemplazado no llega a la
//!   casilla de nadie: no tiene con qué.
//! - No abre una segunda conexión contra el servidor de la persona. Hay
//!   servidores que cuentan las conexiones y cortan.
//! - El mensaje ya viene interpretado. El parser de MIME —que es lo que muerde
//!   lo que escribió un desconocido— vive del otro lado, en un proceso que no
//!   dibuja nada.
//!
//! Lo que llega acá igual **es texto que escribió cualquiera**: se muestra, no se
//! interpreta. Nada de esto se convierte en HTML ni se ejecuta.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri_plugin_vsk_store::{Error as StoreError, StoreClient, Verified};

const SERVICIO: &str = "ar.net.vasak.os.AccountsSync";
const RUTA: &str = "/ar/net/vasak/os/AccountsSync";
const INTERFAZ: &str = "ar.net.vasak.os.AccountsSync";

/// Una cuenta con correo, y cuánto tiene sin leer.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Cuenta {
    pub account_id: String,
    pub display_name: String,
    #[serde(default)]
    pub sin_leer: u32,
    /// Vacío si la cuenta anda. Si no, qué pasó — hay que poder decir «no se
    /// pudo» y no un cero que parece «no tenés correo».
    #[serde(default)]
    pub error: String,
}

/// Un archivo pegado a un mensaje.
///
/// El nombre viene **ya saneado** del sincronizador: sin separadores de ruta,
/// sin `..` y sin caracteres de control. Lo eligió quien mandó el mensaje, así
/// que se propone y no se obedece — el destino lo elige la persona.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Adjunto {
    /// El número de parte en el árbol MIME, para pedirla al servidor.
    pub parte: String,
    pub nombre: String,
    pub tipo: String,
}

/// Una carpeta del servidor.
///
/// `uso` es para qué sirve —`entrada`, `enviados`, `papelera`…— y lo calcula el
/// sincronizador, que es quien habla IMAP: sale de `SPECIAL-USE` cuando el
/// servidor lo anuncia y de comparar nombres conocidos cuando no.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Casilla {
    /// El nombre que se le manda al servidor.
    pub ruta: String,
    /// El nombre que se muestra, ya decodificado.
    pub nombre: String,
    pub uso: String,
    /// Si se puede abrir. Las que no, existen sólo como rama de la jerarquía.
    pub seleccionable: bool,
}

/// Un mensaje en la lista, sin su cuerpo.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Resumen {
    pub uid: u32,
    /// Cómo se firma quien lo mandó.
    pub de: String,
    /// Su dirección de verdad, aparte del nombre.
    ///
    /// **Las dos cosas se muestran.** Un remitente que se pone de nombre
    /// «soporte@banco.com» y escribe desde otra dirección es el fraude más común
    /// que hay; mostrar sólo el nombre es lo que lo hace funcionar.
    pub direccion: String,
    pub asunto: String,
    /// ISO 8601. Vacío si la fecha del mensaje no se entendió.
    pub fecha: String,
    pub sin_leer: bool,
    pub con_adjuntos: bool,
    /// El número del mensaje en el almacén del sistema, si salió de ahí. Es lo
    /// que permite abrirlo sin ir al servidor; `None` si la lista vino en vivo.
    #[serde(default)]
    pub store_id: Option<i64>,
}

/// El HTML de un mensaje, **ya saneado** por el sincronizador.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Sanitized {
    pub html: String,
    #[serde(default)]
    pub imagenes_bloqueadas: u32,
    #[serde(default)]
    pub recortado: bool,
}

/// Un mensaje abierto.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Abierto {
    pub texto: String,
    /// El mensaje era más largo de lo que se trae. Se dice: un texto que termina
    /// a la mitad sin explicación parece un mensaje roto.
    pub recortado: bool,
    /// Los archivos pegados: cuáles hay, cómo se llaman y qué número de parte
    /// tienen. Era un booleano —«trae algo»— y ahora es la lista.
    ///
    /// Se nombran aunque **todavía no se puedan abrir**: quien lee un mensaje y
    /// no se entera de que traía un archivo, lo pierde. Saber cuál es perderlo
    /// más despacio, pero el nombre es lo que después deja ir a buscarlo.
    ///
    /// **Si `recortado` es cierto, esta lista puede estar corta.** Se arma
    /// mirando lo que se trajo, y lo que se trae tiene tope: un adjunto que
    /// quedó más allá del corte no aparece. Lo cubre el aviso de que el mensaje
    /// está recortado, que la ventana ya tiene que dar igual.
    pub adjuntos: Vec<Adjunto>,
    /// El mismo mensaje con su formato, ya saneado, o `None` si no traía HTML.
    ///
    /// Faltaba en este tipo, y como lo que no está en el tipo se descarta al
    /// leer la respuesta, el HTML que mandaba el servicio nunca llegaba a la
    /// ventana: la vista con formato no aparecía nunca.
    #[serde(default)]
    pub con_formato: Option<Sanitized>,
    /// El identificador del mensaje, para enganchar la respuesta a la
    /// conversación. Vacío si el mensaje no traía uno, que pasa.
    #[serde(default)]
    pub message_id: String,
    #[serde(default)]
    pub referencias: Vec<String>,
    /// A dónde va la respuesta: el `Reply-To` si lo hay, y el remitente si no.
    #[serde(default)]
    pub responder_a: String,
    #[serde(default)]
    pub nombre: String,
}

/// Cuántos mensajes se piden del almacén por casilla: los mismos que mostraba
/// la lista en vivo.
const STORE_PAGE: u32 = 200;

/// El cliente del almacén de `tauri-plugin-vsk-store`, que comprueba que el
/// dueño del nombre del sincronizador sea el de verdad antes de creerle nada.
/// Se guarda una vez al arrancar ([`use_store`]).
static STORE: std::sync::OnceLock<Arc<StoreClient>> = std::sync::OnceLock::new();

/// Guarda el cliente del plugin. Lo llama `lib.rs` al arrancar.
pub fn use_store(client: Arc<StoreClient>) {
    let _ = STORE.set(client);
}

fn store() -> Result<Arc<StoreClient>, String> {
    STORE
        .get()
        .cloned()
        .ok_or_else(|| "el cliente del almacén todavía no está listo".to_string())
}

/// El mensaje de un error del plugin, con el nombre del error de D-Bus cuando
/// lo hay.
fn describe(metodo: &str, error: &StoreError) -> String {
    match error {
        StoreError::Store {
            name: Some(name), ..
        } => format!("{metodo}: {name}: {error}"),
        other => format!("{metodo}: {other}"),
    }
}

/// Lo que devuelve [`mensajes`] cuando la persona le dijo que no al almacén.
///
/// **No se traduce**: es una marca que mira la ventana para pintar el estado de
/// «sin permiso» con su botón, y el texto lo pone ella en el idioma de la sesión
/// (`src/tools/store-permission.ts`). Una frase traducida acá saldría en el
/// idioma con el que se compiló el programa, no en el de quien mira.
pub(crate) const STORE_PERMISSION_DENIED: &str = "store-permission-denied";

/// Si el error de una lectura del almacén es el «no» de la persona al permiso.
///
/// Es `org.freedesktop.DBus.Error.AccessDenied` —el único que
/// `vasak-permissions` le devuelve al almacén cuando la decisión guardada es
/// «no»— tal como lo deja [`describe`]. Se distingue a propósito del
/// **fail-closed del chequeo de dueño**: cuando el nombre del sincronizador lo
/// tiene un impostor, o no lo tiene nadie, el plugin devuelve
/// [`StoreError::Impostor`] / [`StoreError::NotRunning`] —motivo «no disponible»,
/// nunca «denegado»—, y ésos **no** son un «sin permiso»: ahí la ventana va al
/// servidor, no muestra el botón de volver a pedir. Mismo criterio que
/// `StoreError::is_denied`.
pub(crate) fn denied_by_store(error: &str) -> bool {
    error.contains("org.freedesktop.DBus.Error.AccessDenied")
}

/// Llama a la interfaz en vivo del sincronizador —abrir, marcar, **mandar
/// correo**—, por el dueño comprobado: mandarle un correo a un impostor sería
/// peor que leerle datos inventados.
async fn llamar<A>(metodo: &str, argumentos: &A) -> Result<String, String>
where
    A: serde::ser::Serialize + zbus::zvariant::DynamicType,
{
    store()?
        .call_on(RUTA, INTERFAZ, metodo, argumentos)
        .await
        .map_err(|e| describe(metodo, &e))
}

/// Lo mismo, para los métodos que no contestan nada.
async fn llamar_sin_respuesta<A>(metodo: &str, argumentos: &A) -> Result<(), String>
where
    A: serde::ser::Serialize + zbus::zvariant::DynamicType,
{
    store()?
        .call_on::<_, ()>(RUTA, INTERFAZ, metodo, argumentos)
        .await
        .map_err(|e| describe(metodo, &e))
}

/// Llama a un método del almacén.
///
/// **Sin tope de tiempo** a propósito: la primera lectura puede abrir el
/// diálogo de permiso de `vasak-permissions`, y la respuesta llega cuando la
/// persona lo cierra.
async fn call_store<A>(metodo: &str, argumentos: &A) -> Result<String, String>
where
    A: serde::ser::Serialize + zbus::zvariant::DynamicType,
{
    store()?
        .call_json(metodo, argumentos)
        .await
        .map_err(|e| describe(metodo, &e))
}

/// Una casilla tal como la guarda el almacén.
#[derive(Debug, Clone, Deserialize)]
struct StoredMailbox {
    id: i64,
    name: String,
    display_name: String,
    role: String,
}

/// Un mensaje de la lista del almacén.
#[derive(Debug, Clone, Deserialize)]
struct StoredSummary {
    id: i64,
    uid: u64,
    from_addr: String,
    subject: String,
    date_ts: i64,
    flags_seen: bool,
    has_attachments: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct StoredPage {
    items: Vec<StoredSummary>,
}

/// Un adjunto como lo guarda el almacén.
#[derive(Debug, Clone, Deserialize)]
struct StoredAttachment {
    part_number: String,
    #[serde(default)]
    name: Option<String>,
    content_type: String,
}

/// Un mensaje entero del almacén.
#[derive(Debug, Clone, Deserialize)]
struct StoredMessage {
    /// De qué casilla y con qué UID: el número del almacén se reusa cuando la
    /// ventana de sincronización corre, así que hay que comprobar que es el
    /// mensaje que se pidió.
    #[serde(default)]
    uid: u64,
    #[serde(default)]
    mailbox_name: String,
    #[serde(default)]
    message_id: Option<String>,
    from_addr: String,
    #[serde(default)]
    reply_to: Option<String>,
    #[serde(default)]
    text_body: Option<String>,
    #[serde(default)]
    html_body: Option<String>,
    #[serde(default)]
    truncated: bool,
    #[serde(default)]
    attachments: Vec<StoredAttachment>,
}

/// Si lo que contestó el almacén es el mensaje que se pidió: misma casilla y
/// mismo UID. La de entrada se compara sin mayúsculas, como la pide IMAP.
fn is_requested(m: &StoredMessage, casilla: &str, uid: u32) -> bool {
    m.uid == u64::from(uid)
        && (m.mailbox_name == casilla
            || (casilla.eq_ignore_ascii_case("INBOX")
                && m.mailbox_name.eq_ignore_ascii_case("INBOX")))
}

/// Cuántas imágenes remotas bloqueó el saneador del servicio: cada una dejó su
/// dirección en `data-vsk-src` (`REMOTE_SRC_ATTRIBUTE` de `html.rs`).
fn blocked_images(html: &str) -> u32 {
    u32::try_from(html.matches("data-vsk-src=").count()).unwrap_or(u32::MAX)
}

/// El uso de una casilla, en las palabras de la ventana, a partir del rol que
/// guarda el almacén.
pub fn usage_for_role(rol: &str) -> &'static str {
    match rol {
        "inbox" => "entrada",
        "sent" => "enviados",
        "drafts" => "borradores",
        "trash" => "papelera",
        "junk" => "spam",
        "archive" => "archivo",
        _ => "ninguno",
    }
}

/// Separa `Nombre <dirección>` en sus dos partes, como las muestra la lista:
/// el nombre **y** la dirección, nunca sólo el nombre.
pub fn split_sender(texto: &str) -> (String, String) {
    let texto = texto.trim();
    if let (Some(abre), true) = (texto.rfind('<'), texto.ends_with('>')) {
        let nombre = texto[..abre].trim().trim_matches('"').trim().to_string();
        let direccion = texto[abre + 1..texto.len() - 1].trim().to_string();
        let nombre = if nombre.is_empty() {
            direccion.clone()
        } else {
            nombre
        };
        return (nombre, direccion);
    }
    (texto.to_string(), texto.to_string())
}

/// La fecha en ISO 8601, o vacía si el almacén no la entendió (`0`).
pub fn iso_date(segundos: i64) -> String {
    if segundos <= 0 {
        return String::new();
    }
    chrono::DateTime::from_timestamp(segundos, 0)
        .map(|f| f.to_rfc3339())
        .unwrap_or_default()
}

/// Busca en lo guardado la casilla que la ventana pide por su ruta. La de
/// entrada se compara sin mayúsculas: el estándar dice que `INBOX` se escribe
/// como se quiera.
fn find_stored_mailbox<'a>(
    guardadas: &'a [StoredMailbox],
    ruta: &str,
) -> Option<&'a StoredMailbox> {
    guardadas.iter().find(|c| {
        c.name == ruta
            || (ruta.eq_ignore_ascii_case("INBOX") && c.name.eq_ignore_ascii_case("INBOX"))
    })
}

async fn stored_mailboxes(account_id: &str) -> Result<Vec<StoredMailbox>, String> {
    let json = call_store("ListMailboxes", &(account_id,)).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudieron leer las carpetas: {e}"))
}

/// Lo que el almacén tenía para una casilla. Partido en tres porque las tres
/// respuestas llevan a la ventana a lugares distintos.
enum StoredMessages {
    /// El almacén los tiene —vacío incluido—: es lo que se muestra.
    Hit(Vec<Resumen>),
    /// El almacén no los tiene todavía —el área no se encendió, la primera
    /// vuelta no terminó, el llavero está bloqueado, el servicio no está—: la
    /// ventana va al servidor.
    Miss,
    /// La persona le dijo que no al almacén: la ventana muestra «sin permiso»
    /// con el botón para volver a pedirlo, sin ir al servidor por detrás.
    Denied,
}

/// Los mensajes de una casilla, **del almacén**.
///
/// [`StoredMessages::Miss`] cuando el almacén no los tiene y hay que ir al
/// servidor; [`StoredMessages::Denied`] cuando el «no» al permiso es lo que
/// lo impide ([`denied_by_store`]), que no es lo mismo: ahí no se va al
/// servidor, se ofrece volver a pedir el permiso.
async fn stored_messages(account_id: &str, casilla: &str) -> StoredMessages {
    let guardadas = match stored_mailboxes(account_id).await {
        Ok(guardadas) => guardadas,
        Err(e) if denied_by_store(&e) => return StoredMessages::Denied,
        Err(_) => return StoredMessages::Miss,
    };
    let Some(id) = find_stored_mailbox(&guardadas, casilla).map(|c| c.id) else {
        return StoredMessages::Miss;
    };
    match call_store("ListMessages", &(account_id, id, "", STORE_PAGE)).await {
        Ok(json) => match summaries_from_page(&json) {
            Some(lista) => StoredMessages::Hit(lista),
            None => StoredMessages::Miss,
        },
        Err(e) if denied_by_store(&e) => StoredMessages::Denied,
        Err(_) => StoredMessages::Miss,
    }
}

/// La lista de una página de `ListMessages`. Vacía también vale: la casilla
/// está en el almacén y no tiene nada, e ir al servidor cada vez que se abre
/// una carpeta vacía sería justo lo que el almacén viene a evitar. `None`
/// sólo si la respuesta no se entiende.
fn summaries_from_page(json: &str) -> Option<Vec<Resumen>> {
    let pagina: StoredPage = serde_json::from_str(json).ok()?;
    Some(
        pagina
            .items
            .into_iter()
            .filter_map(summary_from_store)
            .collect(),
    )
}

/// Un resumen de la lista a partir de uno del almacén.
fn summary_from_store(m: StoredSummary) -> Option<Resumen> {
    let (de, direccion) = split_sender(&m.from_addr);
    Some(Resumen {
        uid: u32::try_from(m.uid).ok()?,
        de,
        direccion,
        asunto: m.subject,
        fecha: iso_date(m.date_ts),
        sin_leer: !m.flags_seen,
        con_adjuntos: m.has_attachments,
        store_id: Some(m.id),
    })
}

/// Un mensaje abierto a partir de uno del almacén, si ya tiene su cuerpo.
fn opened_from_store(m: StoredMessage) -> Option<Abierto> {
    let texto = m.text_body?;
    let (nombre, direccion) = split_sender(&m.from_addr);
    let responder_a = m
        .reply_to
        .filter(|r| !r.trim().is_empty())
        .map(|r| split_sender(&r).1)
        .unwrap_or(direccion);
    Some(Abierto {
        texto,
        recortado: m.truncated,
        adjuntos: m
            .attachments
            .into_iter()
            .map(|a| Adjunto {
                nombre: a
                    .name
                    .unwrap_or_else(|| format!("adjunto-{}", a.part_number)),
                parte: a.part_number,
                tipo: a.content_type,
            })
            .collect(),
        con_formato: m.html_body.map(|html| Sanitized {
            // Las imágenes que el saneador bloqueó quedan marcadas en el HTML
            // guardado: contarlas es lo que hace aparecer el botón de traerlas.
            imagenes_bloqueadas: blocked_images(&html),
            html,
            recortado: m.truncated,
        }),
        message_id: m.message_id.unwrap_or_default(),
        // El almacén no guarda la cadena de `References`: la respuesta se
        // engancha igual por `In-Reply-To`.
        referencias: Vec::new(),
        responder_a,
        nombre,
    })
}

/// Las cuentas que tienen correo, con su contador de sin leer.
pub async fn cuentas() -> Result<Vec<Cuenta>, String> {
    let json = llamar("MailboxStatus", &()).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudo leer la lista de cuentas: {e}"))
}

/// Las casillas de una cuenta.
///
/// Del almacén si las tiene; si no, del servidor.
pub async fn casillas(account_id: &str) -> Result<Vec<Casilla>, String> {
    if let Ok(guardadas) = stored_mailboxes(account_id).await {
        if !guardadas.is_empty() {
            return Ok(guardadas
                .into_iter()
                .map(|c| Casilla {
                    uso: usage_for_role(&c.role).to_string(),
                    ruta: c.name,
                    nombre: c.display_name,
                    seleccionable: true,
                })
                .collect());
        }
    }
    let json = llamar("ListMailboxes", &(account_id,)).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudieron leer las carpetas: {e}"))
}

/// Los últimos mensajes de una casilla.
///
/// La casilla va siempre, incluso para la de entrada: los **UID son por
/// casilla**, así que pedir mensajes sin decir de dónde es pedir cualquiera.
///
/// **Primero del almacén del sistema**, que ya está en disco y no espera a la
/// red; el sincronizador lo mantiene al día en segundo plano. Sólo si el
/// almacén no tiene esa casilla se le pregunta al servidor.
pub async fn mensajes(account_id: &str, casilla: &str) -> Result<Vec<Resumen>, String> {
    match stored_messages(account_id, casilla).await {
        StoredMessages::Hit(guardados) => return Ok(guardados),
        // El «no» al almacén no se tapa yendo al servidor: la ventana lo
        // muestra como «sin permiso» y ofrece volver a pedirlo.
        StoredMessages::Denied => return Err(STORE_PERMISSION_DENIED.to_string()),
        StoredMessages::Miss => {}
    }
    let json = llamar("ListMessages", &(account_id, casilla)).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudo leer el correo: {e}"))
}

/// Busca en una casilla, del lado del servidor.
///
/// `terminos` es JSON con lo que se busca —**qué**, no un criterio de IMAP—:
/// el criterio lo arma el sincronizador. Ver `sync/src/consulta.rs`.
/// Una imagen de un mensaje, ya traída por el servicio.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct Imagen {
    /// El tipo, tal como lo aceptó el servicio y no como lo dijo el servidor.
    pub tipo: String,
    pub base64: String,
}

/// Trae una imagen de un mensaje.
///
/// **La pide el servicio, no esta ventana**, y ése es el punto: una petición
/// hecha desde el motor que dibuja esto llevaría el idioma de la sesión, el
/// tamaño de la ventana y las galletas guardadas, y la dirección la puso quien
/// mandó el correo. Ver `imagenes.rs` del sincronizador.
pub async fn imagen(url: &str) -> Result<Imagen, String> {
    let json = llamar("FetchImage", &(url,)).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudo leer la imagen: {e}"))
}

pub async fn buscar(
    account_id: &str,
    casilla: &str,
    terminos: &str,
) -> Result<Vec<Resumen>, String> {
    let json = llamar("SearchMessages", &(account_id, casilla, terminos)).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudo leer la búsqueda: {e}"))
}

/// El texto de un mensaje.
///
/// Del almacén si ya tiene el cuerpo —el sincronizador trae en segundo plano
/// los de lo más nuevo de la bandeja de entrada—; si no, del servidor en el
/// momento.
pub async fn open_message(
    account_id: &str,
    casilla: &str,
    uid: u32,
    store_id: Option<i64>,
) -> Result<Abierto, String> {
    if let Some(id) = store_id {
        if let Ok(json) = call_store("GetMessage", &(account_id, id)).await {
            if let Ok(Some(guardado)) = serde_json::from_str::<Option<StoredMessage>>(&json) {
                if !is_requested(&guardado, casilla, uid) {
                    // Otro mensaje con el mismo número: se va al servidor por
                    // el que se pidió.
                } else if let Some(abierto) = opened_from_store(guardado) {
                    return Ok(abierto);
                }
            }
        }
    }
    let json = llamar("GetMessage", &(account_id, casilla, uid)).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudo leer el mensaje: {e}"))
}

/// Marca un mensaje como leído en el servidor.
///
/// Lo pide la ventana **explícitamente** y no pasa por haberlo abierto en el
/// panel: el sincronizador trae todo con `BODY.PEEK`, que mira sin marcar. Que
/// pasar por encima de un mensaje con las flechas te vacíe el contador de sin
/// leer es de los errores más molestos que puede tener un cliente de correo.
pub async fn marcar_leido(account_id: &str, casilla: &str, uid: u32) -> Result<(), String> {
    llamar_sin_respuesta("MarkRead", &(account_id, casilla, uid))
        .await
        .map_err(|e| format!("no se pudo marcar como leído: {e}"))
}

/// Un archivo para pegar a un mensaje, ya leído.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct AdjuntoParaMandar {
    pub nombre: String,
    pub tipo: String,
    /// El contenido en base64, que es como lo espera el servicio y como va a
    /// salir en el mensaje.
    pub contenido: String,
    /// Cuánto pesa el archivo de verdad, para poder decirlo.
    pub bytes: u64,
}

/// Lo que devuelve el servicio al pedir un adjunto.
#[derive(Debug, Clone, Deserialize)]
struct AdjuntoBajado {
    /// El contenido, en base64.
    contenido: String,
    /// Si el servidor mandó justo el tope: puede faltar el final.
    #[serde(default)]
    recortado: bool,
}

/// Baja un adjunto y lo escribe donde la persona haya elegido.
///
/// **Escribe esta aplicación y no el servicio.** El servicio corre como la
/// persona y podría escribir en cualquier archivo suyo; pasarle una ruta sería
/// dejar que la ventana elija dónde escribe. La regla es la misma que para
/// mandar, al revés: el proceso que toca el disco es aquel cuyo dueño eligió la
/// ruta.
///
/// Devuelve si el archivo puede estar cortado, para que la ventana lo diga.
/// Guardar un archivo incompleto sin avisar deja algo que no abre ningún
/// programa y ninguna explicación de por qué.
pub async fn guardar_adjunto(
    account_id: &str,
    casilla: &str,
    uid: u32,
    parte: &str,
    destino: &str,
) -> Result<bool, String> {
    use base64::Engine;

    let json = llamar("GetAttachment", &(account_id, casilla, uid, parte)).await?;
    let bajado: AdjuntoBajado =
        serde_json::from_str(&json).map_err(|e| format!("no se pudo leer el adjunto: {e}"))?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bajado.contenido.as_bytes())
        .map_err(|e| format!("el adjunto llegó mal: {e}"))?;

    escribir_entero(std::path::Path::new(destino), &bytes)?;
    Ok(bajado.recortado)
}

/// Escribe un archivo **entero o nada**.
///
/// `std::fs::write` abre con `truncate`, así que vacía el archivo que había
/// antes de escribir el primer byte: si el disco se llena a mitad de camino, lo
/// que queda es el archivo viejo destruido y el nuevo a medias. Guardar un
/// adjunto encima de algo que ya estaba no puede tener ese final.
///
/// Se escribe a un temporal en el **mismo directorio** —otro sistema de
/// archivos haría que `rename` no sea atómico— y recién con todos los bytes en
/// disco se reemplaza el destino.
///
/// El nombre del temporal no sale del destino ni de nada que haya elegido otro:
/// derivarlo del nombre del adjunto sería volver a meter en una ruta algo que
/// escribió quien mandó el mensaje.
fn escribir_entero(destino: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;

    let directorio = destino
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));
    let unico = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temporal = directorio.join(format!(".vasak-mail-{unico}-{}", std::process::id()));

    let escritura = (|| -> std::io::Result<()> {
        let mut archivo = std::fs::File::create(&temporal)?;
        archivo.write_all(bytes)?;
        // Antes del `rename`: sin esto el nombre nuevo puede quedar apuntando a
        // un archivo cuyo contenido todavía no llegó al disco.
        archivo.sync_all()
    })();

    if let Err(e) = escritura {
        // El temporal queda a medias y no le sirve a nadie. Si tampoco se puede
        // borrar, no se pisa el error de verdad con el de la limpieza.
        let _ = std::fs::remove_file(&temporal);
        return Err(format!("no se pudo guardar: {e}"));
    }

    std::fs::rename(&temporal, destino).map_err(|e| {
        let _ = std::fs::remove_file(&temporal);
        format!("no se pudo guardar: {e}")
    })
}

/// Lee un archivo para adjuntarlo.
///
/// **Lo lee esta aplicación y no el servicio.** El servicio corre como la
/// persona y podría leer cualquier archivo suyo; pasarle una ruta sería dejar
/// que la ventana elija qué lee. Acá la ruta la eligió la persona en el diálogo
/// del sistema, que es lo que hace que sea suya.
///
/// El tope es del tamaño del archivo y no del mensaje armado. Un archivo de
/// veinte megas son casi veintisiete en base64, y casi todos los servidores de
/// correo cortan en veinticinco: mejor decirlo antes de leerlo entero que
/// después de que el servidor lo rechace.
pub fn leer_adjunto(ruta: &str) -> Result<AdjuntoParaMandar, String> {
    use base64::Engine;

    const MAXIMO: u64 = 20 * 1024 * 1024;

    let camino = std::path::Path::new(ruta);
    let datos =
        std::fs::metadata(camino).map_err(|e| format!("no se pudo leer el archivo: {e}"))?;
    if !datos.is_file() {
        return Err("eso no es un archivo".into());
    }
    if datos.len() > MAXIMO {
        return Err(format!(
            "el archivo pesa {} MB y el máximo son {} MB",
            datos.len() / (1024 * 1024),
            MAXIMO / (1024 * 1024)
        ));
    }

    let crudo = std::fs::read(camino).map_err(|e| format!("no se pudo leer el archivo: {e}"))?;

    Ok(AdjuntoParaMandar {
        // Sólo el nombre, nunca la ruta: el destinatario no tiene por qué
        // enterarse de en qué carpeta estaba el archivo.
        nombre: camino
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "adjunto".into()),
        // Vacío para que lo decida el servicio por la extensión, que es donde
        // vive esa tabla.
        tipo: String::new(),
        contenido: base64::engine::general_purpose::STANDARD.encode(&crudo),
        bytes: datos.len(),
    })
}

/// Lo que la persona escribió, camino al servicio.
///
/// **Sin el `De`**: lo pone el servicio con la dirección de la cuenta. Que lo
/// eligiera la ventana permitiría mandar desde una dirección que no es la que
/// autentica, y eso hace que el servidor rechace — o peor, que el mensaje llegue
/// y lo marquen como falsificado.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Borrador {
    pub para: Vec<String>,
    #[serde(default)]
    pub cc: Vec<String>,
    #[serde(default)]
    pub asunto: String,
    #[serde(default)]
    pub cuerpo: String,
    /// El `Message-ID` del mensaje al que se responde. Es lo que engancha la
    /// respuesta a la conversación en el cliente de quien la recibe.
    #[serde(default)]
    pub en_respuesta_a: String,
    #[serde(default)]
    pub referencias: Vec<String>,
}

/// Un mensaje esperando salir.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Saliente {
    pub id: String,
    pub account_id: String,
    pub borrador: Borrador,
    #[serde(default)]
    pub intentos: u32,
    /// `pendiente` o `trabado`. Trabado quiere decir que no se vuelve a
    /// intentar solo y que hace falta que la persona haga algo.
    #[serde(default)]
    pub estado: String,
    #[serde(default)]
    pub ultimo_error: String,
    /// Si está esperando la hora que se le pidió, en vez de estar saliendo.
    ///
    /// Lo calcula el servicio: la regla —vacío, ilegible, o ya pasó— vive
    /// **ahí** y no acá, porque en dos lados se separa.
    #[serde(default)]
    pub esperando_su_hora: bool,
}

/// Pone un mensaje en la cola de salida.
///
/// **Encola, no manda**: vuelve en cuanto el mensaje está a salvo en el disco
/// del servicio. Que apretar «Enviar» no espere al servidor es lo que hace que
/// cerrar la ventana, o quedarse sin luz, no pierda lo que se escribió.
///
/// Lo que sí vuelve en el acto es el rechazo de un borrador que no se puede
/// armar —una dirección mal escrita—, que es lo que hay que decir mientras la
/// persona lo tiene en pantalla.
///
/// `no_antes_de` es una hora en RFC 3339, o vacío para «cuando se pueda». Es lo
/// que da la ventana para arrepentirse: se encola pidiendo que no salga antes
/// de dentro de unos segundos, y deshacer es sacarlo de la cola a tiempo.
pub async fn enviar(
    account_id: &str,
    borrador: &Borrador,
    no_antes_de: &str,
) -> Result<String, String> {
    let json = serde_json::to_string(borrador)
        .map_err(|e| format!("no se pudo preparar el mensaje: {e}"))?;
    llamar("SendMessage", &(account_id, json.as_str(), no_antes_de)).await
}

/// Lo que está esperando salir.
pub async fn salientes() -> Result<Vec<Saliente>, String> {
    let json = llamar("ListOutbox", &()).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudo leer la cola de salida: {e}"))
}

/// Saca un mensaje de la cola sin mandarlo. **Se pierde lo escrito.**
pub async fn descartar(id: &str) -> Result<(), String> {
    llamar_sin_respuesta("DiscardOutgoing", &(id,))
        .await
        .map_err(|e| format!("no se pudo descartar: {e}"))
}

/// El evento que ve la ventana cuando llega correo.
pub const EVENTO: &str = "correo-cambio";

/// Escucha al sincronizador y le avisa a la ventana.
///
/// Sin esto habría que apretar «Actualizar» para enterarse de algo que el
/// servicio ya sabe: mantiene una conexión abierta con el servidor esperando el
/// aviso, justamente para que el correo nuevo aparezca en el momento. Tirarlo por
/// la borda con un sondeo cada tantos segundos sería gastar batería para
/// enterarse más tarde.
///
/// Se traducen las tres señales: `MessagesChanged` es que cambió la lista,
/// `MailboxChanged` que cambió el contador y `OutboxChanged` que algo salió o se
/// trabó. Las tres quieren decir lo mismo para esta ventana —volvé a leer— y
/// ninguna trae detalle, a propósito: quien la recibe relee y ve el estado
/// completo, en vez de reconciliar avisos que se pueden perder.
pub fn escuchar(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        // **En bucle, no una sola vez.** El bus de sesión se puede cortar —se
        // reinicia el servicio, se reinicia el bus— y con un solo intento la
        // ventana se quedaba sin avisos hasta que alguien cerrara y volviera a
        // abrir la aplicación. El síntoma sería correo que deja de aparecer solo
        // y nada que lo explique.
        let owner_changed = &OWNER_CHANGED;
        loop {
            if let Err(e) = seguir(&app).await {
                // Que no se pueda escuchar no rompe nada: el botón de actualizar
                // sigue estando. Queda dicho para que no parezca que el correo
                // nuevo no llega por otro motivo.
                //
                // A stderr, que en una sesión de escritorio termina en el diario
                // del sistema. El plugin del diario cubre los pánicos; esto no
                // lo es —la ventana sigue andando— y aun así hay que poder verlo.
                eprintln!("[correo] no se pueden recibir avisos de correo nuevo: {e}");
            }
            // Con espera, o un bus que no está recibe un intento por milisegundo
            // y la ventana gasta más batería reconectando que mostrando correo.
            // Salvo cuando el nombre cambió de dueño: ahí el bus está, y cada
            // segundo sin escuchar es correo nuevo que la ventana no ve.
            tokio::time::sleep(ESPERA_TRAS_CAMBIO_DE_DUENO).await;
            if !owner_changed.swap(false, std::sync::atomic::Ordering::Relaxed) {
                tokio::time::sleep(ESPERA_ENTRE_INTENTOS - ESPERA_TRAS_CAMBIO_DE_DUENO).await;
            }
        }
    });
}

/// Cuánto se juntan los avisos seguidos antes de pasarlos a la ventana.
const SETTLE: std::time::Duration = std::time::Duration::from_millis(500);

/// Cuánto se espera antes de volver a engancharse a los avisos.
///
/// Quince segundos: corto para que reconectar no se note, y largo para no
/// martillar un bus que no está.
const ESPERA_ENTRE_INTENTOS: std::time::Duration = std::time::Duration::from_secs(15);

/// Cuánto se espera si la escucha terminó porque el nombre cambió de dueño:
/// lo justo para que el dueño nuevo termine de arrancar.
const ESPERA_TRAS_CAMBIO_DE_DUENO: std::time::Duration = std::time::Duration::from_secs(1);

/// Si la última escucha terminó por un cambio de dueño del nombre.
static OWNER_CHANGED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Las señales del correo en vivo, sólo del dueño comprobado del nombre del
/// sincronizador y de su objeto: cualquier proceso de la sesión puede emitir
/// una señal con esta interfaz.
fn live_rule(owner: &Verified, member: &'static str) -> zbus::Result<zbus::MatchRule<'static>> {
    Ok(zbus::MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .sender(owner.owner.clone())?
        .path(RUTA)?
        .interface(INTERFAZ)?
        .member(member)?
        .build())
}

/// La señal del bus de que el nombre del sincronizador cambió de dueño: hay
/// que volver a comprobar antes de creerle nada al nuevo.
fn owner_rule() -> zbus::Result<zbus::MatchRule<'static>> {
    Ok(zbus::MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .sender("org.freedesktop.DBus")?
        .interface("org.freedesktop.DBus")?
        .member("NameOwnerChanged")?
        .arg(0, SERVICIO)?
        .build())
}

async fn seguir(app: &tauri::AppHandle) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    let client = store()?;
    let owner = client.verified().await.map_err(|e| e.to_string())?;
    let conexion = &owner.connection;

    // Un flujo por señal, con su regla de coincidencia. La regla se le pide al
    // bus para que no despierte a este proceso por cada mensaje que pasa por la
    // sesión, que son muchos. Lo que cambia en el almacén y en su estado lo
    // avisa `tauri-plugin-vsk-store`.
    let mut flujos = Vec::new();
    for señal in ["MessagesChanged", "MailboxChanged", "OutboxChanged"] {
        let regla = live_rule(&owner, señal)
            .map_err(|e| format!("no se pudo armar el filtro de «{señal}»: {e}"))?;
        let flujo = zbus::MessageStream::for_match_rule(regla, conexion, None)
            .await
            .map_err(|e| format!("no se pudo escuchar «{señal}»: {e}"))?;
        flujos.push(flujo.map(|m| m.map(|_| false)).boxed());
    }
    let dueno = zbus::MessageStream::for_match_rule(
        owner_rule().map_err(|e| format!("no se pudo armar el filtro del dueño: {e}"))?,
        conexion,
        None,
    )
    .await
    .map_err(|e| format!("no se pudo escuchar al dueño del nombre: {e}"))?;
    flujos.push(dueno.map(|m| m.map(|_| true)).boxed());
    let mut avisos = futures_util::stream::select_all(flujos);

    while let Some(aviso) = avisos.next().await {
        let Ok(owner_changed) = aviso else {
            continue;
        };
        // Se juntan los que llegan seguidos: la ventana relee una vez. Sin
        // detalle: el evento dice «volvé a leer», y la ventana relee y ve el
        // estado completo.
        let mut changed = !owner_changed;
        let mut gone = owner_changed;
        if !gone {
            tokio::time::sleep(SETTLE).await;
        }
        while let Some(Some(next)) = futures_util::FutureExt::now_or_never(avisos.next()) {
            match next {
                Ok(true) => gone = true,
                Ok(false) => changed = true,
                Err(_) => {}
            }
        }
        if changed {
            let _ = app.emit(EVENTO, ());
        }
        if gone {
            // Otro tiene el nombre, o se fue: se vuelve a comprobar desde cero.
            client.forget().await;
            OWNER_CHANGED.store(true, std::sync::atomic::Ordering::Relaxed);
            return Err("el nombre del sincronizador cambió de dueño".into());
        }
    }

    Err("el bus de sesión cerró la conexión".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **El límite de esta aplicación**, escrito como test para que sacarlo sea
    /// una decisión y no un descuido.
    ///
    /// No hay ninguna capacidad que pedir acá, y eso es el punto: el correo
    /// llega ya leído desde el sincronizador. Si algún día aparece un
    /// `account.email` en este archivo, quiere decir que la ventana empezó a
    /// hablar IMAP por su cuenta — y con eso se pierde la propiedad de que la
    /// aplicación más expuesta del escritorio no tenga ninguna credencial.
    #[test]
    fn esta_aplicacion_no_pide_ninguna_capacidad() {
        // Se busca la cadena **entre comillas**, que es la única forma de que
        // una capacidad llegue a un pedido de verdad. Nombrarla en un comentario
        // —como los de este archivo, que explican justamente que no se pide— no
        // dispara nada.
        let entre_comillas = format!("{}account.", '"');
        for archivo in [
            include_str!("correo.rs"),
            include_str!("comandos.rs"),
            include_str!("lib.rs"),
        ] {
            assert!(
                !archivo.contains(&entre_comillas),
                "apareció una capacidad donde no debería haber ninguna"
            );
        }
    }

    /// El «no» de la persona al almacén se reconoce por el nombre del error de
    /// D-Bus que deja [`describe`], y **sólo** ése.
    #[test]
    fn el_no_al_almacen_es_access_denied() {
        assert!(denied_by_store(
            "ListMessages: org.freedesktop.DBus.Error.AccessDenied: sin permiso"
        ));
    }

    /// El fail-closed del chequeo de dueño —impostor, o nadie con el nombre— no
    /// es un «sin permiso»: ahí la ventana va al servidor, no ofrece el botón.
    /// Son los mensajes de `StoreError::Impostor` / `NotRunning` tal como los
    /// deja [`describe`].
    #[test]
    fn el_fail_closed_del_dueno_no_es_un_no_al_permiso() {
        assert!(!denied_by_store(
            "ListMessages: el nombre del servicio de sincronización lo tiene otro programa"
        ));
        assert!(!denied_by_store(
            "ListMessages: el servicio de sincronización no está funcionando"
        ));
    }

    /// Cualquier otro fallo del almacén tampoco: un error de límite, uno de
    /// servicio desconocido, o uno sin nombre, llevan al servidor, no al botón.
    #[test]
    fn los_demas_fallos_del_almacen_no_son_un_no_al_permiso() {
        assert!(!denied_by_store(
            "ListMessages: org.freedesktop.DBus.Error.LimitsExceeded: esperá"
        ));
        assert!(!denied_by_store(
            "ListMessages: org.freedesktop.DBus.Error.ServiceUnknown: no está"
        ));
        assert!(!denied_by_store(
            "ListMessages: respuesta inválida del almacén"
        ));
    }

    #[test]
    fn se_lee_lo_que_publica_el_sincronizador() {
        let json = r#"[
            {"account_id":"a","display_name":"Trabajo","mensajes":120,"sin_leer":3,"error":""},
            {"account_id":"b","display_name":"Casa","mensajes":0,"sin_leer":0,"error":"no se pudo"}
        ]"#;
        let cuentas: Vec<Cuenta> = serde_json::from_str(json).unwrap();

        assert_eq!(cuentas[0].sin_leer, 3);
        assert_eq!(cuentas[0].error, "");
        // El error viaja: hay que poder decir «no se pudo» y no un cero que
        // parece «no tenés correo».
        assert_eq!(cuentas[1].error, "no se pudo");
    }

    /// Los campos vienen del sincronizador tal como los nombra; si alguno se
    /// renombrara de un lado y no del otro, la lista aparecería vacía sin ningún
    /// error. Este test es el que lo diría.
    #[test]
    fn el_resumen_de_un_mensaje_se_lee_entero() {
        let json = r#"{
            "uid": 42, "de": "Ana Pérez", "direccion": "ana@ejemplo.com",
            "asunto": "Reunión", "fecha": "2026-09-15T14:30:00+00:00",
            "sin_leer": true, "con_adjuntos": false
        }"#;
        let resumen: Resumen = serde_json::from_str(json).unwrap();

        assert_eq!(resumen.uid, 42);
        assert_eq!(resumen.de, "Ana Pérez");
        assert_eq!(resumen.direccion, "ana@ejemplo.com");
        assert!(resumen.sin_leer);
    }

    #[test]
    fn un_mensaje_abierto_dice_si_se_corto_y_si_trae_algo() {
        let json = r#"{"texto":"Hola","recortado":true,"adjuntos":[{"parte":"2","nombre":"x.pdf","tipo":"application/pdf"}]}"#;
        let abierto: Abierto = serde_json::from_str(json).unwrap();

        assert_eq!(abierto.texto, "Hola");
        assert!(abierto.recortado);
        assert_eq!(abierto.adjuntos.len(), 1);
        assert_eq!(abierto.adjuntos[0].nombre, "x.pdf");
        // Y lo de responder puede no venir: un mensaje sin `Message-ID` existe.
        assert_eq!(abierto.message_id, "");
    }

    /// Sin esto la respuesta llega como un mensaje suelto y la conversación se
    /// parte en el cliente de quien la recibe.
    #[test]
    fn un_mensaje_abierto_trae_con_que_responderlo() {
        let json = r#"{
            "texto": "Hola", "recortado": false, "adjuntos": [],
            "message_id": "<a@x>", "referencias": ["<a@x>"],
            "responder_a": "ana@ejemplo.com", "nombre": "Ana"
        }"#;
        let abierto: Abierto = serde_json::from_str(json).unwrap();

        assert_eq!(abierto.message_id, "<a@x>");
        assert_eq!(abierto.responder_a, "ana@ejemplo.com");
        assert_eq!(abierto.referencias, vec!["<a@x>"]);
    }

    /// Un mensaje real trae las dos cosas a la vez: adjuntos **y** con qué
    /// responderlo. Los dos tests de arriba miran una mitad cada uno, y así una
    /// mitad puede quedarse con la forma vieja del otro lado sin que nada se
    /// queje — que es exactamente lo que pasó cuando `adjuntos` dejó de ser un
    /// booleano. Éste lee la carga entera, tal como la arma el sincronizador.
    #[test]
    fn un_mensaje_con_adjuntos_tambien_se_puede_responder() {
        let json = r#"{
            "texto": "Te mando el presupuesto.", "recortado": false,
            "adjuntos": [{"parte":"2","nombre":"presupuesto.pdf","tipo":"application/pdf"}],
            "message_id": "<b@x>", "referencias": ["<a@x>", "<b@x>"],
            "responder_a": "ana@ejemplo.com", "nombre": "Ana"
        }"#;
        let abierto: Abierto = serde_json::from_str(json).unwrap();

        assert_eq!(abierto.adjuntos[0].nombre, "presupuesto.pdf");
        assert_eq!(abierto.adjuntos[0].parte, "2");
        assert_eq!(abierto.responder_a, "ana@ejemplo.com");
        assert_eq!(abierto.referencias, vec!["<a@x>", "<b@x>"]);
    }

    /// El borrador viaja sin el `De`: lo pone el servicio con la dirección de
    /// la cuenta. Que lo eligiera la ventana permitiría mandar desde una
    /// dirección que no es la que autentica.
    #[test]
    fn el_borrador_no_lleva_el_remitente() {
        let borrador = Borrador {
            para: vec!["juan@otro.com".into()],
            asunto: "Hola".into(),
            cuerpo: "Buenas.".into(),
            ..Default::default()
        };

        let json = serde_json::to_value(&borrador).unwrap();
        assert!(json.get("de").is_none(), "{json}");
        assert!(json.get("nombre").is_none(), "{json}");
    }

    /// Una cuenta sin los campos opcionales no puede tirar la lista entera: el
    /// sincronizador puede ser de una versión anterior a ésta.
    #[test]
    fn faltando_un_campo_opcional_la_cuenta_igual_se_lee() {
        let json = r#"[{"account_id":"a","display_name":"Trabajo"}]"#;
        let cuentas: Vec<Cuenta> = serde_json::from_str(json).unwrap();
        assert_eq!(cuentas[0].sin_leer, 0);
        assert_eq!(cuentas[0].error, "");
    }

    // ── Lo que manda el servicio en vivo ─────────────────────────────────────

    /// **El arreglo de #66.** El servicio manda el HTML ya saneado en
    /// `con_formato`; `Abierto` no tenía ese campo, y lo que no está en el tipo
    /// se descarta al leer: la vista con formato no aparecía nunca. Se lee la
    /// respuesta tal como la manda `vasak-accounts-sync` y se vuelve a escribir,
    /// que es el viaje que hace hasta la ventana.
    #[test]
    fn el_html_saneado_del_servicio_llega_a_la_ventana() {
        let respuesta = r#"{
            "texto": "Hola", "recortado": false,
            "adjuntos": [{"parte":"2","nombre":"x.pdf","tipo":"application/pdf"}],
            "con_formato": {"html":"<p>Hola</p>","imagenes_bloqueadas":1,"recortado":false},
            "message_id": "<a@b>", "referencias": ["<a@b>"],
            "responder_a": "ana@x.com", "nombre": "Ana"
        }"#;
        let abierto: Abierto = serde_json::from_str(respuesta).unwrap();

        let a_la_ventana = serde_json::to_value(&abierto).unwrap();
        assert_eq!(
            a_la_ventana["con_formato"],
            serde_json::json!({"html":"<p>Hola</p>","imagenes_bloqueadas":1,"recortado":false}),
            "{a_la_ventana}"
        );
    }

    /// Sin HTML el servicio manda `con_formato: null`, y uno de una versión
    /// anterior no lo manda: las dos cosas se leen como «sin formato».
    #[test]
    fn un_mensaje_sin_html_se_lee_sin_formato() {
        let con_null = r#"{"texto":"Hola","recortado":false,"adjuntos":[],"con_formato":null}"#;
        let sin_clave = r#"{"texto":"Hola","recortado":false,"adjuntos":[]}"#;

        assert_eq!(
            serde_json::from_str::<Abierto>(con_null)
                .unwrap()
                .con_formato,
            None
        );
        assert_eq!(
            serde_json::from_str::<Abierto>(sin_clave)
                .unwrap()
                .con_formato,
            None
        );
    }

    /// La lista en vivo no trae `store_id`: si el campo fuera obligatorio, la
    /// lista del servicio dejaría de leerse entera y la ventana se quedaría sin
    /// correo justo cuando el almacén no lo tiene.
    #[test]
    fn la_lista_en_vivo_se_lee_aunque_no_traiga_el_numero_del_almacen() {
        let json = r#"[{
            "uid": 42, "de": "Ana", "direccion": "ana@x.com", "asunto": "Hola",
            "fecha": "", "sin_leer": true, "con_adjuntos": false
        }]"#;
        let lista: Vec<Resumen> = serde_json::from_str(json).unwrap();

        assert_eq!(lista[0].uid, 42);
        assert_eq!(lista[0].store_id, None);
    }

    // ── Lo que guarda el almacén del sistema ─────────────────────────────────

    #[test]
    fn el_rol_del_almacen_se_traduce_al_uso_de_la_ventana() {
        assert_eq!(usage_for_role("inbox"), "entrada");
        assert_eq!(usage_for_role("sent"), "enviados");
        assert_eq!(usage_for_role("drafts"), "borradores");
        assert_eq!(usage_for_role("trash"), "papelera");
        assert_eq!(usage_for_role("junk"), "spam");
        assert_eq!(usage_for_role("archive"), "archivo");
        assert_eq!(usage_for_role("other"), "ninguno");
        assert_eq!(usage_for_role(""), "ninguno");
        // Los roles van en minúsculas: uno que no se conoce es «ninguno», no
        // una carpeta especial adivinada.
        assert_eq!(usage_for_role("Inbox"), "ninguno");
    }

    #[test]
    fn el_remitente_se_separa_en_nombre_y_direccion() {
        assert_eq!(
            split_sender("Ana Pérez <ana@ejemplo.com>"),
            ("Ana Pérez".into(), "ana@ejemplo.com".into())
        );
        assert_eq!(
            split_sender("\"Pérez, Ana\" <ana@ejemplo.com>"),
            ("Pérez, Ana".into(), "ana@ejemplo.com".into())
        );
        assert_eq!(
            split_sender("  Ana   <  ana@ejemplo.com >  "),
            ("Ana".into(), "ana@ejemplo.com".into())
        );
    }

    /// Sin nombre, la fila muestra la dirección en los dos lugares: un nombre
    /// vacío dejaría la fila sin remitente.
    #[test]
    fn sin_nombre_el_remitente_es_su_direccion() {
        assert_eq!(
            split_sender("<ana@ejemplo.com>"),
            ("ana@ejemplo.com".into(), "ana@ejemplo.com".into())
        );
        assert_eq!(
            split_sender("\"\" <ana@ejemplo.com>"),
            ("ana@ejemplo.com".into(), "ana@ejemplo.com".into())
        );
        assert_eq!(
            split_sender("ana@ejemplo.com"),
            ("ana@ejemplo.com".into(), "ana@ejemplo.com".into())
        );
    }

    /// El fraude que la lista existe para mostrar: un nombre que parece una
    /// dirección. La dirección de verdad es la de los ángulos, no la del
    /// nombre.
    #[test]
    fn un_nombre_que_parece_direccion_no_tapa_la_direccion_de_verdad() {
        let (nombre, direccion) = split_sender("soporte@banco.com <ladron@otro.net>");
        assert_eq!(nombre, "soporte@banco.com");
        assert_eq!(direccion, "ladron@otro.net");
    }

    #[test]
    fn la_fecha_del_almacen_sale_en_iso_8601() {
        assert_eq!(iso_date(1_789_396_200), "2026-09-14T14:30:00+00:00");
        assert_eq!(iso_date(1), "1970-01-01T00:00:01+00:00");
    }

    /// `0` es lo que guarda el almacén cuando no entendió la fecha. Mostrar
    /// «1 de enero de 1970» sería inventar una fecha.
    #[test]
    fn sin_fecha_en_el_almacen_la_fecha_queda_vacia() {
        assert_eq!(iso_date(0), "");
        assert_eq!(iso_date(-1), "");
        // Y una fuera de rango tampoco revienta.
        assert_eq!(iso_date(i64::MAX), "");
    }

    fn guardada(id: i64, name: &str) -> StoredMailbox {
        StoredMailbox {
            id,
            name: name.into(),
            display_name: name.into(),
            role: String::new(),
        }
    }

    #[test]
    fn la_casilla_se_busca_por_su_nombre_exacto() {
        let guardadas = [
            guardada(1, "INBOX"),
            guardada(2, "Enviados"),
            guardada(3, "enviados"),
        ];

        assert_eq!(
            find_stored_mailbox(&guardadas, "Enviados").map(|c| c.id),
            Some(2)
        );
        assert_eq!(
            find_stored_mailbox(&guardadas, "enviados").map(|c| c.id),
            Some(3)
        );
        assert!(find_stored_mailbox(&guardadas, "Papelera").is_none());
    }

    /// `INBOX` se escribe como se quiera (RFC 3501); las demás carpetas no: un
    /// servidor puede tener «Enviados» y «enviados» y son dos.
    #[test]
    fn la_entrada_se_encuentra_sin_mirar_mayusculas_y_las_demas_no() {
        let guardadas = [guardada(1, "Inbox"), guardada(2, "Enviados")];

        assert_eq!(
            find_stored_mailbox(&guardadas, "INBOX").map(|c| c.id),
            Some(1)
        );
        assert_eq!(
            find_stored_mailbox(&guardadas, "inbox").map(|c| c.id),
            Some(1)
        );
        assert!(find_stored_mailbox(&guardadas, "ENVIADOS").is_none());
    }

    /// Una página de `ListMessages` como la escribe `vasak-accounts`
    /// (`sync/src/store/email_read.rs`, `Page<MessageSummary>`), con todos sus
    /// campos aunque se usen pocos: si alguno de los que se usan cambiara de
    /// nombre de un lado, la lista caería al servidor sin decir nada.
    const PAGINA_DEL_ALMACEN: &str = r#"{
        "items": [{
            "id": 41, "mailbox_id": 3, "mailbox_name": "INBOX", "uid": 7,
            "message_id": "<m@x>", "from_addr": "Ana <ana@x.com>",
            "to_addrs": "yo@x.com", "cc_addrs": "", "reply_to": null,
            "subject": "Hola", "date_ts": 1789396200,
            "flags_seen": false, "flags_answered": false, "flags_flagged": false,
            "flags_draft": false, "flags_deleted": false,
            "has_attachments": true, "size": 1234
        }, {
            "id": 42, "mailbox_id": 3, "mailbox_name": "INBOX", "uid": 4294967296,
            "message_id": null, "from_addr": "x@x.com",
            "to_addrs": "", "cc_addrs": "", "reply_to": null,
            "subject": "", "date_ts": 0,
            "flags_seen": true, "flags_answered": false, "flags_flagged": false,
            "flags_draft": false, "flags_deleted": false,
            "has_attachments": false, "size": 1
        }],
        "next_cursor": "MTc4OTM5NjIwMDo0MQ"
    }"#;

    #[test]
    fn la_pagina_del_almacen_se_lee_con_la_forma_que_tiene() {
        let pagina: StoredPage = serde_json::from_str(PAGINA_DEL_ALMACEN).unwrap();
        assert_eq!(pagina.items.len(), 2);

        // La última página no trae `next_cursor` (se omite al serializar).
        let ultima: StoredPage = serde_json::from_str(r#"{"items":[]}"#).unwrap();
        assert!(ultima.items.is_empty());
    }

    #[test]
    fn un_mensaje_del_almacen_se_muestra_como_uno_en_vivo() {
        let pagina: StoredPage = serde_json::from_str(PAGINA_DEL_ALMACEN).unwrap();
        let resumen = summary_from_store(pagina.items[0].clone()).unwrap();

        assert_eq!(
            resumen,
            Resumen {
                uid: 7,
                de: "Ana".into(),
                direccion: "ana@x.com".into(),
                asunto: "Hola".into(),
                fecha: "2026-09-14T14:30:00+00:00".into(),
                sin_leer: true,
                con_adjuntos: true,
                store_id: Some(41),
            }
        );
        // Leído en el almacén es «no sin leer» en la ventana.
        let leido = summary_from_store(pagina.items[1].clone().tap_uid(9)).unwrap();
        assert!(!leido.sin_leer);
        assert_eq!(leido.fecha, "");
    }

    /// La ventana y el servidor hablan de `uid` de 32 bits (RFC 3501); uno que
    /// no entra no se puede abrir ni marcar en vivo, así que no se lista en vez
    /// de listarse con otro número.
    #[test]
    fn un_uid_que_no_entra_en_32_bits_no_se_lista() {
        let pagina: StoredPage = serde_json::from_str(PAGINA_DEL_ALMACEN).unwrap();
        assert!(summary_from_store(pagina.items[1].clone()).is_none());

        let tope = summary_from_store(pagina.items[0].clone().tap_uid(u64::from(u32::MAX)));
        assert_eq!(tope.map(|r| r.uid), Some(u32::MAX));
    }

    impl StoredSummary {
        fn tap_uid(mut self, uid: u64) -> Self {
            self.uid = uid;
            self
        }
    }

    /// `ListMailboxes` del almacén (`Vec<MailboxSummary>`).
    #[test]
    fn las_casillas_del_almacen_se_leen_con_la_forma_que_tienen() {
        let json = r#"[
            {"id":1,"name":"INBOX","display_name":"Entrada","role":"inbox"},
            {"id":2,"name":"[Gmail]/Enviados","display_name":"Enviados","role":"sent"}
        ]"#;
        let casillas: Vec<StoredMailbox> = serde_json::from_str(json).unwrap();

        assert_eq!(casillas[1].id, 2);
        assert_eq!(casillas[1].name, "[Gmail]/Enviados");
        assert_eq!(casillas[1].display_name, "Enviados");
        assert_eq!(usage_for_role(&casillas[1].role), "enviados");
    }

    /// `GetMessage` del almacén (`Option<MessageFull>`), entero.
    fn mensaje_del_almacen(cambios: serde_json::Value) -> StoredMessage {
        let mut json = serde_json::json!({
            "id": 41, "mailbox_id": 3, "mailbox_name": "INBOX", "uid": 7,
            "message_id": "<m@x>", "from_addr": "Ana Pérez <ana@x.com>",
            "to_addrs": "yo@x.com", "cc_addrs": "", "bcc_addrs": "",
            "reply_to": null, "subject": "Hola", "date_ts": 1789396200,
            "flags_seen": true, "flags_answered": false, "flags_flagged": false,
            "flags_draft": false, "flags_deleted": false,
            "has_attachments": true, "size": 1234,
            "text_body": "Hola, ¿cómo va?", "html_body": "<p>Hola</p>",
            "truncated": false,
            "attachments": [
                {"part_number":"2","name":"x.pdf","content_type":"application/pdf",
                 "size":10,"inline":false,"content_id":null},
                {"part_number":"3","name":null,"content_type":"image/png",
                 "size":10,"inline":true,"content_id":"<img@x>"}
            ],
            "flags": ["$Etiqueta"]
        });
        for (clave, valor) in cambios.as_object().unwrap() {
            json[clave] = valor.clone();
        }
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn el_mensaje_del_almacen_se_lee_con_la_forma_que_tiene() {
        let json = serde_json::to_string(&serde_json::json!(null)).unwrap();
        // Un id que no existe: el almacén contesta `null`.
        assert!(serde_json::from_str::<Option<StoredMessage>>(&json)
            .unwrap()
            .is_none());

        let m = mensaje_del_almacen(serde_json::json!({}));
        assert_eq!(m.attachments.len(), 2);
        assert_eq!(m.text_body.as_deref(), Some("Hola, ¿cómo va?"));
    }

    #[test]
    fn un_mensaje_del_almacen_se_abre_como_uno_en_vivo() {
        let abierto = opened_from_store(mensaje_del_almacen(serde_json::json!({}))).unwrap();

        assert_eq!(abierto.texto, "Hola, ¿cómo va?");
        assert!(!abierto.recortado);
        assert_eq!(abierto.nombre, "Ana Pérez");
        assert_eq!(abierto.message_id, "<m@x>");
        assert_eq!(
            abierto.con_formato,
            Some(Sanitized {
                html: "<p>Hola</p>".into(),
                imagenes_bloqueadas: 0,
                recortado: false,
            })
        );
    }

    /// Sin `Reply-To` la respuesta va al remitente, **a su dirección** y no al
    /// texto con el nombre: lo que se escribe en el «Para».
    #[test]
    fn sin_reply_to_se_responde_a_la_direccion_del_remitente() {
        let nulo =
            opened_from_store(mensaje_del_almacen(serde_json::json!({"reply_to": null}))).unwrap();
        assert_eq!(nulo.responder_a, "ana@x.com");

        let vacio =
            opened_from_store(mensaje_del_almacen(serde_json::json!({"reply_to": "  "}))).unwrap();
        assert_eq!(vacio.responder_a, "ana@x.com");

        let con = opened_from_store(mensaje_del_almacen(
            serde_json::json!({"reply_to": "Lista <lista@x.org>"}),
        ))
        .unwrap();
        assert_eq!(con.responder_a, "lista@x.org");
    }

    /// El almacén guarda la lista del mensaje antes de tener su cuerpo. Sin
    /// texto no hay qué mostrar: `None` hace que se vaya a buscar al servidor,
    /// en vez de abrir un mensaje en blanco.
    #[test]
    fn sin_cuerpo_guardado_el_mensaje_se_pide_al_servidor() {
        let sin_cuerpo =
            mensaje_del_almacen(serde_json::json!({"text_body": null, "html_body": null}));
        assert!(opened_from_store(sin_cuerpo).is_none());

        // Aunque tenga HTML: la vista de texto es la que siempre tiene que
        // poder mostrarse.
        let solo_html = mensaje_del_almacen(serde_json::json!({"text_body": null}));
        assert!(opened_from_store(solo_html).is_none());
    }

    #[test]
    fn sin_html_guardado_el_mensaje_se_abre_sin_formato() {
        let abierto =
            opened_from_store(mensaje_del_almacen(serde_json::json!({"html_body": null}))).unwrap();
        assert_eq!(abierto.con_formato, None);
        assert_eq!(abierto.texto, "Hola, ¿cómo va?");
    }

    /// El recorte se dice en el texto y en el formato: los dos vienen del mismo
    /// cuerpo cortado.
    #[test]
    fn un_mensaje_recortado_en_el_almacen_se_dice_recortado() {
        let abierto =
            opened_from_store(mensaje_del_almacen(serde_json::json!({"truncated": true}))).unwrap();
        assert!(abierto.recortado);
        assert!(abierto.con_formato.unwrap().recortado);
    }

    /// Un adjunto sin nombre se nombra igual: sin nombre no se puede mostrar en
    /// la lista ni guardar, y quien lee no se entera de que estaba.
    #[test]
    fn los_adjuntos_del_almacen_llegan_con_parte_tipo_y_nombre() {
        let abierto = opened_from_store(mensaje_del_almacen(serde_json::json!({}))).unwrap();

        assert_eq!(
            abierto.adjuntos,
            vec![
                Adjunto {
                    parte: "2".into(),
                    nombre: "x.pdf".into(),
                    tipo: "application/pdf".into(),
                },
                Adjunto {
                    parte: "3".into(),
                    nombre: "adjunto-3".into(),
                    tipo: "image/png".into(),
                },
            ]
        );
    }

    fn stored(uid: u64, mailbox: &str) -> StoredMessage {
        serde_json::from_value(serde_json::json!({
            "uid": uid, "mailbox_name": mailbox, "from_addr": "ana@x.com",
            "text_body": "Hola"
        }))
        .unwrap()
    }

    /// El número del almacén se reusa cuando corre la ventana de
    /// sincronización: un mensaje con otro UID o de otra casilla no se muestra
    /// bajo el encabezado del que se pidió.
    #[test]
    fn el_mensaje_guardado_tiene_que_ser_el_que_se_pidio() {
        assert!(is_requested(&stored(7, "INBOX"), "INBOX", 7));
        assert!(is_requested(&stored(7, "Inbox"), "INBOX", 7));
        assert!(is_requested(&stored(7, "Enviados"), "Enviados", 7));
        assert!(!is_requested(&stored(8, "INBOX"), "INBOX", 7));
        assert!(!is_requested(&stored(7, "Enviados"), "INBOX", 7));
        assert!(!is_requested(&stored(7, "enviados"), "Enviados", 7));
        // Una respuesta sin UID ni casilla —un almacén viejo— no es el pedido.
        let without: StoredMessage =
            serde_json::from_value(serde_json::json!({"from_addr": "a@x"})).unwrap();
        assert!(!is_requested(&without, "INBOX", 7));
    }

    /// Las imágenes que bloqueó el saneador se cuentan desde el HTML guardado:
    /// sin la cuenta, la ventana no ofrece traerlas.
    #[test]
    fn las_imagenes_bloqueadas_se_cuentan_del_html_guardado() {
        let html = r#"<p>Hola</p><img data-vsk-src="https://x/a.png"><img data-vsk-src="https://x/b.png">"#;
        assert_eq!(blocked_images(html), 2);
        assert_eq!(blocked_images("<p>sin imágenes</p>"), 0);
        let m: StoredMessage = serde_json::from_value(serde_json::json!({
            "uid": 1, "mailbox_name": "INBOX", "from_addr": "a@x",
            "text_body": "Hola", "html_body": html
        }))
        .unwrap();
        assert_eq!(
            opened_from_store(m)
                .unwrap()
                .con_formato
                .unwrap()
                .imagenes_bloqueadas,
            2
        );
    }

    /// Una casilla vacía en el almacén es una lista vacía, no «no está»: si
    /// no, cada vez que se abre una carpeta vacía se iría al servidor.
    #[test]
    fn una_casilla_vacia_en_el_almacen_es_una_lista_vacia() {
        assert_eq!(
            summaries_from_page(r#"{"items": [], "next_cursor": null}"#),
            Some(Vec::new())
        );
        assert_eq!(summaries_from_page("no es json"), None);
        let page = serde_json::json!({"items": [{
            "id": 9, "uid": 7, "from_addr": "Ana <ana@x.com>", "subject": "Hola",
            "date_ts": 0, "flags_seen": false, "has_attachments": false
        }]});
        let list = summaries_from_page(&page.to_string()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].store_id, Some(9));
        assert!(list[0].sin_leer);
    }
    // ── Los errores del plugin ─────────────────────────────────────────────

    #[test]
    fn el_error_del_almacen_lleva_el_metodo_y_el_nombre_de_dbus() {
        let error = StoreError::Store {
            name: Some("org.freedesktop.DBus.Error.AccessDenied".into()),
            message: "sin permiso".into(),
        };
        assert_eq!(
            describe("SendMessage", &error),
            "SendMessage: org.freedesktop.DBus.Error.AccessDenied: sin permiso"
        );
    }

    #[test]
    fn un_error_sin_nombre_de_dbus_lleva_el_metodo_y_el_texto_del_plugin() {
        let sin_nombre = StoreError::Store {
            name: None,
            message: "se cortó".into(),
        };
        assert_eq!(describe("MarkRead", &sin_nombre), "MarkRead: se cortó");
        assert_eq!(
            describe("ListOutbox", &StoreError::Impostor),
            format!("ListOutbox: {}", StoreError::Impostor)
        );
        assert_eq!(
            describe("GetMessage", &StoreError::NotRunning),
            format!("GetMessage: {}", StoreError::NotRunning)
        );
    }

    // ── Antes de que arranque el plugin ────────────────────────────────────

    /// Sin el cliente del plugin —antes de `use_store`— las llamadas fallan
    /// con un error que se entiende, sin entrar en pánico y sin ir al bus por
    /// otro lado. Ninguna prueba de este archivo llama a `use_store`: el
    /// cliente es uno por proceso y no se puede volver atrás.
    #[tokio::test]
    async fn sin_el_cliente_del_plugin_las_llamadas_fallan_limpio() {
        assert_eq!(
            store().err().as_deref(),
            Some("el cliente del almacén todavía no está listo")
        );
        assert_eq!(
            salientes().await.unwrap_err(),
            "el cliente del almacén todavía no está listo"
        );
        let descartado = descartar("1").await.unwrap_err();
        assert!(
            descartado.ends_with("el cliente del almacén todavía no está listo"),
            "{descartado}"
        );
    }

    // ── Qué señales se escuchan ────────────────────────────────────────────

    #[test]
    fn el_cambio_de_dueno_se_escucha_solo_del_bus_y_del_nombre_del_sincronizador() {
        let regla = owner_rule().unwrap();
        assert_eq!(regla.msg_type(), Some(zbus::message::Type::Signal));
        assert_eq!(
            regla.sender().map(|s| s.as_str()),
            Some("org.freedesktop.DBus")
        );
        assert_eq!(
            regla.interface().map(|i| i.as_str()),
            Some("org.freedesktop.DBus")
        );
        assert_eq!(regla.member().map(|m| m.as_str()), Some("NameOwnerChanged"));
        let args: Vec<_> = regla
            .args()
            .iter()
            .map(|(i, a)| (*i, a.as_str().to_string()))
            .collect();
        assert_eq!(args, [(0, SERVICIO.to_string())]);
    }

    use crate::test_bus::{self, PrivateBus};
    use futures_util::StreamExt;

    /// Cuánto se espera, como mucho, algo que tiene que pasar. Si se cumple,
    /// la prueba falla: no es una pausa.
    const DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);

    /// El sincronizador de mentira: sólo toma el nombre y publica el objeto
    /// en vivo.
    struct Live;

    #[zbus::interface(name = "ar.net.vasak.os.AccountsSync")]
    impl Live {
        fn ping(&self) {}
    }

    /// Que el bus ya repartió todo lo que mandó `connection`: el bus atiende
    /// los mensajes de una conexión en orden, así que cuando contesta esto ya
    /// entregó lo anterior.
    async fn flushed(connection: &zbus::Connection) {
        zbus::fdo::DBusProxy::new(connection)
            .await
            .unwrap()
            .get_id()
            .await
            .unwrap();
    }

    async fn signal(connection: &zbus::Connection, path: &str, member: &str) {
        connection
            .emit_signal(None::<()>, path, INTERFAZ, member, &())
            .await
            .unwrap();
        flushed(connection).await;
    }

    #[tokio::test]
    async fn la_regla_en_vivo_es_del_dueno_comprobado_su_objeto_y_su_senal() {
        let _turno = test_bus::exclusive();
        let bus = PrivateBus::start();
        let dueno = bus.serve(RUTA, Live).await;
        let verified = test_bus::client(true)
            .verify_on(bus.connect().await)
            .await
            .unwrap();
        assert_eq!(
            verified.owner.as_str(),
            dueno.unique_name().unwrap().as_str()
        );

        let regla = live_rule(&verified, "OutboxChanged").unwrap();

        assert_eq!(regla.msg_type(), Some(zbus::message::Type::Signal));
        assert_eq!(
            regla.sender().map(|s| s.as_str()),
            Some(verified.owner.as_str())
        );
        assert!(
            matches!(
                regla.path_spec(),
                Some(zbus::match_rule::PathSpec::Path(path)) if path.as_str() == RUTA
            ),
            "{:?}",
            regla.path_spec()
        );
        assert_eq!(regla.interface().map(|i| i.as_str()), Some(INTERFAZ));
        assert_eq!(regla.member().map(|m| m.as_str()), Some("OutboxChanged"));
    }

    /// Cualquier programa de la sesión puede emitir una señal con la interfaz
    /// del sincronizador. Sólo la del dueño comprobado, en su objeto y con la
    /// señal pedida, despierta a la ventana.
    #[tokio::test]
    async fn solo_despierta_la_senal_del_dueno_comprobado() {
        let _turno = test_bus::exclusive();
        let bus = PrivateBus::start();
        let dueno = bus.serve(RUTA, Live).await;
        let oyente = bus.connect().await;
        let verified = test_bus::client(true)
            .verify_on(oyente.clone())
            .await
            .unwrap();
        let mut avisos = zbus::MessageStream::for_match_rule(
            live_rule(&verified, "MessagesChanged").unwrap(),
            &oyente,
            None,
        )
        .await
        .unwrap();

        let impostor = bus.connect().await;
        signal(&impostor, RUTA, "MessagesChanged").await;
        signal(&dueno, "/ar/net/vasak/os/Otro", "MessagesChanged").await;
        signal(&dueno, RUTA, "MailboxChanged").await;
        signal(&dueno, RUTA, "MessagesChanged").await;

        let aviso = tokio::time::timeout(DEADLINE, avisos.next())
            .await
            .expect("la señal del dueño no llegó")
            .unwrap()
            .unwrap();
        let header = aviso.header();
        assert_eq!(
            header.sender().map(|s| s.as_str()),
            Some(verified.owner.as_str())
        );
        assert_eq!(header.path().map(|p| p.as_str()), Some(RUTA));
        assert_eq!(header.member().map(|m| m.as_str()), Some("MessagesChanged"));
    }

    /// Cuando el sincronizador suelta el nombre llega el aviso del bus, y el
    /// de otro nombre que cambia de dueño no.
    #[tokio::test]
    async fn el_aviso_de_cambio_de_dueno_es_solo_el_del_sincronizador() {
        let _turno = test_bus::exclusive();
        let bus = PrivateBus::start();
        let dueno = bus.serve(RUTA, Live).await;
        let oyente = bus.connect().await;
        let mut avisos = zbus::MessageStream::for_match_rule(owner_rule().unwrap(), &oyente, None)
            .await
            .unwrap();

        let otro = bus.connect().await;
        otro.request_name("ar.net.vasak.os.Otro").await.unwrap();
        flushed(&otro).await;
        dueno.release_name(SERVICIO).await.unwrap();

        let aviso = tokio::time::timeout(DEADLINE, avisos.next())
            .await
            .expect("el aviso del cambio de dueño no llegó")
            .unwrap()
            .unwrap();
        let (nombre, antes, despues): (String, String, String) =
            aviso.body().deserialize().unwrap();
        assert_eq!(nombre, SERVICIO);
        assert_eq!(antes, dueno.unique_name().unwrap().as_str());
        assert_eq!(despues, "");
    }

    // ── Leer el correo del almacén, y el «no» al permiso ──────────────────────

    /// Un almacén de mentira que, según `mode`, tiene la casilla, no la tiene, o
    /// niega el permiso. Lo sirve el dueño comprobado en el objeto del almacén.
    #[derive(Clone)]
    struct FakeStore {
        mode: Arc<std::sync::Mutex<&'static str>>,
    }

    #[zbus::interface(name = "ar.net.vasak.os.AccountsStore")]
    impl FakeStore {
        async fn list_mailboxes(&self, _account_id: String) -> zbus::fdo::Result<String> {
            match *self.mode.lock().unwrap() {
                // El «no» de la persona: el permiso del almacén negado.
                "denied" => Err(zbus::fdo::Error::AccessDenied("sin permiso".into())),
                // Tiene la casilla de entrada.
                "hit" => Ok(
                    r#"[{"id":1,"name":"INBOX","display_name":"Entrada","role":"inbox"}]"#
                        .to_string(),
                ),
                // No tiene ninguna casilla: la ventana va al servidor.
                _ => Ok("[]".to_string()),
            }
        }

        async fn list_messages(
            &self,
            _account_id: String,
            _mailbox_id: i64,
            _filter: String,
            _page: u32,
        ) -> zbus::fdo::Result<String> {
            Ok(r#"{"items":[{"id":10,"uid":7,"from_addr":"Ana <ana@ejemplo.com>","subject":"Del almacén","date_ts":0,"flags_seen":true,"has_attachments":false}]}"#.to_string())
        }
    }

    /// El servidor en vivo, para cuando el almacén no tiene la casilla.
    struct FakeSync;

    #[zbus::interface(name = "ar.net.vasak.os.AccountsSync")]
    impl FakeSync {
        async fn list_messages(&self, _account_id: String, _casilla: String) -> String {
            r#"[{"uid":99,"de":"Servidor","direccion":"srv@ejemplo.com","asunto":"Del servidor","fecha":"2026-09-20T10:00:00Z","sin_leer":false,"con_adjuntos":false}]"#.to_string()
        }
    }

    /// El camino de lectura del correo, de punta a punta por el cliente del
    /// almacén de verdad: del almacén si lo tiene, del servidor si no, y el
    /// estado «sin permiso» cuando la persona le dijo que no —sin caer al
    /// servidor por detrás—.
    #[tokio::test]
    async fn mensajes_sale_del_almacen_cae_al_servidor_o_dice_sin_permiso() {
        let _turno = test_bus::exclusive();
        let bus = PrivateBus::start();
        let mode = Arc::new(std::sync::Mutex::new("hit"));
        // El dueño sirve el almacén y la interfaz en vivo en sus dos objetos, y
        // toma el nombre del sincronizador.
        let _dueno = zbus::connection::Builder::address(bus.address.as_str())
            .unwrap()
            .serve_at(
                tauri_plugin_vsk_store::client::PATH,
                FakeStore { mode: mode.clone() },
            )
            .unwrap()
            .serve_at(RUTA, FakeSync)
            .unwrap()
            .name(SERVICIO)
            .unwrap()
            .build()
            .await
            .unwrap();
        // El cliente global, que le cree al dueño comprobado. Es un `OnceLock`:
        // esta es la única prueba que lo fija, y nadie más lo lee.
        use_store(Arc::new(test_bus::client(true)));

        // Con la casilla en el almacén, el correo sale de ahí.
        *mode.lock().unwrap() = "hit";
        let desde_almacen = mensajes("a", "INBOX").await.unwrap();
        assert_eq!(desde_almacen.len(), 1);
        assert_eq!(desde_almacen[0].asunto, "Del almacén");
        assert_eq!(desde_almacen[0].store_id, Some(10));

        // Sin esa casilla en el almacén, la ventana va al servidor.
        *mode.lock().unwrap() = "miss";
        let desde_servidor = mensajes("a", "INBOX").await.unwrap();
        assert_eq!(desde_servidor.len(), 1);
        assert_eq!(desde_servidor[0].asunto, "Del servidor");

        // Con el «no» al almacén no se va al servidor: se dice «sin permiso».
        *mode.lock().unwrap() = "denied";
        assert_eq!(
            mensajes("a", "INBOX").await,
            Err(STORE_PERMISSION_DENIED.to_string())
        );
    }
}
