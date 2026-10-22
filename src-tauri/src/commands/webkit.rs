//! Afinado del WebKit de la ventana para bajar su consumo de memoria.
//!
//! Aparte del resto a propósito: es la capa que baja al `WebKitWebView` por el
//! árbol de GTK, y no se puede ejercitar sin un display ni un WebKit reales. Por
//! eso vive en `commands/`, que el análisis de cobertura del taller excluye
//! —igual que los `.vue`—: medir cobertura de lo que ninguna prueba puede montar
//! sólo bloquea sin informar.
//!
//! El afinado lo dispara el frontend al montar (`invoke('tune_webview')`): para
//! entonces la ventana y su webview ya existen, y así no hace falta un `.setup`
//! en `lib.rs` cuyas líneas no cubre ninguna prueba.

use gtk::prelude::*;

/// Busca el `WebKitWebView` dentro del árbol de widgets de la ventana.
///
/// wry lo anida un par de contenedores adentro, así que hay que bajar
/// recursivamente hasta dar con el tipo. Mismo criterio que vasak-file-manager.
fn find_webkit_webview(container: &gtk::Container) -> Option<webkit2gtk::WebView> {
    for child in container.children() {
        if child.type_().name() == "WebKitWebView" {
            return child.downcast::<webkit2gtk::WebView>().ok();
        }
        if let Some(child_container) = child.downcast_ref::<gtk::Container>() {
            if let Some(found) = find_webkit_webview(child_container) {
                return Some(found);
            }
        }
    }
    None
}

/// Baja el piso de memoria del webview con las palancas **seguras** para una
/// ventana común de aplicación: sin las extras de desarrollo, sin los gestos de
/// navegación atrás/adelante (no navega a ningún lado) y con el caché de un visor
/// de documento, no el de un navegador.
///
/// No se toca la aceleración por hardware ni WebGL: el correo anima con
/// transiciones de vista (`startViewTransition` al cambiar el tema y la casilla),
/// y apagar la GPU ahí las haría tironear.
fn tune_webkit(webview: &webkit2gtk::WebView) {
    use webkit2gtk::{CacheModel, SettingsExt, WebContextExt, WebViewExt};

    if let Some(settings) = WebViewExt::settings(webview) {
        settings.set_enable_developer_extras(false);
        settings.set_enable_back_forward_navigation_gestures(false);
    }
    if let Some(context) = WebViewExt::web_context(webview) {
        // No navega páginas: con el caché mínimo alcanza.
        context.set_cache_model(CacheModel::DocumentViewer);
    }
}

/// Afina el WebKit de la ventana que hace la llamada. Lo invoca el frontend una
/// vez al montar.
#[tauri::command]
pub fn tune_webview(window: tauri::WebviewWindow) {
    let Ok(gtk_window) = window.gtk_window() else {
        return;
    };
    let container = gtk_window.upcast::<gtk::Container>();
    let Some(webview) = find_webkit_webview(&container) else {
        eprintln!("[vasak-mail] no se encontró el WebKitWebView para afinar");
        return;
    };
    tune_webkit(&webview);
}
