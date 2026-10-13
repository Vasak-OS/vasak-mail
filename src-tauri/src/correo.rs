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

use serde::{Deserialize, Serialize};

use vasak_accounts_store_client::{
    trusted_owner, DbusOwnerResolver, OwnerResolver, ServiceIdentity,
};

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

/// El almacén del sistema: lo que el sincronizador ya trajo y guardó cifrado.
/// Mismo nombre de bus, otro objeto. Ver `store_api.rs` de `vasak-accounts`.
const STORE_PATH: &str = "/ar/net/vasak/os/AccountsStore";
const STORE_INTERFACE: &str = "ar.net.vasak.os.AccountsStore";

/// Cuántos mensajes se piden del almacén por casilla: los mismos que mostraba
/// la lista en vivo.
const STORE_PAGE: u32 = 200;

async fn conectar() -> Result<zbus::Connection, String> {
    // El bus de sesión y no el del sistema: el sincronizador es un servicio del
    // usuario y lo que publica es suyo, así que no hay otra sesión que pueda
    // escucharlo.
    zbus::Connection::session().await.map_err(|e| {
        format!(
            "no se pudo contactar al servicio de correo: {e}. \
             Comprobá que vasak-accounts-sync esté en ejecución."
        )
    })
}

/// Comprueba, con un resolvedor del dueño del nombre, que quien tiene
/// [`SERVICIO`] sea de verdad el servicio instalado —y no un proceso de la
/// sesión que tomó el nombre mientras el servicio no estaba— y devuelve su
/// **nombre único** ya verificado. Es el mismo nombre que verifica el crate:
/// `SERVICIO` y `vasak_accounts_store_client::SERVICE_NAME` tienen que ser el
/// mismo (hay un test que lo ata).
///
/// Las llamadas se dirigen a ese nombre único, no al nombre bien conocido: si el
/// nombre cambia de dueño después de la comprobación, siguen yendo a la conexión
/// verificada y no a la de un impostor. Falla **cerrado** —cualquier cosa que
/// impida comprobar es un error— y el que llama cae al camino de «el servicio no
/// está» de siempre. Ver `vasak-accounts#77`.
///
/// En producción el resolvedor es el del bus (ver [`connect_verified`]); las
/// pruebas le pasan uno propio con un impostor de verdad.
async fn trust_owner<R>(resolver: &R, identity: &ServiceIdentity) -> Result<String, String>
where
    R: OwnerResolver + ?Sized,
{
    trusted_owner(resolver, SERVICIO, identity)
        .await
        .map_err(|e| format!("no se pudo confiar en el servicio de correo: {e}"))
}

/// Conecta al bus y comprueba, **una vez por conexión**, al dueño del nombre del
/// sincronizador antes de confiar en lo que conteste (ver [`trust_owner`]).
/// Devuelve la conexión y el nombre único verificado, al que van dirigidas todas
/// las llamadas.
async fn connect_verified() -> Result<(zbus::Connection, String), String> {
    let conexion = conectar().await?;
    let resolver = DbusOwnerResolver::new(&conexion)
        .await
        .map_err(|e| format!("no se pudo confiar en el servicio de correo: {e}"))?;
    let dueno = trust_owner(&resolver, &ServiceIdentity::installed()).await?;
    Ok((conexion, dueno))
}

async fn llamar<A>(metodo: &str, argumentos: &A) -> Result<String, String>
where
    A: serde::ser::Serialize + zbus::zvariant::DynamicType,
{
    let (conexion, dueno) = connect_verified().await?;
    conexion
        .call_method(
            Some(dueno.as_str()),
            RUTA,
            Some(INTERFAZ),
            metodo,
            argumentos,
        )
        .await
        .map_err(|e| format!("{metodo}: {e}"))?
        .body()
        .deserialize()
        .map_err(|e| format!("respuesta inválida de {metodo}: {e}"))
}

/// Llama a un método del almacén.
///
/// **Sin tope de tiempo** —zbus no pone uno—, a propósito: la primera lectura
/// puede abrir el diálogo de permiso de `vasak-permissions`, y la respuesta
/// llega cuando la persona lo cierra.
async fn call_store<A>(metodo: &str, argumentos: &A) -> Result<String, String>
where
    A: serde::ser::Serialize + zbus::zvariant::DynamicType,
{
    let (conexion, dueno) = connect_verified().await?;
    conexion
        .call_method(
            Some(dueno.as_str()),
            STORE_PATH,
            Some(STORE_INTERFACE),
            metodo,
            argumentos,
        )
        .await
        .map_err(|e| format!("{metodo}: {e}"))?
        .body()
        .deserialize()
        .map_err(|e| format!("respuesta inválida de {metodo}: {e}"))
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

/// Los mensajes de una casilla, **del almacén**. `None` si el almacén no los
/// tiene —el área todavía no se encendió, la primera vuelta no terminó, el
/// llavero está bloqueado—: quien llama va al servidor.
async fn stored_messages(account_id: &str, casilla: &str) -> Option<Vec<Resumen>> {
    let guardadas = stored_mailboxes(account_id).await.ok()?;
    let id = find_stored_mailbox(&guardadas, casilla)?.id;
    let json = call_store("ListMessages", &(account_id, id, "", STORE_PAGE))
        .await
        .ok()?;
    summaries_from_page(&json)
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

/// Una cuenta a la que no se le pudo pedir una vuelta, y por qué. La ventana
/// lo dice al lado de la cuenta: un «Actualizar» que no hizo nada y no lo dice
/// se lee como que no había nada nuevo.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SyncRequestFailure {
    pub account_id: String,
    /// `denied` (sin permiso), `too_soon` (se pidió hace un momento),
    /// `unavailable` (el sincronizador no está) o `failed`.
    pub reason: &'static str,
}

/// Por qué no se aceptó un pedido, a partir del nombre del error de D-Bus.
pub fn failure_reason(error_name: Option<&str>) -> &'static str {
    match error_name {
        Some("org.freedesktop.DBus.Error.AccessDenied") => "denied",
        Some("org.freedesktop.DBus.Error.LimitsExceeded") => "too_soon",
        Some("org.freedesktop.DBus.Error.ServiceUnknown")
        | Some("org.freedesktop.DBus.Error.NameHasNoOwner")
        | Some("org.freedesktop.DBus.Error.UnknownObject")
        | Some("org.freedesktop.DBus.Error.UnknownMethod") => "unavailable",
        _ => "failed",
    }
}

