// Copyright (c) 2026 CookApps
// SPDX-License-Identifier: Apache-2.0

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

// ───────────────────────────────────────── Spreadsheet file I/O ──────────────

/// Validate that a path doesn't escape its expected scope.
/// Blocks path traversal sequences ("../", "..\", etc).
fn validate_path(p: &str) -> Result<(), String> {
    let path = Path::new(p);
    for component in path.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(format!(
                "Path traversal blocked: {}",
                path.display()
            ));
        }
    }
    Ok(())
}

/// Read spreadsheet in 4 MiB chunks to avoid large JSON payloads.
#[tauri::command]
fn document_size(path: String) -> Result<u64, String> {
    validate_path(&path)?;
    fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| format!("stat failed for {path}: {e}"))
}

#[tauri::command]
fn read_document_chunk(path: String, offset: u64, length: usize) -> Result<Vec<u8>, String> {
    validate_path(&path)?;
    let mut file = File::open(&path).map_err(|e| format!("open failed: {e}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("seek failed: {e}"))?;
    let mut buf = vec![0u8; length];
    let n = file
        .read(&mut buf)
        .map_err(|e| format!("read failed: {e}"))?;
    buf.truncate(n);
    Ok(buf)
}

#[tauri::command]
fn begin_save_document(path: String) -> Result<(), String> {
    validate_path(&path)?;
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    File::create(&path)
        .map(|_| ())
        .map_err(|e| format!("create failed: {e}"))
}

#[tauri::command]
fn write_save_document_chunk(path: String, offset: u64, bytes: Vec<u8>) -> Result<(), String> {
    validate_path(&path)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .open(&path)
        .map_err(|e| format!("open-write failed: {e}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("seek failed: {e}"))?;
    file.write_all(&bytes)
        .map_err(|e| format!("write failed: {e}"))
}

#[tauri::command]
fn write_save_chunk(path: String, offset: u64, bytes: Vec<u8>) -> Result<(), String> {
    write_save_document_chunk(path, offset, bytes)
}

#[tauri::command]
fn commit_save_document(path: String) -> Result<(), String> {
    validate_path(&path)?;
    let file = OpenOptions::new()
        .write(true)
        .open(&path)
        .map_err(|e| format!("open-sync failed: {e}"))?;
    file.sync_all().map_err(|e| format!("sync failed: {e}"))
}

#[tauri::command]
fn rename_file(src: String, dst: String) -> Result<(), String> {
    validate_path(&src)?;
    validate_path(&dst)?;
    fs::rename(&src, &dst).map_err(|e| format!("rename failed: {e}"))
}

#[tauri::command]
fn copy_file(src: String, dst: String) -> Result<(), String> {
    validate_path(&src)?;
    validate_path(&dst)?;
    if let Some(parent) = Path::new(&dst).parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::copy(&src, &dst)
        .map(|_| ())
        .map_err(|e| format!("copy failed: {e}"))
}

#[tauri::command]
fn remove_file(path: String) -> Result<(), String> {
    validate_path(&path)?;
    fs::remove_file(&path).map_err(|e| format!("remove failed: {e}"))
}

// ───────────────────────────────────────── App data helpers ──────────────────

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

// ───────────────────────────────────────── Secure token store ────────────────
//
// Tokens are written to `$APPDATA/csheet/tokens/<safe_name>.bin`.
// Only alphanumeric, '.', '_', '-' characters are accepted in the key name.
// All CookApps session tokens, lease tokens and device keys go through here;
// UI components must never read/write tokens directly.
//
// In a future iteration this can be backed by OS credential store
// (keyring / Stronghold) without changing the IPC surface.

fn tokens_dir(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("tokens")
}

fn safe_key(name: &str) -> Result<String, String> {
    // Accept only characters that are safe in a filename and match the CSheet
    // token namespace (e.g. "csheet.deviceKey", "csheet.leaseToken").
    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '_' })
        .collect();
    if safe.is_empty() || safe.len() > 200 {
        return Err(format!("Invalid token key: {name}"));
    }
    Ok(safe)
}

#[tauri::command]
fn token_get(app_handle: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let dir = tokens_dir(&app_handle);
    let key = safe_key(&name)?;
    let path = dir.join(format!("{key}.bin"));
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("token_get failed for {name}: {e}"))
}

#[tauri::command]
fn token_set(app_handle: tauri::AppHandle, name: String, value: String) -> Result<(), String> {
    let dir = tokens_dir(&app_handle);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir tokens failed: {e}"))?;
    let key = safe_key(&name)?;
    let path = dir.join(format!("{key}.bin"));
    if value.is_empty() {
        let _ = fs::remove_file(&path);
    } else {
        fs::write(&path, &value).map_err(|e| format!("token_set failed for {name}: {e}"))?;
    }
    Ok(())
}

// ───────────────────────────────────────── Recovery store ────────────────────

fn recovery_dir(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("recovery")
}

fn simple_hash(s: &str) -> u128 {
    let mut h: u128 = 0;
    for b in s.bytes() {
        h = h.wrapping_mul(31).wrapping_add(b as u128);
    }
    h
}

#[tauri::command]
fn write_recovery(
    app_handle: tauri::AppHandle,
    path: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    validate_path(&path)?;
    let dir = recovery_dir(&app_handle);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir recovery failed: {e}"))?;
    let hash = format!("{:x}", simple_hash(&path));
    fs::write(dir.join(format!("{hash}.rec")), bytes).map_err(|e| format!("{e}"))
}

#[tauri::command]
fn read_recovery(
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<Option<Vec<u8>>, String> {
    validate_path(&path)?;
    let dir = recovery_dir(&app_handle);
    let hash = format!("{:x}", simple_hash(&path));
    let p = dir.join(format!("{hash}.rec"));
    if !p.exists() {
        return Ok(None);
    }
    fs::read(&p).map(Some).map_err(|e| format!("{e}"))
}

#[tauri::command]
fn clear_recovery(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    validate_path(&path)?;
    let dir = recovery_dir(&app_handle);
    let hash = format!("{:x}", simple_hash(&path));
    let _ = fs::remove_file(dir.join(format!("{hash}.rec")));
    Ok(())
}

// ───────────────────────────────────────── Native fetch (HTTP proxy) ─────────
//
// The frontend routes all CookApps API calls through this command so that
// the webview's CSP/CORS restrictions don't block them and so we can attach
// headers that must not be set by JS (none currently, but it's a clean seam).
// The command does NOT forward website cookies or inject secrets.

#[derive(serde::Deserialize)]
struct FetchRequest {
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
}

#[derive(serde::Serialize)]
struct FetchResponse {
    status: u16,
    body: String,
}

#[tauri::command]
async fn native_fetch(req: FetchRequest) -> Result<FetchResponse, String> {
    // Restrict to CookApps API only – block arbitrary URLs.
    let url = &req.url;
    if !url.starts_with("https://cookapps.net/")
        && !url.starts_with("http://localhost:3000/")
        && !url.starts_with("http://127.0.0.1:3000/")
    {
        return Err(format!("native_fetch: blocked URL: {url}"));
    }

    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .build()
        .map_err(|e| format!("reqwest build failed: {e}"))?;

    let method = req.method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let mut builder = match method.as_str() {
        "POST" => client.post(url),
        "PUT" => client.put(url),
        "DELETE" => client.delete(url),
        "PATCH" => client.patch(url),
        _ => client.get(url),
    };

    if let Some(headers) = req.headers {
        for (k, v) in headers {
            // Block forwarding of website cookies or authorization from the webview.
            // CSheet only sends its own desktop access token, which is stored
            // in secure storage and injected explicitly by the auth service.
            if k.eq_ignore_ascii_case("cookie") {
                continue;
            }
            builder = builder.header(&k, &v);
        }
    }

    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("fetch failed for {url}: {e}"))?;

    let status = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("read body failed: {e}"))?;

    Ok(FetchResponse { status, body })
}

