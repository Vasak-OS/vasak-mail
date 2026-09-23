//! Lo que llega cuando el sistema elige esta aplicación para un `mailto:`.
//!
//! Declararse cliente de correo predeterminado —`MimeType=x-scheme-handler/mailto`
//! en la entrada del menú— es prometer que, al hacer clic en una dirección de
//! una página, esta ventana abre un mensaje nuevo con lo que el enlace decía.
//! Quien lanza el programa le pasa el URI como argumento, y esto es lo que lo
//! entiende.
//!
//! Separado del arranque y sin tocar nada de afuera, que es lo que permite
//! probarlo: un URI mal leído abre un mensaje en blanco o, peor, con el
//! destinatario equivocado, y eso no falla en ningún lado — el mensaje sale.
//!
//! # Lo que dice el RFC 6068
//!
//! `mailto:uno@ejemplo.com,otro@ejemplo.com?cc=…&bcc=…&subject=…&body=…`
//!
//! - Los destinatarios pueden venir en la ruta, en un campo `to`, o en los dos;
//!   se suman en ese orden.
//! - Todo viene codificado por ciento, y **el `+` es un signo más literal**, no
//!   un espacio: en un `mailto:` el espacio es `%20`. Un formulario web sí usa
//!   `+`, y de ahí sale la confusión — traducirlo acá convertiría una dirección
//!   con etiqueta, `pepe+facturas@ejemplo.com`, en una que no existe.
//! - Los nombres de los campos no distinguen mayúsculas, y el esquema tampoco.
//!
//! Lo que **no** se acepta: cualquier campo que no sea `to`, `cc`, `bcc`,
//! `subject` o `body`. El RFC deja mandar encabezados arbitrarios y eso es una
//! manera de que una página ponga un `Bcc` invisible, o un `From` que no es
//! quien escribe, en un mensaje que la persona cree estar escribiendo ella.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// El esquema, tal cual empieza un URI de correo.
const ESQUEMA: &str = "mailto:";

/// Un mensaje nuevo pedido desde afuera.
///
/// Los nombres van como los espera el frontend, que ya tiene su propio borrador
/// con estos campos.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
pub struct MailtoDraft {
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body: String,
}

/// El evento con el que se le avisa a la ventana que abra un mensaje.
pub const EVENTO: &str = "mailto";

/// El `mailto:` del arranque, hasta que el frontend lo venga a buscar.
///
/// Hace falta porque los tiempos no dan: cuando el programa lee sus argumentos
/// el WebView ni existe, así que emitir el evento ahí es emitirlo a nadie. Se
/// guarda, y la ventana lo pide cuando está lista.
#[derive(Default)]
pub struct PendingMailto(pub Mutex<Option<MailtoDraft>>);

/// Guarda el `mailto:` con el que se abrió la aplicación, si hubo uno.
pub fn guardar_el_del_arranque<R: Runtime>(app: &AppHandle<R>) {
    let argumentos: Vec<String> = std::env::args().collect();
    let pedido = find_in(&argumentos).and_then(parse);

    app.manage(PendingMailto(Mutex::new(pedido)));
}

/// Atiende el `mailto:` de una segunda invocación.
///
/// Acá sí se emite: la ventana existe y está escuchando. Es el camino de «hacer
/// clic en una dirección con el correo ya abierto», que es la mitad de las
/// veces.
pub fn atender<R: Runtime>(app: &AppHandle<R>, argumentos: &[String]) {
    let Some(pedido) = find_in(argumentos).and_then(parse) else {
        return;
    };

    if let Err(error) = app.emit(EVENTO, pedido) {
        eprintln!("[mailto] no se pudo avisar a la ventana: {error}");
    }
}

/// El primer `mailto:` que haya entre los argumentos, si hay alguno.
///
/// El primero y no el último: un lanzador que pase dos es un lanzador roto, y
/// abrir dos ventanas de redacción por un clic sería peor que atender uno solo.
pub fn find_in<S: AsRef<str>>(args: &[S]) -> Option<&str> {
    args.iter().map(|arg| arg.as_ref()).find(|arg| {
        arg.len() >= ESQUEMA.len() && arg[..ESQUEMA.len()].eq_ignore_ascii_case(ESQUEMA)
    })
}

