//! Lo que la ventana le puede pedir al programa.
//!
//! Una capa fina sobre `correo.rs`: todo el trabajo lo hace el sincronizador.

use tauri::Manager;

use crate::correo::{
    self, Abierto, AdjuntoParaMandar, Borrador, Casilla, Cuenta, EstadoSmime, Resumen, Saliente,
};
use crate::mailto::{MailtoDraft, PendingMailto};
use crate::store_access;

/// Las cuentas con correo, y cuánto tienen sin leer.
#[tauri::command]
pub async fn listar_cuentas() -> Result<Vec<Cuenta>, String> {
    correo::cuentas().await
}

/// Las carpetas de una cuenta.
#[tauri::command]
pub async fn listar_casillas(account_id: String) -> Result<Vec<Casilla>, String> {
    correo::casillas(&account_id).await
}

/// Los últimos mensajes de una carpeta.
#[tauri::command]
pub async fn listar_mensajes(account_id: String, casilla: String) -> Result<Vec<Resumen>, String> {
    correo::mensajes(&account_id, &casilla).await
}

/// Trae una imagen de un mensaje, cuando la persona la pidió.
///
/// No se llama solo nunca: existe porque alguien apretó un botón. Ver
/// `correo::imagen`.
#[tauri::command]
pub async fn traer_imagen(url: String) -> Result<correo::Imagen, String> {
    correo::imagen(&url).await
}

/// Busca en una casilla, preguntándole al servidor.
///
/// El filtro instantáneo sobre lo que ya está en la ventana no pasa por acá:
/// se hace en el frontend y no toca la red. Éste es el otro, el que llega más
/// allá de los últimos doscientos.
#[tauri::command]
pub async fn buscar_mensajes(
    account_id: String,
    casilla: String,
    terminos: String,
) -> Result<Vec<Resumen>, String> {
    correo::buscar(&account_id, &casilla, &terminos).await
}

/// El texto de un mensaje.
#[tauri::command]
pub async fn open_message(
    account_id: String,
    casilla: String,
    uid: u32,
    store_id: Option<i64>,
) -> Result<Abierto, String> {
    correo::open_message(&account_id, &casilla, uid, store_id).await
}

/// Marca un mensaje como leído en el servidor.
#[tauri::command]
pub async fn marcar_leido(account_id: String, casilla: String, uid: u32) -> Result<(), String> {
    correo::marcar_leido(&account_id, &casilla, uid).await
}

/// Pone un mensaje en la cola de salida.
#[tauri::command]
pub async fn enviar_mensaje(
    account_id: String,
    borrador: Borrador,
    no_antes_de: String,
) -> Result<String, String> {
    correo::enviar(&account_id, &borrador, &no_antes_de).await
}

/// Baja un adjunto y lo guarda donde la persona eligió.
///
/// Devuelve `true` si el archivo puede estar cortado.
#[tauri::command]
pub async fn guardar_adjunto(
    account_id: String,
    casilla: String,
    uid: u32,
    parte: String,
    destino: String,
) -> Result<bool, String> {
    correo::guardar_adjunto(&account_id, &casilla, uid, &parte, &destino).await
}

/// Lo que hay guardado, como JSON.
#[tauri::command]
pub fn leer_preferencias() -> String {
    crate::preferencias::leer()
}

/// Guarda una preferencia, conservando las demás.
#[tauri::command]
pub fn poner_preferencia(clave: String, valor: serde_json::Value) -> Result<(), String> {
    crate::preferencias::poner(&clave, valor)
}

/// Lee un archivo para adjuntarlo, desde una ruta que eligió la persona.
#[tauri::command]
pub async fn leer_adjunto(ruta: String) -> Result<AdjuntoParaMandar, String> {
    correo::leer_adjunto(&ruta)
}

/// Lo que está esperando salir.
#[tauri::command]
pub async fn listar_salientes() -> Result<Vec<Saliente>, String> {
    correo::salientes().await
}

/// Saca un mensaje de la cola sin mandarlo. **Se pierde lo escrito**, así que la
/// ventana tiene que preguntar antes.
#[tauri::command]
pub async fn descartar_saliente(id: String) -> Result<(), String> {
    correo::descartar(&id).await
}

