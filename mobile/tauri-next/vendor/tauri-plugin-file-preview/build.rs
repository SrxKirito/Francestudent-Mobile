fn main() {
    tauri_plugin::Builder::new(&["open", "export_file"])
        .ios_path("ios")
        .build();
}
