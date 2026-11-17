fn main() {
    tauri_plugin::Builder::new(&["open"])
        .ios_path("ios")
        .build();
}
