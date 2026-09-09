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
}

/// Un mensaje abierto.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Abierto {
    pub texto: String,
    /// El mensaje era más largo de lo que se trae. Se dice: un texto que termina
    /// a la mitad sin explicación parece un mensaje roto.
    pub recortado: bool,
    /// Trae algo pegado. Se dice aunque **todavía no se pueda abrir**: quien lee
    /// un mensaje y no se entera de que traía un archivo, pierde el archivo.
    pub adjuntos: bool,
}

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

async fn llamar<A>(metodo: &str, argumentos: &A) -> Result<String, String>
where
    A: serde::ser::Serialize + zbus::zvariant::DynamicType,
{
    conectar()
        .await?
        .call_method(Some(SERVICIO), RUTA, Some(INTERFAZ), metodo, argumentos)
        .await
        .map_err(|e| format!("{metodo}: {e}"))?
        .body()
        .deserialize()
        .map_err(|e| format!("respuesta inválida de {metodo}: {e}"))
}

/// Las cuentas que tienen correo, con su contador de sin leer.
pub async fn cuentas() -> Result<Vec<Cuenta>, String> {
    let json = llamar("MailboxStatus", &()).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudo leer la lista de cuentas: {e}"))
}

/// Los últimos mensajes de una cuenta.
pub async fn mensajes(account_id: &str) -> Result<Vec<Resumen>, String> {
    let json = llamar("ListMessages", &(account_id,)).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudo leer el correo: {e}"))
}

/// El texto de un mensaje. Se trae del servidor en el momento.
pub async fn abrir(account_id: &str, uid: u32) -> Result<Abierto, String> {
    let json = llamar("GetMessage", &(account_id, uid)).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudo leer el mensaje: {e}"))
}

/// Marca un mensaje como leído en el servidor.
///
/// Lo pide la ventana **explícitamente** y no pasa por haberlo abierto en el
/// panel: el sincronizador trae todo con `BODY.PEEK`, que mira sin marcar. Que
/// pasar por encima de un mensaje con las flechas te vacíe el contador de sin
/// leer es de los errores más molestos que puede tener un cliente de correo.
pub async fn marcar_leido(account_id: &str, uid: u32) -> Result<(), String> {
    conectar()
        .await?
        .call_method(
            Some(SERVICIO),
            RUTA,
            Some(INTERFAZ),
            "MarkRead",
            &(account_id, uid),
        )
        .await
        .map_err(|e| format!("no se pudo marcar como leído: {e}"))?;
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
/// Se traducen las dos señales, `MessagesChanged` y `MailboxChanged`: la primera
/// es que cambió la lista y la segunda que cambió el contador. Las dos quieren
/// decir lo mismo para esta ventana —volvé a leer— y ninguna trae detalle, a
/// propósito: quien la recibe relee y ve el estado completo, en vez de
/// reconciliar avisos que se pueden perder.
pub fn escuchar(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = seguir(&app).await {
            // Que no se pueda escuchar no rompe nada: el botón de actualizar
            // sigue estando. Queda dicho para que no parezca que el correo nuevo
            // no llega por otro motivo.
            // A stderr, que en una sesión de escritorio termina en el diario
            // del sistema. El plugin del diario cubre los pánicos; esto no lo
            // es —la ventana sigue andando— y aun así hay que poder verlo.
            eprintln!("[correo] no se pueden recibir avisos de correo nuevo: {e}");
        }
    });
}

async fn seguir(app: &tauri::AppHandle) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    let conexion = conectar().await?;

    // Un flujo por señal, con su regla de coincidencia. La regla se le pide al
    // bus para que no despierte a este proceso por cada mensaje que pasa por la
    // sesión, que son muchos.
    let mut flujos = Vec::new();
    for señal in ["MessagesChanged", "MailboxChanged"] {
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
    let mut avisos = futures_util::stream::select_all(flujos);

    while let Some(aviso) = avisos.next().await {
        if aviso.is_ok() {
            // Sin detalle: el evento dice «volvé a leer», y la ventana relee y ve
            // el estado completo. Mandar el contenido acá sería reconstruir del
            // lado de la ventana un estado que el servicio ya tiene entero.
            let _ = app.emit(EVENTO, ());
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
        let json = r#"{"texto":"Hola","recortado":true,"adjuntos":true}"#;
        let abierto: Abierto = serde_json::from_str(json).unwrap();

        assert_eq!(abierto.texto, "Hola");
        assert!(abierto.recortado);
        assert!(abierto.adjuntos);
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
}
