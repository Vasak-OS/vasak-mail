//! Que el afinado del WebKit siga cableado de punta a punta.
//!
//! El glue de GTK no se puede ejercitar sin un display real, así que estas
//! pruebas no lo corren: cuidan que no se caiga ninguna de las tres piezas que
//! lo conectan —el comando que afina, su registro y la llamada del frontend al
//! montar—, que es justo lo que se rompe al refactorizar sin querer.

use std::path::PathBuf;

fn leer(rel: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("no se pudo leer {}: {e}", path.display()))
}

#[test]
fn el_comando_afina_con_las_palancas_seguras() {
    let src = leer("src/commands/webkit.rs");
    assert!(
        src.contains("pub fn tune_webview"),
        "falta el comando tune_webview"
    );
    for palanca in [
        "set_enable_developer_extras(false)",
        "set_enable_back_forward_navigation_gestures(false)",
        "CacheModel::DocumentViewer",
    ] {
        assert!(src.contains(palanca), "el afinado ya no aplica «{palanca}»");
    }
    // Las transiciones de vista de mail animan: no se apaga la GPU.
    assert!(
        !src.contains("set_hardware_acceleration_policy"),
        "no se toca la aceleración por hardware: mail usa transiciones de vista"
    );
}

#[test]
fn el_comando_esta_registrado() {
    assert!(
        leer("src/lib.rs").contains("commands::webkit::tune_webview"),
        "tune_webview no está en el generate_handler"
    );
}

#[test]
fn el_frontend_lo_invoca_al_montar() {
    assert!(
        leer("../src/App.vue").contains("invoke('tune_webview')"),
        "App.vue ya no invoca tune_webview al montar"
    );
}