/// Lee un `mailto:` y devuelve qué mensaje abrir.
///
/// Devuelve `None` si no es un `mailto:`. Un `mailto:` **vacío** sí es válido
/// —`mailto:` a secas quiere decir «abrime un mensaje nuevo»— y devuelve un
/// borrador sin nada puesto.
pub fn parse(uri: &str) -> Option<MailtoDraft> {
    if uri.len() < ESQUEMA.len() || !uri[..ESQUEMA.len()].eq_ignore_ascii_case(ESQUEMA) {
        return None;
    }

    let resto = &uri[ESQUEMA.len()..];
    let (destinatarios, consulta) = match resto.split_once('?') {
        Some((destinatarios, consulta)) => (destinatarios, consulta),
        None => (resto, ""),
    };

    let mut draft = MailtoDraft {
        to: direcciones(destinatarios),
        ..Default::default()
    };

    for campo in consulta.split('&').filter(|campo| !campo.is_empty()) {
        let (nombre, valor) = campo.split_once('=').unwrap_or((campo, ""));
        let valor = decodificar(valor);

        // El nombre también viene codificado, según el RFC. Se decodifica antes
        // de comparar: `%73ubject` es `subject`, y sin esto sería un campo
        // desconocido que se descarta en silencio.
        match decodificar(nombre).to_ascii_lowercase().as_str() {
            "to" => draft.to.extend(direcciones(&valor)),
            "cc" => draft.cc.extend(direcciones(&valor)),
            "bcc" => draft.bcc.extend(direcciones(&valor)),
            // El último gana, que es lo que hace todo el mundo. Concatenar dos
            // asuntos daría uno que no escribió nadie.
            "subject" => draft.subject = valor,
            "body" => draft.body = valor,
            _ => {}
        }
    }

    Some(draft)
}

/// Una lista separada por comas, decodificada y sin huecos.
///
/// Las vacías se tiran: `mailto:?cc=uno@ejemplo.com` tiene la ruta vacía, y una
/// dirección en blanco en la lista de destinatarios es un renglón vacío en la
/// ventana de redacción que después hay que borrar a mano.
fn direcciones(lista: &str) -> Vec<String> {
    lista
        .split(',')
        .map(decodificar)
        .map(|una| una.trim().to_string())
        .filter(|una| !una.is_empty())
        .collect()
}