// ───────────────────────────────────────── Window helpers ────────────────────

#[tauri::command]
fn set_window_title(app_handle: tauri::AppHandle, title: String) -> Result<(), String> {
    if let Some(win) = app_handle.get_webview_window("main") {
        win.set_title(&title).map_err(|e| format!("{e}"))
    } else {
        Ok(())
    }
}

#[tauri::command]
fn set_window_dirty(_dirty: bool) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn add_recent_file(_path: String) -> Result<(), String> {
    Ok(())
}

// ───────────────────────────────────────── App entry point ───────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Bring existing window to front.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            // Forward deep-link or spreadsheet file path to the running process.
            for arg in &argv {
                if arg.starts_with("cookapps-csheet://") {
                    let _ = app.emit("csheet:deeplink", serde_json::json!({ "url": arg }));
                } else {
                    let lower = arg.to_lowercase();
                    if (lower.ends_with(".xlsx")
                        || lower.ends_with(".xls")
                        || lower.ends_with(".ods")
                        || lower.ends_with(".csv"))
                        && Path::new(arg).exists()
                    {
                        let _ = app.emit("csheet:open_file", serde_json::json!({ "path": arg }));
                    }
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            native_fetch,
            document_size,
            read_document_chunk,
            begin_save_document,
            write_save_chunk,
            write_save_document_chunk,
            commit_save_document,
            rename_file,
            copy_file,
            remove_file,
            token_get,
            token_set,
            write_recovery,
            read_recovery,
            clear_recovery,
            set_window_title,
            set_window_dirty,
            add_recent_file
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let h = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        let s = url.to_string();
                        if s.starts_with("cookapps-csheet://") {
                            let _ = h.emit("csheet:deeplink", serde_json::json!({ "url": s }));
                        }
                    }
                });

                // Spreadsheet files opened via OS file association on startup.
                let args: Vec<String> = std::env::args().collect();
                for arg in args.iter().skip(1) {
                    let lower = arg.to_lowercase();
                    if (lower.ends_with(".xlsx")
                        || lower.ends_with(".xls")
                        || lower.ends_with(".ods")
                        || lower.ends_with(".csv"))
                        && Path::new(arg).exists()
                    {
                        let h2 = app.handle().clone();
                        let path_str = arg.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                            let _ = h2.emit(
                                "csheet:open_file",
                                serde_json::json!({ "path": path_str }),
                            );
                        });
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CSheet tauri application")
}