/// El `mailto:` con el que se abrió la aplicación, una sola vez.
///
/// Lo pide la ventana cuando terminó de cargar. **Se lo lleva**: una recarga del
/// WebView —que en desarrollo pasa a cada rato, y en producción puede pasar
/// después de un error— volvería a abrir el mismo mensaje encima de lo que se
/// estuviera escribiendo.
///
/// Devuelve `None` cuando la aplicación se abrió normalmente, que es casi
/// siempre.
#[tauri::command]
pub fn take_pending_mailto(app: tauri::AppHandle) -> Option<MailtoDraft> {
    let estado = app.state::<PendingMailto>();
    let mut guardado = estado.0.lock().ok()?;

    guardado.take()
}

/// Importa una identidad S/MIME en una cuenta, desde un `.p12` que eligió la
/// persona y la contraseña que lo abre.
///
/// El `.p12` lo lee **esta aplicación** —no el servicio, que correría como la
/// persona y podría leer cualquier archivo suyo: la ruta la eligió ella en el
/// diálogo del sistema—. Nunca se copia a un temporal: va del disco al memfd
/// sellado y de ahí al bus. Los dos [`std::os::fd::OwnedFd`] viven hasta después
/// del `await` y se cierran por `drop` al salir, también en el camino de error.
///
/// **La contraseña no se registra en ningún lado.** Se sella en un memfd y se
/// deja caer de alcance.
#[tauri::command]
pub async fn importar_identidad_smime(
    account_id: String,
    ruta: String,
    contrasena: String,
) -> Result<(), String> {
    // Antes de leerlo entero a memoria: que sea un archivo y no pese de más. Si
    // no, un fifo o un archivo enorme mal elegido trabaría la ventana antes de
    // que el servicio aplique su propio tope. Mismo máximo que el servidor
    // (`MAX_SMIME_PKCS12_BYTES`): un `.p12` son kilobytes.
    const MAXIMO: u64 = 8 * 1024 * 1024;
    let datos =
        std::fs::metadata(&ruta).map_err(|e| format!("no se pudo leer el certificado: {e}"))?;
    if !datos.is_file() {
        return Err("Malformed".into());
    }
    if datos.len() > MAXIMO {
        return Err("TooBig".into());
    }
    let p12 = std::fs::read(&ruta).map_err(|e| format!("no se pudo leer el certificado: {e}"))?;
    let p12_fd = correo::sealed_memfd(&p12)?;
    let password_fd = correo::sealed_memfd(contrasena.as_bytes())?;
    correo::importar_identidad_smime(&account_id, &p12_fd, &password_fd)
        .await
        .map_err(|e| correo::smime_error_code(&e).into())
}

/// El estado de la identidad S/MIME de una cuenta: si hay una, de qué dirección
/// es y cuándo vence.
#[tauri::command]
pub async fn estado_identidad_smime(account_id: String) -> Result<EstadoSmime, String> {
    correo::estado_identidad_smime(&account_id).await
}

/// Quita la identidad S/MIME de una cuenta.
#[tauri::command]
pub async fn quitar_identidad_smime(account_id: String) -> Result<(), String> {
    correo::quitar_identidad_smime(&account_id).await
}

/// Vuelve a pedir el permiso para leer el correo del almacén.
///
/// Llama a `RequestAgain` de `vasak-permissions` en el **bus de sistema**: ese
/// método olvida **sólo** la decisión de esta ventana sobre `store.email` —nunca
/// concede—, así que el próximo intento de leer vuelve a abrir el diálogo. Quién
/// llama lo decide el servicio por la conexión, no un parámetro: esta ventana
/// sólo puede re-pedirse el permiso **a sí misma**, y hay un techo contra la
/// fatiga de permisos. Capa fina sobre `store_access`, donde vive —y se prueba—
/// la lógica de cada desenlace.
#[tauri::command]
pub async fn request_mail_access_again() -> store_access::ReaskOutcome {
    use store_access::{ReaskOutcome, EMAIL_RESOURCE, SERVICE_NAME};

    let connection = match zbus::Connection::system().await {
        Ok(connection) => connection,
        Err(error) => {
            eprintln!(
                "[correo] no se pudo abrir el bus de sistema para re-pedir el permiso: {error}"
            );
            return ReaskOutcome::Failed {
                detail: error.to_string(),
            };
        }
    };
    let outcome = store_access::request_again(&connection, SERVICE_NAME, EMAIL_RESOURCE).await;
    if let ReaskOutcome::Failed { detail } = &outcome {
        eprintln!("[correo] no se pudo volver a pedir el permiso: {detail}");
    }
    outcome
}
