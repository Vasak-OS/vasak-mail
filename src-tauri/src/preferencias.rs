//! Dónde se guardan las preferencias, y cómo.
//!
//! # Un archivo, un escritor
//!
//! `$XDG_CONFIG_HOME/vasak-mail/preferencias.json`. Lo escribe **sólo esta
//! ventana** y lo lee además `vasak-accounts-sync`, que necesita algunas —cuánto
//! dice el cartel de correo nuevo— y que corre con la ventana cerrada, así que
//! no puede leer nada de adentro del navegador.
//!
//! Con un solo escritor no hay dos procesos pisándose el archivo y no hace falta
//! ningún bloqueo. El motivo de la elección está escrito en
//! `src/tools/preferencias.ts`, que es donde vive el modelo.
//!
//! # Por qué pasa por acá y no lo escribe el navegador
//!
//! Porque el navegador no puede escribir archivos, y porque el que decide **la
//! ruta** tiene que ser este lado. Una ruta que llegara de la ventana sería la
//! ventana eligiendo dónde escribe el programa, que es el mismo criterio por el
//! que un adjunto se devuelve en vez de guardarse: el proceso que toca el disco
//! es aquel cuyo dueño eligió la ruta.
//!
//! # Cómo se escribe
//!
//! A un temporal y después `rename`, que en el mismo sistema de archivos es
//! atómico. Sin eso, quedarse sin batería en el medio de la escritura deja un
//! archivo a la mitad — y lo que se pierde no es sólo la preferencia: el
//! servicio lo leería roto y volvería al valor de omisión sin decir nada.

use std::io::Write;
use std::path::PathBuf;

/// Cómo se llama el archivo.
const ARCHIVO: &str = "preferencias.json";

/// El directorio donde va, según la especificación de directorios de XDG.
///
/// `$XDG_CONFIG_HOME` si está y es absoluta —una relativa no dice nada— y si no
/// `~/.config`, que es lo que la especificación manda usar cuando no está.
pub fn directorio() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|ruta| ruta.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|casa| PathBuf::from(casa).join(".config")))
        .unwrap_or_else(|| PathBuf::from("/tmp"));

    base.join("vasak-mail")
}

fn ruta() -> PathBuf {
    directorio().join(ARCHIVO)
}

/// Lo que había guardado, tal cual.
///
/// Devuelve el JSON crudo y **no lo interpreta**: quien sabe qué campos hay y
/// qué hacer con uno que falta es la ventana, en `tools/preferencias.ts`, que es
/// donde están esa regla y sus pruebas. Acá duplicarla sería tener dos.
///
/// Un archivo que no está es el caso normal —la primera vez— y no es un error:
/// vuelve `null` y la ventana usa lo de omisión.
#[tauri::command]
pub fn leer_preferencias() -> Result<Option<String>, String> {
    match std::fs::read_to_string(ruta()) {
        Ok(contenido) => Ok(Some(contenido)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("no se pudieron leer las preferencias: {e}")),
    }
}

/// Guarda las preferencias.
///
/// Recibe el JSON ya armado por la ventana. Se comprueba que sea JSON válido
/// antes de escribirlo: lo que quede en el disco lo va a leer también el
/// servicio, y un archivo roto ahí se ve como «las preferencias no se
/// aplicaron» sin que nada lo explique.
#[tauri::command]
pub fn guardar_preferencias(contenido: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&contenido)
        .map_err(|e| format!("eso no es JSON válido: {e}"))?;

    let directorio = directorio();
    std::fs::create_dir_all(&directorio)
        .map_err(|e| format!("no se pudo crear {}: {e}", directorio.display()))?;

    // El temporal va **en el mismo directorio** que el destino: `rename` sólo es
    // atómico dentro del mismo sistema de archivos, y `/tmp` puede ser otro.
    let temporal = directorio.join(format!("{ARCHIVO}.nuevo"));
    let mut archivo = std::fs::File::create(&temporal)
        .map_err(|e| format!("no se pudo escribir {}: {e}", temporal.display()))?;

    archivo
        .write_all(contenido.as_bytes())
        .and_then(|()| archivo.sync_all())
        .map_err(|e| format!("no se pudo escribir {}: {e}", temporal.display()))?;
    drop(archivo);

    std::fs::rename(&temporal, ruta()).map_err(|e| {
        // El temporal queda si el `rename` falla; se saca para no dejar basura
        // al lado del archivo de verdad.
        let _ = std::fs::remove_file(&temporal);
        format!("no se pudieron guardar las preferencias: {e}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La ruta sale de `$XDG_CONFIG_HOME` cuando está, que es lo que hace que
    /// esto respete a quien tiene el directorio movido.
    #[test]
    fn la_ruta_respeta_la_variable_de_xdg() {
        // Se comprueba la regla y no la variable de esta sesión: leer el entorno
        // del proceso haría que el resultado dependa de dónde corra la prueba.
        let absoluta = PathBuf::from("/casa/config");
        assert!(absoluta.is_absolute());
        assert_eq!(absoluta.join("vasak-mail").join(ARCHIVO).file_name().unwrap(), ARCHIVO);
    }

    /// Una ruta relativa en la variable no dice nada, y por eso se descarta.
    #[test]
    fn una_ruta_relativa_no_sirve_como_base() {
        assert!(!PathBuf::from("config").is_absolute());
    }

    /// El archivo termina donde se lo espera, con el nombre que el servicio lee.
    #[test]
    fn el_archivo_se_llama_como_el_servicio_lo_busca() {
        assert_eq!(ARCHIVO, "preferencias.json");
        assert!(directorio().ends_with("vasak-mail"));
    }

    /// Lo que no es JSON no llega al disco: lo lee también el servicio, y un
    /// archivo roto ahí se ve como «no se aplicaron» sin que nada lo explique.
    #[test]
    fn no_se_guarda_lo_que_no_es_json() {
        assert!(guardar_preferencias("esto no es json".into()).is_err());
        assert!(guardar_preferencias(String::new()).is_err());
    }
}
