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

/// Las casillas de una cuenta.
pub async fn casillas(account_id: &str) -> Result<Vec<Casilla>, String> {
    let json = llamar("ListMailboxes", &(account_id,)).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudieron leer las carpetas: {e}"))
}

/// Los últimos mensajes de una casilla.
///
/// La casilla va siempre, incluso para la de entrada: los **UID son por
/// casilla**, así que pedir mensajes sin decir de dónde es pedir cualquiera.
pub async fn mensajes(account_id: &str, casilla: &str) -> Result<Vec<Resumen>, String> {
    let json = llamar("ListMessages", &(account_id, casilla)).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudo leer el correo: {e}"))
}

/// Busca en una casilla, del lado del servidor.
///
/// `terminos` es JSON con lo que se busca —**qué**, no un criterio de IMAP—:
/// el criterio lo arma el sincronizador. Ver `sync/src/consulta.rs`.
pub async fn buscar(
    account_id: &str,
    casilla: &str,
    terminos: &str,
) -> Result<Vec<Resumen>, String> {
    let json = llamar("SearchMessages", &(account_id, casilla, terminos)).await?;
    serde_json::from_str(&json).map_err(|e| format!("no se pudo leer la búsqueda: {e}"))
}

/// El texto de un mensaje. Se trae del servidor en el momento.
pub async fn abrir(account_id: &str, casilla: &str, uid: u32) -> Result<Abierto, String> {
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
    conectar()
        .await?
        .call_method(
            Some(SERVICIO),
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
    conectar()
        .await?
        .call_method(
            Some(SERVICIO),
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
const ESPERA_ENTRE_INTENTOS: std::time::Duration = std::time::Duration::from_secs(15);

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
}