/// El nombre de un error de D-Bus, si lo tiene.
fn error_name(error: &zbus::Error) -> Option<String> {
    match error {
        zbus::Error::MethodError(name, _, _) => Some(name.to_string()),
        zbus::Error::FDO(e) => Some(zbus::DBusError::name(e.as_ref()).to_string()),
        _ => None,
    }
}

/// Le pide al sincronizador que traiga ya lo nuevo de unas cuentas: es el
/// botón «Actualizar». No espera a que termine; lo que llegue se avisa con la
/// señal `Changed` del almacén, y el estado con `StatusChanged`. Devuelve las
/// cuentas a las que no se les pudo pedir, y por qué; un fallo de una no
/// frena a las demás.
pub async fn request_sync(account_ids: &[String]) -> Vec<SyncRequestFailure> {
    let (conexion, dueno) = match connect_verified().await {
        Ok(verificada) => verificada,
        Err(e) => {
            eprintln!("[correo] no se pudo pedir una vuelta: {e}");
            return account_ids
                .iter()
                .map(|id| SyncRequestFailure {
                    account_id: id.clone(),
                    reason: "unavailable",
                })
                .collect();
        }
    };
    let mut failures = Vec::new();
    for id in account_ids {
        if let Err(e) = conexion
            .call_method(
                Some(dueno.as_str()),
                STORE_PATH,
                Some(STORE_INTERFACE),
                "RequestSync",
                &(id.as_str(),),
            )
            .await
        {
            let reason = failure_reason(error_name(&e).as_deref());
            eprintln!("[correo] no se pudo pedir una vuelta de una cuenta ({reason})");
            failures.push(SyncRequestFailure {
                account_id: id.clone(),
                reason,
            });
        }
    }
    failures
}

/// El estado de la sincronización del correo de una cuenta, como lo da
/// `GetStatus`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AccountSyncStatus {
    pub account_id: String,
    /// `off`, `pending`, `syncing`, `synced`, `unavailable` o `failed`.
    pub state: String,
    /// Qué pasó, si falló o no está disponible. Lo escribe el almacén.
    pub detail: String,
    /// Cuándo terminó la última vuelta buena (RFC 3339), si hubo.
    pub last_synced_at: Option<String>,
}

/// El estado del área `area` de cada cuenta, de la respuesta de `GetStatus`.
/// Las cuentas sin esa área no aparecen.
pub fn statuses_from(json: &str, area: &str) -> Result<Vec<AccountSyncStatus>, String> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| format!("no se pudo leer el estado del almacén: {e}"))?;
    let accounts = value
        .get("accounts")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();
    let text =
        |v: &serde_json::Value, k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    Ok(accounts
        .iter()
        .filter_map(|account| {
            let shown = account.get(area)?;
            Some(AccountSyncStatus {
                account_id: text(account, "account_id")?,
                state: text(shown, "state").unwrap_or_else(|| "off".into()),
                detail: text(shown, "detail").unwrap_or_default(),
                last_synced_at: text(shown, "last_synced_at"),
            })
        })
        .collect())
}

/// El estado de la sincronización del correo de cada cuenta.
pub async fn sync_status() -> Result<Vec<AccountSyncStatus>, String> {
    let json = call_store("GetStatus", &()).await?;
    statuses_from(&json, "email")
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
    if let Some(guardados) = stored_messages(account_id, casilla).await {
        return Ok(guardados);
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
    let (conexion, dueno) = connect_verified().await?;
    conexion
        .call_method(
            Some(dueno.as_str()),
            RUTA,
            Some(INTERFAZ),
            "MarkRead",
            &(account_id, casilla, uid),
        )
        .await
        .map_err(|e| format!("no se pudo marcar como leído: {e}"))?;
    Ok(())
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
    let (conexion, dueno) = connect_verified().await?;
    conexion
        .call_method(
            Some(dueno.as_str()),
            RUTA,
            Some(INTERFAZ),
            "DiscardOutgoing",
            &(id,),
        )
        .await
        .map_err(|e| format!("no se pudo descartar: {e}"))?;
    Ok(())
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
            tokio::time::sleep(ESPERA_ENTRE_INTENTOS).await;
        }
    });
}

