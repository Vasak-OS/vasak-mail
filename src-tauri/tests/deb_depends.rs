//! Que la lista de dependencias del `.deb` sea la de esta aplicación.
//!
//! Venía copiada de la plantilla `vapp`, igual que en otras diez del taller:
//! `libsoup2.4-1` junto con `libsoup-3.0-0` —las dos generaciones, y el binario
//! sólo enlaza la 3—, `libpango-1.0-0` sin enlazarla, y sin `libdbus-1-3` ni
//! `libjavascriptcoregtk-4.1-0`, que el binario sí enlaza. Tampoco declaraba el
//! servicio de cuentas, que es de donde sale todo el correo: esta ventana no
//! habla IMAP.
//!
//! Una entrada puede llevar su piso de versión con la sintaxis de Debian
//! —`vasak-accounts (>= 0.10.0)`—; las pruebas miran el nombre de paquete.
//!
//! Lo que se declara se audita con `readelf -d … | grep NEEDED`, nunca con
//! `ldd`. Estas pruebas no reemplazan esa auditoría: cuidan que no vuelva lo
//! que se sacó y que no falte lo que se sabe que se enlaza.

use std::path::PathBuf;

/// Las entradas tal como están escritas, con el piso de versión si lo llevan.
fn deb_entries() -> Vec<String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("no se pudo leer {}: {e}", path.display()));
    let config: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("{} no es JSON válido: {e}", path.display()));
    config["bundle"]["linux"]["deb"]["depends"]
        .as_array()
        .expect("bundle.linux.deb.depends tiene que existir")
        .iter()
        .map(|v| {
            v.as_str()
                .expect("cada dependencia es un texto")
                .to_string()
        })
        .collect()
}

/// Sólo el nombre de cada paquete, sin el piso de versión.
fn deb_depends() -> Vec<String> {
    deb_entries()
        .iter()
        .map(|entry| {
            entry
                .split_once(" (")
                .map_or(entry.as_str(), |(name, _)| name)
                .to_string()
        })
        .collect()
}

#[test]
fn las_dependencias_del_deb_tienen_nombre_de_debian() {
    for name in deb_depends() {
        // Los nombres de paquete de Debian: minúsculas, dígitos y `+-.`.
        let valid = name.len() >= 2
            && name
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric())
            && name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "+-.".contains(c));
        assert!(valid, "«{name}» no es un nombre de paquete de Debian");
        assert!(
            !name.ends_with("-devel") && !name.starts_with("gstreamer1-"),
            "«{name}» es un nombre de Fedora, no de Debian"
        );
        assert!(
            !name.ends_with("-dev"),
            "«{name}» es de compilación: el paquete instalado no lo usa"
        );
    }
}

#[test]
fn las_dependencias_del_deb_no_se_repiten() {
    let mut seen = std::collections::BTreeSet::new();
    for name in deb_depends() {
        assert!(seen.insert(name.clone()), "«{name}» está dos veces");
    }
}

/// Lo que traía la plantilla `vapp` y el binario no enlaza: libsoup 2.4 —el
/// binario usa la 3— y pango, que llega por GTK pero no se enlaza directo.
#[test]
fn no_viaja_lo_que_el_binario_no_enlaza() {
    let depends = deb_depends();
    for package in ["libsoup2.4-1", "libpango-1.0-0"] {
        assert!(
            !depends.iter().any(|n| n == package),
            "{package} no la enlaza el binario: viene de la plantilla"
        );
    }
}

/// Lo que `readelf -d` muestra enlazado, con su paquete de Debian. Si una de
/// éstas deja de enlazarse, se saca de la lista y de acá a la vez.
#[test]
fn estan_las_bibliotecas_que_el_binario_enlaza() {
    let depends = deb_depends();
    for (soname, package) in [
        ("libc.so.6", "libc6"),
        ("libgcc_s.so.1", "libgcc-s1"),
        ("libcairo.so.2", "libcairo2"),
        ("libdbus-1.so.3", "libdbus-1-3"),
        ("libgdk_pixbuf-2.0.so.0", "libgdk-pixbuf-2.0-0"),
        ("libglib-2.0.so.0", "libglib2.0-0t64"),
        ("libgtk-3.so.0", "libgtk-3-0t64"),
        (
            "libjavascriptcoregtk-4.1.so.0",
            "libjavascriptcoregtk-4.1-0",
        ),
        ("libsoup-3.0.so.0", "libsoup-3.0-0"),
        ("libwebkit2gtk-4.1.so.0", "libwebkit2gtk-4.1-0"),
    ] {
        assert!(
            depends.iter().any(|n| n == package),
            "el binario enlaza {soname} y el .deb no declara {package}"
        );
    }
}

/// Lo que no se enlaza pero se usa en ejecución: la lista y el texto de cada
/// mensaje se los pide a vasak-accounts por el bus de sesión.
#[test]
fn estan_los_programas_que_se_usan_sin_enlazarlos() {
    let depends = deb_depends();
    for package in ["vasak-accounts", "dbus"] {
        assert!(
            depends.iter().any(|n| n == package),
            "falta {package} en el .deb"
        );
    }
}

/// El piso de versión del servicio es el contrato de D-Bus, el mismo que la
/// receta de Arch: con uno anterior falta `GetAttachment` y guardar un adjunto
/// recibido no tiene a quién pedirle el archivo.
#[test]
fn el_servicio_de_cuentas_lleva_su_piso_de_version() {
    assert!(
        deb_entries()
            .iter()
            .any(|entry| entry == "vasak-accounts (>= 0.10.0)"),
        "vasak-accounts tiene que ir con «(>= 0.10.0)», como en la receta de Arch"
    );
}
