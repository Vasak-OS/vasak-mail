//! Lo que la ventana le puede pedir al programa.
//!
//! Una capa fina sobre `correo.rs`: todo el trabajo lo hace el sincronizador.

use crate::correo::{self, Abierto, Cuenta, Resumen};

/// Las cuentas con correo, y cuánto tienen sin leer.
#[tauri::command]
pub async fn listar_cuentas() -> Result<Vec<Cuenta>, String> {
    correo::cuentas().await
}

/// Los últimos mensajes de una cuenta.
#[tauri::command]
pub async fn listar_mensajes(account_id: String) -> Result<Vec<Resumen>, String> {
    correo::mensajes(&account_id).await
}

/// El texto de un mensaje.
#[tauri::command]
pub async fn abrir_mensaje(account_id: String, uid: u32) -> Result<Abierto, String> {
    correo::abrir(&account_id, uid).await
}

/// Marca un mensaje como leído en el servidor.
#[tauri::command]
pub async fn marcar_leido(account_id: String, uid: u32) -> Result<(), String> {
    correo::marcar_leido(&account_id, uid).await
}
