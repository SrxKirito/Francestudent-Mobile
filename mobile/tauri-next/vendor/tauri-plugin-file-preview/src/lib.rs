use serde::Serialize;
use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, AppHandle, Manager, Runtime};

tauri::ios_plugin_binding!(init_plugin_file_preview);

struct FilePreview<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
struct OpenRequest { path: String }

#[tauri::command]
async fn open<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    app.state::<FilePreview<R>>()
        .0
        .run_mobile_plugin::<()>("open", OpenRequest { path })
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn export_file<R: Runtime>(app: AppHandle<R>, path: String) -> Result<String, String> {
    app.state::<FilePreview<R>>()
        .0
        .run_mobile_plugin::<String>("exportFile", OpenRequest { path })
        .map_err(|error| error.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("file-preview")
        .invoke_handler(tauri::generate_handler![open, export_file])
        .setup(|app, api| {
            let handle = api.register_ios_plugin(init_plugin_file_preview)?;
            app.manage(FilePreview(handle));
            Ok(())
        })
        .build()
}
