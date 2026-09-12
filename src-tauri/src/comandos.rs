//! Lo que la ventana le puede pedir al programa.
//!
//! Una capa fina sobre `correo.rs`: todo el trabajo lo hace el sincronizador.

use crate::correo::{self, Abierto, Borrador, Casilla, Cuenta, Resumen, Saliente};

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
pub async fn abrir_mensaje(
    account_id: String,
    casilla: String,
    uid: u32,
) -> Result<Abierto, String> {
    correo::abrir(&account_id, &casilla, uid).await
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
