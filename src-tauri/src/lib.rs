//! Punto de entrada de una aplicación de VasakOS.
//!
//! Lo que hay acá no es decoración: cada pieza resuelve algo que en las
//! aplicaciones reales del escritorio se rompió al menos una vez.

mod comandos;
mod correo;
mod locales;
mod preferencias;
mod ventana;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // El idioma de la sesión. **Con la ruta explícita de los catálogos**:
        // el plugin sólo prueba rutas relativas al ejecutable y al directorio
        // de trabajo, y ninguna existe cuando el binario está en /usr/bin. Sin
        // esto, un paquete instalado muestra las claves crudas
        // («views.home.title») en lugar de los textos. Ver `locales.rs`.
        .plugin(tauri_plugin_i18n_vsk::init_with_path(
            Some(locales::idioma_del_sistema()),
            locales::directorio(),
        ))
        // El clic derecho abre el menú de VasakOS y no el del motor del
        // navegador, que ofrece «Recargar» e «Inspeccionar elemento».
        // El diario del sistema, con el nombre de esta aplicación. Va **primero**
        // de todos los plugins: instala el gancho de pánico, y un pánico mientras
        // arranca otro plugin es de los más probables y de los que menos rastro
        // dejan — sin esto, sólo queda un volcado de núcleo sin símbolos.
        .plugin(tauri_plugin_vsk_journal::init())
        // **Una sola ventana de correo, siempre.** Abrir la aplicación estando
        // ya abierta levanta la que hay en vez de dejar otra al lado.
        //
        // No es cosmético: el cartel de correo nuevo que muestra
        // `vasak-accounts-sync` tiene un botón «Abrir», y sin esto cada aviso
        // atendido dejaría una ventana más en el escritorio.
        //
        // Va **después** del diario y no primero, que es lo que recomienda el
        // plugin: lo único que hace una segunda instancia antes de morirse es
        // instalar el gancho de pánico, y a cambio se conserva la garantía de
        // que un pánico durante el arranque deja rastro.
        .plugin(tauri_plugin_single_instance::init(
            |app, _argumentos, _directorio| {
                ventana::traer_al_frente(app);
            },
        ))
        .plugin(tauri_plugin_vsk_contextual_menu::init())
        .plugin(tauri_plugin_config_manager::init())
        .plugin(tauri_plugin_vicons::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            comandos::listar_cuentas,
            comandos::listar_casillas,
            comandos::listar_mensajes,
            comandos::buscar_mensajes,
            comandos::traer_imagen,
            comandos::abrir_mensaje,
            comandos::marcar_leido,
            comandos::enviar_mensaje,
            comandos::leer_adjunto,
            comandos::guardar_adjunto,
            comandos::leer_preferencias,
            comandos::poner_preferencia,
            comandos::listar_salientes,
            comandos::descartar_saliente,
        ])
        // El sincronizador avisa cuando llega correo; esto lo traduce a un
        // evento que la ventana escucha. Ver `correo.rs`.
        .setup(|app| {
            correo::escuchar(app.handle().clone());
            // La ventana nace oculta y la muestra el frontend cuando ya tiene los
            // textos y el tema. Esto la muestra igual si el frontend nunca llega:
            // ver `ventana.rs`.
            ventana::mostrar_aunque_el_frontend_falle(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al ejecutar la aplicación");
}