/// Deshace la codificación por ciento.
///
/// Lo que no es una secuencia válida se deja tal cual en vez de descartarse: un
/// `%` suelto —que pasa, y bastante— no puede ser motivo de perder el asunto
/// entero. Y lo que se decodifica se junta como bytes y recién ahí se lee como
/// UTF-8, porque un carácter acentuado son dos secuencias `%XX` y leerlas de a
/// una daría dos mitades que no son nada.
fn decodificar(texto: &str) -> String {
    let bytes = texto.as_bytes();
    let mut salida: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let alto = (bytes[i + 1] as char).to_digit(16);
            let bajo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(alto), Some(bajo)) = (alto, bajo) {
                salida.push((alto * 16 + bajo) as u8);
                i += 3;
                continue;
            }
        }
        salida.push(bytes[i]);
        i += 1;
    }

    // Lo que no sea UTF-8 se reemplaza en lugar de tirar el campo: un asunto con
    // un byte suelto se lee raro, pero se lee.
    String::from_utf8_lossy(&salida).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leer(uri: &str) -> MailtoDraft {
        parse(uri).expect("tiene que ser un mailto válido")
    }

    #[test]
    fn el_destinatario_sale_de_la_ruta() {
        assert_eq!(leer("mailto:pepe@ejemplo.com").to, vec!["pepe@ejemplo.com"]);
    }

    #[test]
    fn varios_destinatarios_separados_por_coma() {
        assert_eq!(
            leer("mailto:uno@ejemplo.com,dos@ejemplo.com").to,
            vec!["uno@ejemplo.com", "dos@ejemplo.com"]
        );
    }

    #[test]
    fn el_asunto_y_el_cuerpo_salen_de_la_consulta() {
        let draft = leer("mailto:pepe@ejemplo.com?subject=Hola&body=Qu%C3%A9%20tal");

        assert_eq!(draft.subject, "Hola");
        assert_eq!(draft.body, "Qué tal");
    }

    #[test]
    fn el_acento_se_arma_con_los_dos_bytes_juntos() {
        // Decodificando de a una secuencia, `%C3` y `%A9` son dos mitades de un
        // carácter y ninguna de las dos es nada: el asunto salía con dos
        // rombitos en lugar de la «é».
        assert_eq!(leer("mailto:?subject=Sesi%C3%B3n").subject, "Sesión");
    }

    #[test]
    fn el_mas_es_un_mas_y_no_un_espacio() {
        // En un formulario web `+` es espacio; en un `mailto:` no, y traducirlo
        // convertiría `pepe+facturas@ejemplo.com` —una dirección con etiqueta,
        // que mucha gente usa— en una que no existe.
        assert_eq!(
            leer("mailto:pepe+facturas@ejemplo.com").to,
            vec!["pepe+facturas@ejemplo.com"]
        );
    }

    #[test]
    fn el_espacio_se_escribe_codificado() {
        assert_eq!(
            leer("mailto:?subject=dos%20palabras").subject,
            "dos palabras"
        );
    }

    #[test]
    fn cc_y_bcc_se_entienden() {
        let draft = leer("mailto:uno@ejemplo.com?cc=dos@ejemplo.com&bcc=tres@ejemplo.com");

        assert_eq!(draft.cc, vec!["dos@ejemplo.com"]);
        assert_eq!(draft.bcc, vec!["tres@ejemplo.com"]);
    }

    #[test]
    fn el_campo_to_se_suma_al_de_la_ruta() {
        // El RFC deja las dos formas, y hay páginas que usan las dos a la vez.
        assert_eq!(
            leer("mailto:uno@ejemplo.com?to=dos@ejemplo.com").to,
            vec!["uno@ejemplo.com", "dos@ejemplo.com"]
        );
    }

    #[test]
    fn los_campos_no_distinguen_mayusculas() {
        assert_eq!(leer("mailto:?SUBJECT=Hola").subject, "Hola");
    }

    #[test]
    fn el_esquema_tampoco() {
        // Lo que pasa un navegador puede venir como `MAILTO:`.
        assert_eq!(leer("MailTo:pepe@ejemplo.com").to, vec!["pepe@ejemplo.com"]);
    }

    #[test]
    fn los_encabezados_que_no_estan_permitidos_se_descartan() {
        // El RFC deja mandar encabezados arbitrarios. Es la manera de que una
        // página ponga un `From` que no es quien escribe, o un `Reply-To` a otro
        // lado, en un mensaje que la persona cree estar escribiendo ella.
        let draft = leer("mailto:pepe@ejemplo.com?from=otro@ejemplo.com&reply-to=otro@ejemplo.com");

        assert_eq!(draft.to, vec!["pepe@ejemplo.com"]);
        assert_eq!(draft.subject, "");
        assert_eq!(draft.body, "");
    }

    #[test]
    fn un_mailto_vacio_es_un_mensaje_en_blanco() {
        // «Escribir un correo» sin decir a quién. Es válido, y lo usan los
        // lanzadores para ofrecer «mensaje nuevo».
        assert_eq!(parse("mailto:"), Some(MailtoDraft::default()));
    }

    #[test]
    fn lo_que_no_es_un_mailto_no_es_nada() {
        assert_eq!(parse("https://ejemplo.com"), None);
        assert_eq!(parse(""), None);
        assert_eq!(parse("mailt"), None);
    }

    #[test]
    fn un_porcentaje_suelto_no_se_lleva_puesto_el_campo() {
        // Pasa, y bastante: un asunto con «100% libre» sin codificar.
        assert_eq!(leer("mailto:?subject=100%%20libre").subject, "100% libre");
        assert_eq!(leer("mailto:?subject=100%").subject, "100%");
    }

    #[test]
    fn las_direcciones_vacias_no_ocupan_un_renglon() {
        // `mailto:?cc=…` tiene la ruta vacía, y una coma de más también pasa.
        let draft = leer("mailto:?cc=uno@ejemplo.com,,");

        assert!(draft.to.is_empty());
        assert_eq!(draft.cc, vec!["uno@ejemplo.com"]);
    }

    #[test]
    fn se_encuentra_entre_los_demas_argumentos() {
        let args = [
            "/usr/bin/vasak-mail".to_string(),
            "mailto:pepe@ejemplo.com".to_string(),
        ];

        assert_eq!(find_in(&args), Some("mailto:pepe@ejemplo.com"));
    }

    #[test]
    fn sin_ningun_mailto_no_hay_nada_que_abrir() {
        let args = ["/usr/bin/vasak-mail".to_string(), "--algo".to_string()];

        assert_eq!(find_in(&args), None);
    }

    #[test]
    fn el_primero_gana() {
        // Dos es un lanzador roto; abrir dos ventanas de redacción por un clic
        // sería peor que atender una sola.
        let args = [
            "mailto:uno@ejemplo.com".to_string(),
            "mailto:dos@ejemplo.com".to_string(),
        ];

        assert_eq!(find_in(&args), Some("mailto:uno@ejemplo.com"));
    }
}