/// Cuánto se espera antes de volver a engancharse a los avisos.
///
/// Quince segundos: corto para que reconectar no se note, y largo para no
/// martillar un bus que no está.
/// Cuánto se juntan los avisos seguidos antes de pasarlos a la ventana.
const SETTLE: std::time::Duration = std::time::Duration::from_millis(500);

const ESPERA_ENTRE_INTENTOS: std::time::Duration = std::time::Duration::from_secs(15);

/// La regla con que se escucha al almacén: su `Changed`, y sólo el del área
/// del correo.
fn store_change_rule() -> Result<zbus::MatchRule<'static>, String> {
    Ok(zbus::MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        // Sólo del dueño del nombre del sincronizador y de su objeto: cualquier
        // proceso de la sesión puede emitir una señal con esta interfaz, y cada
        // una hace releer la lista.
        .sender(SERVICIO)
        .and_then(|r| r.path(STORE_PATH))
        .and_then(|r| r.interface(STORE_INTERFACE))
        .and_then(|r| r.member("Changed"))
        .and_then(|r| r.arg(0, "email"))
        .map_err(|e| format!("no se pudo armar el filtro del almacén: {e}"))?
        .build())
}

/// La señal de que cambió el estado de alguna base del almacén: también sólo
/// del sincronizador y de su objeto.
fn store_status_rule() -> Result<zbus::MatchRule<'static>, String> {
    Ok(zbus::MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .sender(SERVICIO)
        .and_then(|r| r.path(STORE_PATH))
        .and_then(|r| r.interface(STORE_INTERFACE))
        .and_then(|r| r.member("StatusChanged"))
        .map_err(|e| format!("no se pudo armar el filtro del estado: {e}"))?
        .build())
}

/// El evento que ve la ventana cuando cambia el estado de la sincronización.
pub const STATUS_EVENT: &str = "mail-sync-status";

/// Qué avisó el bus: algo del correo o del almacén, o el estado.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Notice {
    Changed,
    Status,
}

/// Qué eventos recibe la ventana por una ráfaga de avisos: uno de cada clase
/// que llegó, nunca uno por aviso. Un `StatusChanged` solo no relee la lista, y
/// un cambio del correo solo no relee el estado.
fn events_for(burst: &[Notice]) -> Vec<&'static str> {
    let mut events = Vec::new();
    if burst.contains(&Notice::Changed) {
        events.push(EVENTO);
    }
    if burst.contains(&Notice::Status) {
        events.push(STATUS_EVENT);
    }
    events
}

