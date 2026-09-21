//! Las preferencias de la aplicación, del lado que las escribe.
//!
//! **Sólo esta ventana escribe. El servicio sólo lee.** Con un solo escritor no
//! hay carrera que resolver, y el cuidado de escribir un archivo del usuario
//! queda de este lado, que es el que lo tiene.
//!
//! Es `$XDG_CONFIG_HOME/vasak-mail/preferencias.json`, con el respaldo a
//! `~/.config` que dice el estándar.
//!
//! # Entero o nada
//!
//! Se escribe a un temporal en el mismo directorio y se reemplaza al final. Un
//! archivo de preferencias a medias no es un archivo con la mitad de las
//! preferencias: es uno que no se entiende, y el servicio lo trata como si no
//! existiera — o sea que un corte de luz en el momento justo dejaría los avisos
//! en lo más callado sin que nadie lo haya pedido.

use std::io::Write;
use std::path::PathBuf;

/// El archivo, y el directorio creado si hacía falta.
///
/// La base sale de `dirs` y no de leer el entorno acá. La diferencia no es de
/// estilo: leyéndolo a mano, una `XDG_CONFIG_HOME` **vacía o relativa** se
/// aceptaba, y como abajo se hace `create_dir_all` y se escribe, las
/// preferencias terminaban bajo el directorio de trabajo del proceso — distinto
/// según desde dónde se lanzó la ventana, y sin que nada fallara.
///
/// `dirs` ya implementa la regla que el estándar pide, y como una sola en vez
/// de dos: una cadena vacía tampoco es absoluta, así que los dos casos salen de
/// la misma comprobación. De `HOME` sólo mira que no esté vacía, así que el
/// filtro de acá cierra esa otra mitad.
fn archivo() -> Result<PathBuf, String> {
    let base = base_de_configuracion(dirs::config_dir())?;

    let directorio = base.join("vasak-mail");
    std::fs::create_dir_all(&directorio)
        .map_err(|e| format!("no se pudo crear la carpeta de configuración: {e}"))?;
    Ok(directorio.join("preferencias.json"))
}

/// La base, o el error que ya se mostraba.
///
/// Aparte de `archivo` para poder probarla sin tocar el entorno, que es global
/// al proceso y decide al azar el resultado de otras pruebas que corren en
/// paralelo.
fn base_de_configuracion(base: Option<PathBuf>) -> Result<PathBuf, String> {
    base.filter(|base| base.is_absolute())
        .ok_or_else(|| "no se sabe dónde guardar la configuración".to_string())
}

/// Lo que hay guardado, o un objeto vacío.
///
/// Se devuelve el JSON tal cual y no un tipo: así la ventana agrega
/// preferencias suyas sin tocar este archivo, y lo que no se conoce se conserva
/// en vez de perderse al guardar.
pub fn leer() -> String {
    archivo()
        .ok()
        .and_then(|ruta| std::fs::read_to_string(ruta).ok())
        .filter(|crudo| serde_json::from_str::<serde_json::Value>(crudo).is_ok())
        .unwrap_or_else(|| "{}".to_string())
}

/// Guarda una preferencia, conservando las demás.
///
/// Se lee, se cambia una clave y se escribe entero. Escribir sólo la clave que
/// cambió borraría el resto, y la ventana no siempre las tiene todas en memoria.
pub fn poner(clave: &str, valor: serde_json::Value) -> Result<(), String> {
    let mut todo: serde_json::Value =
        serde_json::from_str(&leer()).unwrap_or_else(|_| serde_json::json!({}));

    match todo.as_object_mut() {
        Some(objeto) => {
            objeto.insert(clave.to_string(), valor);
        }
        // Lo que había no era un objeto. Se reemplaza en vez de fallar: sin esto
        // un archivo raro dejaría las preferencias imposibles de cambiar.
        None => todo = serde_json::json!({ clave: valor }),
    }

    let texto = serde_json::to_string_pretty(&todo)
        .map_err(|e| format!("no se pudo armar la configuración: {e}"))?;
    escribir_entero(&archivo()?, texto.as_bytes())
}

/// Escribe entero o no escribe.
///
/// Mismo patrón que al guardar un adjunto y que el de `cola.rs` en el
/// sincronizador: temporal en el mismo directorio, sincronizar, reemplazar.
fn escribir_entero(destino: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let directorio = destino
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));
    let unico = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temporal = directorio.join(format!(".preferencias-{unico}-{}", std::process::id()));

    let escritura = (|| -> std::io::Result<()> {
        let mut archivo = std::fs::File::create(&temporal)?;
        archivo.write_all(bytes)?;
        archivo.sync_all()
    })();

    if let Err(e) = escritura {
        let _ = std::fs::remove_file(&temporal);
        return Err(format!("no se pudo guardar la configuración: {e}"));
    }

    std::fs::rename(&temporal, destino).map_err(|e| {
        let _ = std::fs::remove_file(&temporal);
        format!("no se pudo guardar la configuración: {e}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_base_absoluta_se_usa() {
        assert_eq!(
            base_de_configuracion(Some(PathBuf::from("/home/pato/.config"))),
            Ok(PathBuf::from("/home/pato/.config"))
        );
    }

    #[test]
    fn una_base_relativa_no_se_usa() {
        // Acá abajo se hace `create_dir_all` y se escribe, así que una base
        // relativa dejaba las preferencias bajo el directorio de trabajo del
        // proceso, distinto según desde dónde se lanzó la ventana.
        //
        // Las cuatro formas de no ser absoluta: la del nombre suelto es la que
        // se escapa cuando uno se acuerda sólo de la vacía.
        for relativa in ["", "config", "./config", "../config"] {
            assert!(
                base_de_configuracion(Some(PathBuf::from(relativa))).is_err(),
                "una base de {relativa:?} no tiene que aceptarse"
            );
        }
    }

    #[test]
    fn sin_base_se_devuelve_el_error_de_siempre() {
        // El mismo texto que antes: quien lo muestra no tiene que cambiar.
        assert_eq!(
            base_de_configuracion(None),
            Err("no se sabe dónde guardar la configuración".to_string())
        );
    }
}
