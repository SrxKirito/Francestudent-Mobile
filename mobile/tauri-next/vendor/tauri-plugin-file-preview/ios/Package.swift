// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "tauri-plugin-file-preview",
    platforms: [.iOS(.v13)],
    products: [.library(name: "tauri-plugin-file-preview", type: .static, targets: ["tauri-plugin-file-preview"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "tauri-plugin-file-preview", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