async fn seguir(app: &tauri::AppHandle) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    let conexion = conectar().await?;

    // Un flujo por señal, con su regla de coincidencia. La regla se le pide al
    // bus para que no despierte a este proceso por cada mensaje que pasa por la
    // sesión, que son muchos.
    let mut flujos = Vec::new();
    for señal in ["MessagesChanged", "MailboxChanged", "OutboxChanged"] {
        let regla = zbus::MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .interface(INTERFAZ)
            .and_then(|r| r.member(señal))
            .map_err(|e| format!("no se pudo armar el filtro de «{señal}»: {e}"))?
            .build();

        let flujo = zbus::MessageStream::for_match_rule(regla, &conexion, None)
            .await
            .map_err(|e| format!("no se pudo escuchar «{señal}»: {e}"))?;
        flujos.push(flujo);
    }

    // Las dos a la vez: una `select` sobre los dos flujos deja que llegue la que
    // llegue primero. Encadenarlas escucharía sólo la primera hasta que se
    // cortara, que en la práctica es nunca.
    // Y lo que cambió en el almacén, que es de donde sale la lista. Sólo el
    // área del correo: el bus filtra por el primer argumento, así que un lote
    // de contactos no despierta a esta ventana.
    let regla = store_change_rule()?;
    flujos.push(
        zbus::MessageStream::for_match_rule(regla, &conexion, None)
            .await
            .map_err(|e| format!("no se pudo escuchar al almacén: {e}"))?,
    );

    // Cada aviso con su clase: los del correo y los del almacén hacen releer la
    // lista; los del estado, sólo el estado.
    let correo = futures_util::stream::select_all(flujos).map(|m| m.map(|_| Notice::Changed));
    let estado = zbus::MessageStream::for_match_rule(store_status_rule()?, &conexion, None)
        .await
        .map_err(|e| format!("no se pudo escuchar el estado del almacén: {e}"))?
        .map(|m| m.map(|_| Notice::Status));
    let mut avisos = futures_util::stream::select(correo, estado);

    while let Some(aviso) = avisos.next().await {
        let Ok(first) = aviso else {
            continue;
        };
        // Una vuelta escribe de a lotes y avisa por cada uno: se juntan los
        // que llegan seguidos, y la ventana recibe un aviso de cada clase.
        // Sin detalle: el evento dice «volvé a leer», y la ventana relee y ve
        // el estado completo.
        tokio::time::sleep(SETTLE).await;
        let mut seen = vec![first];
        while let Some(Some(next)) = futures_util::FutureExt::now_or_never(avisos.next()) {
            if let Ok(kind) = next {
                seen.push(kind);
            }
        }
        for event in events_for(&seen) {
            let _ = app.emit(event, ());
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

    /// `Changed` del almacén sale por cada área. La ventana tiene que despertar
    /// con el del correo y con ningún otro: un lote de contactos no cambia la
    /// lista, y recargarla por él es gastar batería.
    #[test]
    fn se_escucha_el_changed_del_correo_y_no_el_de_otras_areas() {
        let regla = store_change_rule().unwrap();
        let senal = |area: &str| {
            zbus::message::Message::signal(STORE_PATH, STORE_INTERFACE, "Changed")
                .unwrap()
                .build(&(area, "cuenta", 3u64))
                .unwrap()
        };

        assert!(regla.matches(&senal("email")).unwrap());
        assert!(!regla.matches(&senal("contacts")).unwrap());
        assert!(!regla.matches(&senal("calendar")).unwrap());

        // Ni otra señal del almacén con el mismo primer argumento.
        let otra = zbus::message::Message::signal(STORE_PATH, STORE_INTERFACE, "StatusChanged")
            .unwrap()
            .build(&("email",))
            .unwrap();
        assert!(!regla.matches(&otra).unwrap());
    }

    /// Cualquier proceso de la sesión puede emitir una señal con la interfaz
    /// del almacén: la regla sólo acepta la del dueño del nombre del
    /// sincronizador, y desde su objeto.
    #[test]
    fn solo_cuenta_el_changed_del_sincronizador_y_de_su_objeto() {
        let regla = store_change_rule().unwrap();
        assert_eq!(regla.sender().map(|s| s.as_str()), Some(SERVICIO));

        let de_otro_objeto = zbus::message::Message::signal("/otro", STORE_INTERFACE, "Changed")
            .unwrap()
            .build(&("email", "cuenta", 3u64))
            .unwrap();
        assert!(!regla.matches(&de_otro_objeto).unwrap());
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

    /// El área de esta ventana en `GetStatus`, y otra que no tiene que mirar.
    const AREA: &str = "email";
    const OTHER_AREA: &str = "calendar";
    /// Los eventos que escucha la ventana (`src/composables`, `src/views`).
    const EXPECTED_CHANGED_EVENT: &str = "correo-cambio";
    const EXPECTED_STATUS_EVENT: &str = "mail-sync-status";

    // ── El estado de la sincronización ─────────────────────────────────────

    /// La respuesta de `GetStatus` como la arma `visible_status` en
    /// `vasak-accounts/sync/src/store_api.rs`: con permiso sobre el área van
    /// `detail` y `last_synced_at`; sin permiso, sólo `state`.
    fn status_json() -> String {
        let mut con_permiso = serde_json::json!({
            "account_id": "google",
            "state": "ready",
            "detail": "",
            "size_bytes": 10,
        });
        con_permiso[AREA] = serde_json::json!({
            "state": "synced",
            "detail": "",
            "last_synced_at": "2026-10-13T17:05:00Z",
        });
        con_permiso[OTHER_AREA] = serde_json::json!({ "state": "failed" });
        let mut fallida = serde_json::json!({ "account_id": "nube", "state": "ready" });
        fallida[AREA] = serde_json::json!({
            "state": "failed",
            "detail": "el servidor rechazó la clave",
            "last_synced_at": null,
        });
        let mut de_otra_area = serde_json::json!({ "account_id": "otra", "state": "ready" });
        de_otra_area[OTHER_AREA] = serde_json::json!({ "state": "syncing" });
        let mut sin_permiso = serde_json::json!({ "account_id": "ajena", "state": "ready" });
        sin_permiso[AREA] = serde_json::json!({ "state": "pending" });
        serde_json::json!({
            "keyring": "unlocked",
            "accounts": [con_permiso, fallida, de_otra_area, sin_permiso],
        })
        .to_string()
    }

    fn estado(id: &str, state: &str, detail: &str, last: Option<&str>) -> AccountSyncStatus {
        AccountSyncStatus {
            account_id: id.into(),
            state: state.into(),
            detail: detail.into(),
            last_synced_at: last.map(str::to_string),
        }
    }

    #[test]
    fn el_estado_de_cada_cuenta_sale_de_su_area() {
        assert_eq!(
            statuses_from(&status_json(), AREA).unwrap(),
            vec![
                estado("google", "synced", "", Some("2026-10-13T17:05:00Z")),
                estado("nube", "failed", "el servidor rechazó la clave", None),
                // Sin permiso sobre el área el almacén manda sólo el estado: se
                // muestra igual, sin detalle ni hora.
                estado("ajena", "pending", "", None),
            ]
        );
    }

    /// Una cuenta que no tiene esta área —sólo otra— no tiene nada que decir
    /// acá: si apareciera, se le mostraría el estado de otra área.
    #[test]
    fn una_cuenta_sin_esta_area_no_aparece() {
        let ids: Vec<_> = statuses_from(&status_json(), AREA)
            .unwrap()
            .into_iter()
            .map(|s| s.account_id)
            .collect();
        assert!(!ids.contains(&"otra".to_string()), "{ids:?}");
        // Y de la que tiene las dos, el estado es el de esta área.
        let google = statuses_from(&status_json(), AREA).unwrap().remove(0);
        assert_eq!(google.state, "synced");
    }

    #[test]
    fn un_area_sin_estado_se_lee_apagada() {
        let mut cuenta = serde_json::json!({ "account_id": "google" });
        cuenta[AREA] = serde_json::json!({});
        let json = serde_json::json!({ "accounts": [cuenta] }).to_string();
        assert_eq!(
            statuses_from(&json, AREA).unwrap(),
            vec![estado("google", "off", "", None)]
        );
    }

    #[test]
    fn una_cuenta_sin_id_no_se_muestra() {
        let mut cuenta = serde_json::json!({ "state": "ready" });
        cuenta[AREA] = serde_json::json!({ "state": "synced" });
        let json = serde_json::json!({ "accounts": [cuenta] }).to_string();
        assert_eq!(statuses_from(&json, AREA).unwrap(), vec![]);
    }

    #[test]
    fn una_respuesta_que_no_es_json_es_un_error() {
        assert!(statuses_from("no es json", AREA).is_err());
    }

    /// Un almacén que todavía no tiene cuentas, o que contesta otra cosa en
    /// `accounts`, es ningún estado: no es un error que haya que mostrar.
    #[test]
    fn una_respuesta_sin_cuentas_no_tiene_estados() {
        assert_eq!(
            statuses_from(r#"{"keyring":"locked"}"#, AREA).unwrap(),
            vec![]
        );
        assert_eq!(statuses_from(r#"{"accounts":3}"#, AREA).unwrap(), vec![]);
        assert_eq!(statuses_from("[]", AREA).unwrap(), vec![]);
    }

    /// Lo que viaja a la ventana tiene que tener **exactamente** los nombres
    /// que lee `src/tools/sync-status.ts`: Tauri no los convierte.
    #[test]
    fn el_estado_y_los_rechazos_llegan_con_los_nombres_de_la_ventana() {
        let json =
            serde_json::to_value(estado("google", "synced", "", Some("2026-10-13T17:05:00Z")))
                .unwrap();
        let mut claves: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
        claves.sort();
        assert_eq!(claves, ["account_id", "detail", "last_synced_at", "state"]);
        // Sin hora, `null`: el tipo de la ventana es `string | null`.
        let sin_hora = serde_json::to_value(estado("google", "pending", "", None)).unwrap();
        assert!(sin_hora["last_synced_at"].is_null());

        let rechazo = serde_json::to_value(SyncRequestFailure {
            account_id: "google".into(),
            reason: "denied",
        })
        .unwrap();
        assert_eq!(
            rechazo,
            serde_json::json!({ "account_id": "google", "reason": "denied" })
        );
    }

    // ── Lo que «Actualizar» no pudo pedir ──────────────────────────────────

    #[test]
    fn cada_rechazo_del_almacen_tiene_su_motivo() {
        for (nombre, motivo) in [
            ("org.freedesktop.DBus.Error.AccessDenied", "denied"),
            ("org.freedesktop.DBus.Error.LimitsExceeded", "too_soon"),
            ("org.freedesktop.DBus.Error.ServiceUnknown", "unavailable"),
            ("org.freedesktop.DBus.Error.NameHasNoOwner", "unavailable"),
            ("org.freedesktop.DBus.Error.UnknownObject", "unavailable"),
            ("org.freedesktop.DBus.Error.UnknownMethod", "unavailable"),
            ("org.freedesktop.DBus.Error.Failed", "failed"),
            ("ar.net.vasak.os.Error.Otro", "failed"),
        ] {
            assert_eq!(failure_reason(Some(nombre)), motivo, "{nombre}");
        }
        // Un error que no es de D-Bus —se cortó la conexión— también falló.
        assert_eq!(failure_reason(None), "failed");
    }

    /// Una respuesta de error de verdad, como la que llega por el bus. Así es
    /// como `call_method` devuelve el `LimitsExceeded` del almacén: un
    /// `MethodError`, no un `FDO`.
    fn error_reply(nombre: &str) -> zbus::Error {
        let pedido = zbus::Message::method_call(STORE_PATH, "RequestSync")
            .unwrap()
            .build(&("google",))
            .unwrap();
        let respuesta = zbus::Message::error(&pedido.header(), nombre)
            .unwrap()
            .build(&("una por cuenta cada minuto",))
            .unwrap();
        zbus::Error::from(respuesta)
    }

    #[test]
    fn el_motivo_sale_del_nombre_de_la_respuesta_de_error() {
        let limite = error_reply("org.freedesktop.DBus.Error.LimitsExceeded");
        assert!(matches!(limite, zbus::Error::MethodError(..)), "{limite:?}");
        assert_eq!(failure_reason(error_name(&limite).as_deref()), "too_soon");

        let sin_permiso = error_reply("org.freedesktop.DBus.Error.AccessDenied");
        assert_eq!(
            failure_reason(error_name(&sin_permiso).as_deref()),
            "denied"
        );

        // El mismo error ya convertido a `fdo::Error` da el mismo motivo.
        let fdo = zbus::Error::from(zbus::fdo::Error::AccessDenied("no".into()));
        assert!(matches!(fdo, zbus::Error::FDO(_)), "{fdo:?}");
        assert_eq!(failure_reason(error_name(&fdo).as_deref()), "denied");

        assert_eq!(error_name(&zbus::Error::InvalidReply), None);
    }

    /// Sin bus de sesión no se le pudo pedir nada a nadie: cada cuenta pedida
    /// vuelve como sin servicio, y la ventana lo dice al lado de cada una.
    #[test]
    fn sin_bus_cada_cuenta_pedida_queda_sin_servicio() {
        // Serializa con las pruebas de bus real, que también tocan la variable.
        let _guard = env_lock();
        let _address = BusAddressGuard::point_to("unix:path=/nonexistent/vasak-qa/bus");
        let ids = vec!["google".to_string(), "nube".to_string()];
        let fallos = tauri::async_runtime::block_on(request_sync(&ids));
        assert_eq!(
            fallos,
            vec![
                SyncRequestFailure {
                    account_id: "google".into(),
                    reason: "unavailable",
                },
                SyncRequestFailure {
                    account_id: "nube".into(),
                    reason: "unavailable",
                },
            ]
        );
    }

    // ── El aviso del estado ────────────────────────────────────────────────

    /// `StatusChanged` también sólo del sincronizador y de su objeto: si no,
    /// cualquier proceso de la sesión haría releer el estado a voluntad.
    #[test]
    fn solo_cuenta_el_status_changed_del_sincronizador_y_de_su_objeto() {
        let regla = store_status_rule().unwrap().to_string();
        for parte in [
            "type='signal'",
            "sender='ar.net.vasak.os.AccountsSync'",
            "path='/ar/net/vasak/os/AccountsStore'",
            "interface='ar.net.vasak.os.AccountsStore'",
            "member='StatusChanged'",
        ] {
            assert!(regla.contains(parte), "falta {parte} en {regla}");
        }
    }

    /// Una vuelta escribe de a lotes y avisa por cada uno: la ventana recibe
    /// un solo aviso por ráfaga, no uno por lote.
    #[test]
    fn una_rafaga_de_cambios_avisa_una_sola_vez() {
        assert_eq!(
            events_for(&[Notice::Changed, Notice::Changed, Notice::Changed]),
            [EVENTO]
        );
    }

    /// Un cambio de estado solo no relee lo guardado, y un cambio de lo
    /// guardado solo no relee el estado.
    #[test]
    fn cada_clase_de_aviso_despierta_solo_lo_suyo() {
        assert_eq!(
            events_for(&[Notice::Status, Notice::Status]),
            [STATUS_EVENT]
        );
        assert_eq!(events_for(&[Notice::Changed]), [EVENTO]);
    }

    #[test]
    fn una_rafaga_mixta_avisa_una_vez_de_cada_clase() {
        assert_eq!(
            events_for(&[
                Notice::Status,
                Notice::Changed,
                Notice::Status,
                Notice::Changed
            ]),
            [EVENTO, STATUS_EVENT]
        );
        assert!(events_for(&[]).is_empty());
    }

    #[test]
    fn los_avisos_a_la_ventana_tienen_los_nombres_que_escucha() {
        assert_eq!(EVENTO, EXPECTED_CHANGED_EVENT);
        assert_eq!(STATUS_EVENT, EXPECTED_STATUS_EVENT);
    }

    // ── Confiar sólo en el servicio de verdad (vasak-accounts#77) ───────────
    //
    // El bus de sesión deja que **cualquier** proceso tome un nombre que nadie
    // tiene. Si el sincronizador se cayó o está en su ventana de reinicio, otro
    // proceso de la sesión puede tomar `ar.net.vasak.os.AccountsSync` y servirle
    // a esta ventana correo inventado bajo la cuenta real de la persona. Antes de
    // confiar, `trust_owner` comprueba que el dueño del nombre esté ejecutando el
    // binario del servicio instalado y dirige las llamadas a su nombre único.
    //
    // El sabotaje es real —un proceso de verdad hace de impostor, con su propio
    // `/proc/<pid>/exe`, que es justo lo que mira el verificador—, no una prueba
    // en negativo. Es el mismo patrón que
    // `vasak-accounts/store-client/tests/verification.rs`.

    use std::process::{Child, Command};
    use vasak_accounts_store_client::{BoxFuture, SERVICE_NAME};

    /// Un proceso de verdad que hace de impostor: existe, tiene su `exe`, y no es
    /// el servicio. Se mata solo al salir del alcance.
    struct Impostor(Child);

    impl Impostor {
        fn start() -> Self {
            Impostor(
                Command::new("sleep")
                    .arg("120")
                    .spawn()
                    .expect("no se pudo arrancar el proceso impostor"),
            )
        }

        fn pid(&self) -> u32 {
            self.0.id()
        }
    }

    impl Drop for Impostor {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    /// Un resolvedor que contesta lo que se le diga, sin bus. El pid que devuelve
    /// es el de un proceso de verdad, así que `/proc/<pid>/exe` se lee de verdad.
    struct FakeResolver {
        owner: Option<String>,
        pid: u32,
    }

    impl OwnerResolver for FakeResolver {
        fn name_owner<'a>(
            &'a self,
            _name: &'a str,
        ) -> BoxFuture<'a, Result<Option<String>, String>> {
            let owner = self.owner.clone();
            Box::pin(async move { Ok(owner) })
        }

        fn process_id<'a>(&'a self, _unique_name: &'a str) -> BoxFuture<'a, Result<u32, String>> {
            let pid = self.pid;
            Box::pin(async move { Ok(pid) })
        }
    }

    /// El nombre que esta ventana le habla al servicio tiene que ser el mismo que
    /// el crate verifica. Si se separaran, la app comprobaría un nombre y le
    /// hablaría a otro, y la comprobación no diría nada del que de verdad usa.
    #[test]
    fn el_correo_verifica_el_nombre_que_le_habla_al_servicio() {
        assert_eq!(SERVICIO, SERVICE_NAME);
    }

    /// Un impostor que tomó el nombre no es de confianza: `trust_owner` falla
    /// **cerrado** y el que llama cae al camino de «el servicio no está», así que
    /// la ventana no muestra el correo inventado.
    #[test]
    fn un_impostor_que_toma_el_nombre_del_sincronizador_no_es_de_confianza() {
        let impostor = Impostor::start();
        let resolver = FakeResolver {
            owner: Some(":1.42".to_owned()),
            pid: impostor.pid(),
        };

        let resultado =
            tauri::async_runtime::block_on(trust_owner(&resolver, &ServiceIdentity::installed()));

        let error = resultado.expect_err("un impostor tenía que ser rechazado");
        assert!(error.contains("no se pudo confiar"), "{error}");
    }

    /// El dueño cuyo `exe` es el del servicio sí es de confianza, y lo que se
    /// devuelve es su **nombre único** —no el nombre bien conocido—: es a él al
    /// que se dirigen las llamadas, así un cambio de dueño posterior no las
    /// redirige a un impostor.
    ///
    /// El «servicio» es este mismo proceso de prueba: su pid está vivo y su
    /// `/proc/self/exe` se lee de verdad, sin la carrera de reciclado de pid que
    /// tendría un hijo de vida corta. La identidad apunta a ese `exe`, que es lo
    /// que pasaría si este proceso fuera el servicio instalado.
    #[test]
    fn el_servicio_de_verdad_es_de_confianza_y_se_dirige_a_su_nombre_unico() {
        let resolver = FakeResolver {
            owner: Some(":1.7".to_owned()),
            pid: std::process::id(),
        };
        let identity = ServiceIdentity {
            executable: std::fs::read_link("/proc/self/exe")
                .expect("el proceso de prueba tiene que tener un exe"),
        };

        let dueno = tauri::async_runtime::block_on(trust_owner(&resolver, &identity))
            .expect("el dueño cuyo exe coincide tiene que ser de confianza");
        assert_eq!(dueno, ":1.7");
        assert_ne!(dueno, SERVICIO);
    }

    /// Sin dueño del nombre —el servicio no está— tampoco se confía: falla
    /// cerrado igual que con un impostor.
    #[test]
    fn sin_dueno_del_nombre_no_se_confia() {
        let resolver = FakeResolver {
            owner: None,
            pid: 0,
        };
        let resultado =
            tauri::async_runtime::block_on(trust_owner(&resolver, &ServiceIdentity::installed()));
        assert!(resultado.is_err());
    }

    // ── Bus real: la lectura falla cerrada contra un impostor ───────────────
    //
    // Las pruebas de arriba comprueban la **decisión** (`trust_owner`) sin bus.
    // Éstas ejercitan el **cableado** de verdad: levantan un `dbus-daemon`
    // propio, hacen que el propio proceso de prueba —cuyo `/proc/<pid>/exe` es el
    // runner de cargo, no `/usr/bin/vasak-accounts-sync`— tome el nombre del
    // sincronizador, y comprueban que `connect_verified` **y** las dos vías de
    // llamada (`llamar`, el objeto `AccountsSync`; `call_store`, el objeto
    // `AccountsStore`) **fallan cerrado** en vez de confiar en el impostor. Sin
    // el cambio, la llamada iría al impostor y el error no sería el de «no se
    // pudo confiar»: estas pruebas fallan sin él. Espejan el bus real del crate
    // (`vasak-accounts`, store-client/tests/real_bus.rs, #83) y de
    // `vasak-contacts`.
    //
    // Si no hay `dbus-daemon` en el equipo, se avisan y no corren: el CI instala
    // el paquete `dbus` (`paquetes_rust`) para que sí lo hagan y cuenten
    // cobertura.

    use std::io::{BufRead, BufReader};
    use std::path::PathBuf;
    use std::process::Stdio;
    use std::sync::{Mutex, MutexGuard, OnceLock};

    const BUS_ADDRESS_VAR: &str = "DBUS_SESSION_BUS_ADDRESS";

    /// Varias pruebas tocan `DBUS_SESSION_BUS_ADDRESS` para apuntar `conectar()` a
    /// un bus de prueba o a uno inexistente. Como corren en paralelo en el mismo
    /// proceso y la variable es de todo el proceso, se serializan con este candado:
    /// sin él, una pisaría la dirección de la otra. Se recupera de un envenenamiento
    /// porque lo único que protege es una variable de entorno.
    fn env_lock() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Un identificador barato y único por proceso, para el nombre del archivo de
    /// configuración del bus.
    fn fastish_id() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0)
    }

    /// Un `dbus-daemon` de sesión sólo para la prueba. Se mata al salir del
    /// alcance y se lleva su archivo de configuración.
    struct TestBus {
        child: Child,
        address: String,
        config: PathBuf,
    }

    impl TestBus {
        /// Levanta el bus, o `None` si no hay `dbus-daemon` en el equipo.
        fn launch() -> Option<Self> {
            let config = std::env::temp_dir().join(format!(
                "vasak-mail-store-bus-{}-{}.conf",
                std::process::id(),
                fastish_id()
            ));
            std::fs::write(
                &config,
                r#"<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:tmpdir=/tmp</listen>
  <policy context="default">
    <allow own="*"/>
    <allow send_destination="*"/>
    <allow receive_sender="*"/>
  </policy>
</busconfig>
"#,
            )
            .ok()?;

            let mut child = Command::new("dbus-daemon")
                .arg(format!("--config-file={}", config.display()))
                .arg("--print-address")
                .arg("--nofork")
                .stdout(Stdio::piped())
                .spawn()
                .map_err(|_| {
                    let _ = std::fs::remove_file(&config);
                })
                .ok()?;

            let stdout = child.stdout.take()?;
            let mut address = String::new();
            if BufReader::new(stdout).read_line(&mut address).is_err() || address.trim().is_empty()
            {
                let _ = child.kill();
                let _ = std::fs::remove_file(&config);
                return None;
            }

            Some(TestBus {
                child,
                address: address.trim().to_owned(),
                config,
            })
        }

        fn address(&self) -> &str {
            &self.address
        }
    }

    impl Drop for TestBus {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
            let _ = std::fs::remove_file(&self.config);
        }
    }

    /// Restaura `DBUS_SESSION_BUS_ADDRESS` a lo que tenía al salir del alcance,
    /// pase lo que pase en la prueba.
    struct BusAddressGuard {
        previous: Option<std::ffi::OsString>,
    }

    impl BusAddressGuard {
        /// Apunta `conectar()` al bus de prueba y recuerda el valor anterior.
        fn point_to(address: &str) -> Self {
            let previous = std::env::var_os(BUS_ADDRESS_VAR);
            std::env::set_var(BUS_ADDRESS_VAR, address);
            Self { previous }
        }
    }

    impl Drop for BusAddressGuard {
        fn drop(&mut self) {
            match self.previous.take() {
                Some(valor) => std::env::set_var(BUS_ADDRESS_VAR, valor),
                None => std::env::remove_var(BUS_ADDRESS_VAR),
            }
        }
    }

    // El candado de entorno y el bus se toman en la parte síncrona de la prueba,
    // y el trabajo asíncrono va dentro de `block_on`: así el `MutexGuard` no queda
    // vivo sobre un `.await` —lo que marcaría clippy y pide `AGENTS.md`—, pero
    // sigue serializando el acceso a la variable de entorno.

    /// Un impostor que toma el nombre del sincronizador en el bus de prueba —el
    /// propio proceso de prueba— hace que la lectura **falle cerrada**: ni
    /// `connect_verified` ni las dos vías de llamada confían en él, y el error es
    /// el de «no se pudo confiar», no el de un método desconocido. Sin el cambio,
    /// la llamada iría al impostor y el error sería otro: esta prueba falla sin él.
    #[test]
    fn un_impostor_en_el_bus_hace_fallar_cerrada_la_lectura() {
        let _guard = env_lock();
        let Some(bus) = TestBus::launch() else {
            eprintln!("sin dbus-daemon: se omite la prueba de bus real");
            return;
        };
        let _address = BusAddressGuard::point_to(bus.address());

        tauri::async_runtime::block_on(async {
            // El proceso de prueba toma el nombre del servicio: es el impostor. Su
            // `exe` es el runner de cargo, no `/usr/bin/vasak-accounts-sync`. La
            // conexión se mantiene viva mientras dure la comprobación.
            let impostor = conectar().await.expect("conectar el impostor al bus");
            impostor
                .request_name(SERVICIO)
                .await
                .expect("el impostor toma el nombre en el bus de prueba");

            let verificada = connect_verified().await;
            let error = verificada.expect_err("el impostor no tiene que ser de confianza");
            assert!(error.contains("confiar"), "{error}");

            // La vía del objeto `AccountsSync` (`llamar`) también falla cerrado:
            // no es un error de método del impostor, es el de no poder confiar.
            let por_sync = llamar("MailboxStatus", &()).await;
            assert!(
                por_sync
                    .expect_err("no se lee del impostor")
                    .contains("confiar"),
                "la vía AccountsSync tenía que fallar cerrada"
            );

            // Y la del objeto `AccountsStore` (`call_store`), igual.
            let por_store = call_store("GetStatus", &()).await;
            assert!(
                por_store
                    .expect_err("no se lee del impostor")
                    .contains("confiar"),
                "la vía AccountsStore tenía que fallar cerrada"
            );
        });
    }

    /// Un nombre sin dueño —el servicio no está— también hace fallar cerrado: no
    /// hay en quién confiar.
    #[test]
    fn sin_dueno_del_nombre_en_el_bus_la_lectura_falla_cerrada() {
        let _guard = env_lock();
        let Some(bus) = TestBus::launch() else {
            eprintln!("sin dbus-daemon: se omite la prueba de bus real");
            return;
        };
        let _address = BusAddressGuard::point_to(bus.address());

        tauri::async_runtime::block_on(async {
            // Nadie toma el nombre en este bus: no hay dueño que verificar.
            let verificada = connect_verified().await;
            assert!(verificada
                .expect_err("sin dueño no hay en quién confiar")
                .contains("confiar"));
        });
    }
}
