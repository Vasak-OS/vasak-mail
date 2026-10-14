//! Volver a pedir el permiso de leer el correo del almacén local (ola 2 de
//! «pedir permiso de nuevo», vasak-mail; pedido del 13/10/2026).
//!
//! Cuando la ventana no tiene permiso para leer el correo guardado, lo que ve
//! la persona es el estado «sin permiso» ([`crate::correo::STORE_PERMISSION_DENIED`]).
//! Un rechazo recordado no se vuelve a preguntar con sólo reintentar la lectura:
//! el chequeo de permiso sólo reabre el diálogo cuando la decisión está en
//! `unknown`. Para que reaparezca hace falta que `vasak-permissions` **olvide**
//! la decisión de la ventana sobre ese recurso, y para eso existe `RequestAgain`:
//!
//! - va al servicio de permisos, en el **bus de sistema**
//!   (`ar.net.vasak.os.Permissions`);
//! - identifica a quien llama por su conexión (pid → `/proc/<pid>/exe`), así que
//!   sólo puede re-pedir **para sí mismo**: no lleva ninguna ruta de binario y
//!   toma sólo el id del recurso;
//! - **nunca concede**: lo más que hace es dejar la decisión en `unknown`, para
//!   que el próximo chequeo vuelva a abrir el diálogo;
//! - tiene un techo de frecuencia contra la fatiga de permisos: un segundo
//!   pedido demasiado seguido contesta `LimitsExceeded` y no reabre nada.
//!
//! Tras un re-pedido con éxito la ventana vuelve a leer el correo, y es esa
//! lectura la que dispara el diálogo nuevo.
//!
//! La lógica vive acá —el mapeo de cada error a un desenlace y el puente del
//! método—, que es lo que se prueba contra un servicio de permisos de mentira.
//! El comando de Tauri que abre el bus de sistema es una capa fina sobre
//! [`request_again`] y vive en `comandos.rs`, con el resto de los comandos.

use serde::Serialize;
use zbus::Connection;

/// El servicio de permisos, en el bus de sistema. Son los mismos nombres que
/// `vasak_permissions_protocol::{SERVICE_NAME, SERVICE_PATH, SERVICE_INTERFACE,
/// REQUEST_AGAIN_METHOD}`; se escriben acá para no sumar esa dependencia —ni su
/// par de listas— por una sola llamada.
pub(crate) const SERVICE_NAME: &str = "ar.net.vasak.os.Permissions";
const SERVICE_PATH: &str = "/ar/net/vasak/os/Permissions";
const SERVICE_INTERFACE: &str = "ar.net.vasak.os.Permissions";
const REQUEST_AGAIN_METHOD: &str = "RequestAgain";

/// El recurso de `vasak-permissions` para leer el correo guardado, distinto de
/// `account.email`, que entregaría la credencial (y que esta ventana no pide
/// nunca). Es `EMAIL_RESOURCE` de `vasak-accounts/sync/src/access.rs`.
pub(crate) const EMAIL_RESOURCE: &str = "store.email";

/// Lo que se le contesta a la ventana tras pedir volver a preguntar.
///
/// Son los cuatro desenlaces que la ventana sabe dibujar; cada error de D-Bus
/// de `RequestAgain` cae en uno ([`classify`]). El texto que ve la persona lo
/// pone el frontend: acá sólo viaja qué pasó.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub(crate) enum ReaskOutcome {
    /// Se olvidó la decisión anterior: el próximo chequeo reabre el diálogo. La
    /// ventana ya puede volver a leer el correo.
    Reopened,
    /// Se volvió a pedir hace muy poco; el techo de frecuencia no reabrió nada.
    /// Hay que esperar un momento (`LimitsExceeded`).
    TooSoon,
    /// La ventana no puede pedir este recurso, así que tampoco volver a pedirlo
    /// (`AccessDenied` / `AuthFailed`).
    NotAllowed,
    /// Cualquier otra cosa: el servicio de permisos no está, o falló.
    Failed { detail: String },
}

/// Qué quiere decir el nombre de un error de D-Bus para la ventana.
fn classify_name(name: &str) -> Option<ReaskOutcome> {
    match name {
        "org.freedesktop.DBus.Error.LimitsExceeded" => Some(ReaskOutcome::TooSoon),
        "org.freedesktop.DBus.Error.AccessDenied" | "org.freedesktop.DBus.Error.AuthFailed" => {
            Some(ReaskOutcome::NotAllowed)
        }
        _ => None,
    }
}

