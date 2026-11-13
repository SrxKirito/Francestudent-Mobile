#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent;
mod browser;
mod desktop_host;
mod editor;
mod node_backend;
mod project_fs;
mod skills;
mod terminal;
mod versions;
mod workbench;
mod workspace;

fn main() {
    let result = if std::env::args_os().any(|arg| workbench::is_flag(&arg)) {
        workbench::launch()
    } else {
        desktop_host::launch()
    };
    if let Err(error) = result {
        desktop_host::alert(None, "FranceStudent IDE · Rust", &error.to_string());
        std::process::exit(1);
    }
}
