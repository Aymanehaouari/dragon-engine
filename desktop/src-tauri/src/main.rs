use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};
use url::Url;

const API_BASE: &str = "https://dragon-music.aymanehaouari25.workers.dev";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadResult {
    ok: bool,
    output_directory: String,
    output: String,
}

fn resources_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Could not locate DRAGON resources: {e}"))?
        .join("resources");

    if bundled.join("omniget.exe").exists() {
        return Ok(bundled);
    }

    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    if dev.join("omniget.exe").exists() {
        return Ok(dev);
    }

    Err("Bundled OmniGet engine was not found. Reinstall DRAGON.".into())
}

fn validate_media_url(raw: &str) -> Result<(), String> {
    let parsed = Url::parse(raw).map_err(|_| "Enter a valid http or https URL.".to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        _ => Err("Only http and https URLs are supported.".into()),
    }
}

#[tauri::command]
async fn dragon_api_get(path: String) -> Result<serde_json::Value, String> {
    if !(path.starts_with("/api/search?") || path == "/api/omniget") {
        return Err("Unsupported DRAGON API path.".into());
    }

    let response = reqwest::Client::new()
        .get(format!("{API_BASE}{path}"))
        .send()
        .await
        .map_err(|e| format!("DRAGON API request failed: {e}"))?;

    let status = response.status();
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("DRAGON API returned invalid JSON: {e}"))?;

    if !status.is_success() {
        return Err(
            value
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("DRAGON API request failed.")
                .to_string(),
        );
    }

    Ok(value)
}

#[tauri::command]
async fn omniget_download(
    app: AppHandle,
    url: String,
    mode: String,
) -> Result<DownloadResult, String> {
    validate_media_url(&url)?;

    let tools = resources_dir(&app)?;
    let omniget = tools.join("omniget.exe");
    let downloads = app
        .path()
        .download_dir()
        .map_err(|e| format!("Could not find your Downloads folder: {e}"))?;

    let mut args = vec![
        "--json".to_string(),
        "download".to_string(),
        url,
        "-o".to_string(),
        downloads.to_string_lossy().to_string(),
    ];

    if mode.eq_ignore_ascii_case("audio") {
        args.push("--audio-only".to_string());
    }

    let tools_for_task = tools.clone();
    let omniget_for_task = omniget.clone();

    let output = tauri::async_runtime::spawn_blocking(move || {
        let current_path = env::var_os("PATH").unwrap_or_default();
        let mut paths = vec![tools_for_task.clone()];
        paths.extend(env::split_paths(&current_path));
        let joined = env::join_paths(paths)
            .map_err(|e| format!("Could not prepare bundled tools: {e}"))?;

        let mut command = Command::new(omniget_for_task);
        command.args(args).env("PATH", joined);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }

        command.output().map_err(|e| format!("Could not start OmniGet: {e}"))
    })
    .await
    .map_err(|e| format!("OmniGet task failed: {e}"))??;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(if stderr.is_empty() {
            if stdout.is_empty() {
                "OmniGet could not process this URL.".into()
            } else {
                stdout
            }
        } else {
            stderr
        });
    }

    Ok(DownloadResult {
        ok: true,
        output_directory: downloads.to_string_lossy().to_string(),
        output: stdout,
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![dragon_api_get, omniget_download])
        .run(tauri::generate_context!())
        .expect("error while running DRAGON");
}