/// Cómo se lee un error de `RequestAgain`.
fn classify(error: zbus::Error) -> ReaskOutcome {
    match &error {
        zbus::Error::MethodError(name, _, _) => {
            classify_name(name.as_str()).unwrap_or_else(|| ReaskOutcome::Failed {
                detail: error.to_string(),
            })
        }
        zbus::Error::FDO(fdo) => match fdo.as_ref() {
            zbus::fdo::Error::LimitsExceeded(_) => ReaskOutcome::TooSoon,
            zbus::fdo::Error::AccessDenied(_) | zbus::fdo::Error::AuthFailed(_) => {
                ReaskOutcome::NotAllowed
            }
            other => ReaskOutcome::Failed {
                detail: other.to_string(),
            },
        },
        _ => ReaskOutcome::Failed {
            detail: error.to_string(),
        },
    }
}

/// Llama a `RequestAgain(resource)` en `destination`, por `connection`. Partido
/// del comando para poder probar cada desenlace contra un servicio de permisos
/// de mentira, del otro lado de un par de sockets, sin tocar el bus de sistema.
pub(crate) async fn request_again(
    connection: &Connection,
    destination: &str,
    resource: &str,
) -> ReaskOutcome {
    match connection
        .call_method(
            Some(destination),
            SERVICE_PATH,
            Some(SERVICE_INTERFACE),
            REQUEST_AGAIN_METHOD,
            &(resource,),
        )
        .await
    {
        Ok(_) => ReaskOutcome::Reopened,
        Err(error) => classify(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    // De tokio y no de `std`: `zbus` se compila acá con su característica
    // `tokio`, y entonces `unix_stream` pide este tipo.
    use tokio::net::UnixStream;
    use zbus::{connection, Guid};

    const TEST_DESTINATION: &str = ":1.permissions";

    /// Qué va a contestar el servicio de permisos de mentira a `RequestAgain`.
    #[derive(Clone, Copy, Default)]
    enum Answer {
        #[default]
        Ok,
        TooSoon,
        Denied,
        Failed,
    }

    /// Un `vasak-permissions` de mentira: contesta `RequestAgain` según `answer`
    /// y anota con qué recurso lo llamaron, para comprobar que va `store.email`
    /// y nada más.
    #[derive(Clone, Default)]
    struct FakePermissions {
        answer: Answer,
        resources: Arc<Mutex<Vec<String>>>,
    }

    #[zbus::interface(name = "ar.net.vasak.os.Permissions")]
    impl FakePermissions {
        fn request_again(&self, resource_id: String) -> zbus::fdo::Result<()> {
            self.resources.lock().unwrap().push(resource_id);
            match self.answer {
                Answer::Ok => Ok(()),
                Answer::TooSoon => {
                    Err(zbus::fdo::Error::LimitsExceeded("esperá un momento".into()))
                }
                Answer::Denied => Err(zbus::fdo::Error::AccessDenied("fuera de alcance".into())),
                Answer::Failed => Err(zbus::fdo::Error::Failed("se rompió".into())),
            }
        }
    }

    async fn connect(service: FakePermissions) -> Connection {
        let guid = Guid::generate();
        let (client, server) = UnixStream::pair().unwrap();
        let server = async move {
            connection::Builder::unix_stream(server)
                .server(guid)?
                .p2p()
                .serve_at(SERVICE_PATH, service)?
                .build()
                .await
        };
        let client = connection::Builder::unix_stream(client).p2p().build();
        let (client, server) = futures_util::try_join!(client, server).unwrap();
        // El servidor tiene que seguir vivo mientras dure la prueba.
        std::mem::forget(server);
        client
    }

    #[tokio::test]
    async fn un_re_pedido_con_exito_reabre_el_dialogo_y_pide_el_recurso_del_correo() {
        let service = FakePermissions {
            answer: Answer::Ok,
            ..Default::default()
        };
        let resources = service.resources.clone();
        let connection = connect(service).await;

        let outcome = request_again(&connection, TEST_DESTINATION, EMAIL_RESOURCE).await;

        assert_eq!(outcome, ReaskOutcome::Reopened);
        // Va exactamente el recurso del correo guardado, y ninguno más.
        assert_eq!(*resources.lock().unwrap(), vec!["store.email".to_string()]);
    }

    #[tokio::test]
    async fn un_re_pedido_demasiado_seguido_es_too_soon() {
        let connection = connect(FakePermissions {
            answer: Answer::TooSoon,
            ..Default::default()
        })
        .await;

        assert_eq!(
            request_again(&connection, TEST_DESTINATION, EMAIL_RESOURCE).await,
            ReaskOutcome::TooSoon
        );
    }

    #[tokio::test]
    async fn un_recurso_fuera_de_alcance_es_not_allowed() {
        let connection = connect(FakePermissions {
            answer: Answer::Denied,
            ..Default::default()
        })
        .await;

        assert_eq!(
            request_again(&connection, TEST_DESTINATION, EMAIL_RESOURCE).await,
            ReaskOutcome::NotAllowed
        );
    }

    #[tokio::test]
    async fn cualquier_otro_error_es_failed() {
        let connection = connect(FakePermissions {
            answer: Answer::Failed,
            ..Default::default()
        })
        .await;

        assert!(matches!(
            request_again(&connection, TEST_DESTINATION, EMAIL_RESOURCE).await,
            ReaskOutcome::Failed { .. }
        ));
    }

    #[test]
    fn los_errores_de_dbus_caen_en_un_desenlace() {
        assert_eq!(
            classify_name("org.freedesktop.DBus.Error.LimitsExceeded"),
            Some(ReaskOutcome::TooSoon)
        );
        assert_eq!(
            classify_name("org.freedesktop.DBus.Error.AccessDenied"),
            Some(ReaskOutcome::NotAllowed)
        );
        assert_eq!(
            classify_name("org.freedesktop.DBus.Error.AuthFailed"),
            Some(ReaskOutcome::NotAllowed)
        );
        assert_eq!(classify_name("org.freedesktop.DBus.Error.Failed"), None);
    }

    /// El `classify` sobre el `zbus::Error` entero, por los dos caminos por los
    /// que llega un error: el de un método con nombre y el `FDO` ya tipado.
    #[test]
    fn clasifica_el_error_entero_por_sus_dos_caminos() {
        let fdo = |e: zbus::fdo::Error| classify(zbus::Error::FDO(Box::new(e)));
        assert_eq!(
            fdo(zbus::fdo::Error::LimitsExceeded("x".into())),
            ReaskOutcome::TooSoon
        );
        assert_eq!(
            fdo(zbus::fdo::Error::AccessDenied("x".into())),
            ReaskOutcome::NotAllowed
        );
        assert_eq!(
            fdo(zbus::fdo::Error::AuthFailed("x".into())),
            ReaskOutcome::NotAllowed
        );
        assert!(matches!(
            fdo(zbus::fdo::Error::Failed("x".into())),
            ReaskOutcome::Failed { .. }
        ));
        // Un error que no es ni de método ni `FDO` cae en `Failed`.
        assert!(matches!(
            classify(zbus::Error::InvalidReply),
            ReaskOutcome::Failed { .. }
        ));
    }

    #[test]
    fn el_desenlace_viaja_con_su_nombre() {
        assert_eq!(
            serde_json::to_value(ReaskOutcome::Reopened).unwrap()["outcome"],
            "reopened"
        );
        assert_eq!(
            serde_json::to_value(ReaskOutcome::TooSoon).unwrap()["outcome"],
            "too_soon"
        );
        assert_eq!(
            serde_json::to_value(ReaskOutcome::NotAllowed).unwrap()["outcome"],
            "not_allowed"
        );
        let failed = serde_json::to_value(ReaskOutcome::Failed { detail: "x".into() }).unwrap();
        assert_eq!(failed["outcome"], "failed");
        assert_eq!(failed["detail"], "x");
    }

    #[test]
    fn el_recurso_es_el_del_correo_guardado() {
        // Si cambiara acá y no en `access.rs` de vasak-accounts, el re-pedido
        // iría a un recurso que el servicio de permisos no acota, y el diálogo
        // no reaparecería nunca.
        assert_eq!(EMAIL_RESOURCE, "store.email");
    }
}
