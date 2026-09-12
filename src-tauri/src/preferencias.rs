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
fn archivo() -> Result<PathBuf, String> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| "no se sabe dónde guardar la configuración".to_string())?;

    let directorio = base.join("vasak-mail");
    std::fs::create_dir_all(&directorio)
        .map_err(|e| format!("no se pudo crear la carpeta de configuración: {e}"))?;
    Ok(directorio.join("preferencias.json"))
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
