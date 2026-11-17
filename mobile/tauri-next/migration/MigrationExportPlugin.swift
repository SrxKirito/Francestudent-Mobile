import Foundation
import Capacitor

// Install in the Capacitor target and register only for the migration release.
// The only writable paths are generated internally; callers never supply paths.
@objc(MigrationExportPlugin)
public final class MigrationExportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MigrationExportPlugin"
    public let jsName = "MigrationExport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "append", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "commit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abort", returnType: CAPPluginReturnPromise)
    ]
    private struct Transfer { let url: URL; let handle: FileHandle }
    private let queue = DispatchQueue(label: "org.francestudent.migration-export")
    private var transfers: [String: Transfer] = [:]

    @objc func begin(_ call: CAPPluginCall) {
        queue.async {
            do {
                let id = UUID().uuidString
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("fs-migration-" + id + ".partial")
                guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else { throw CocoaError(.fileWriteUnknown) }
                do { self.transfers[id] = Transfer(url: url, handle: try FileHandle(forWritingTo: url)) }
                catch { try? FileManager.default.removeItem(at: url); throw error }
                call.resolve(["id": id])
            } catch { call.reject("Création de la sauvegarde temporaire impossible.") }
        }
    }

    @objc func append(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let encoded = call.getString("data"), encoded.utf8.count <= 100_000,
              let data = Data(base64Encoded: encoded), !data.isEmpty, data.count <= 64 * 1024 else { call.reject("Bloc de sauvegarde invalide."); return }
        queue.async {
            guard let item = self.transfers[id] else { call.reject("Sauvegarde interrompue."); return }
            do { try item.handle.write(contentsOf: data); call.resolve() }
            catch { call.reject("Écriture de la sauvegarde impossible.") }
        }
    }

    @objc func commit(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("Sauvegarde invalide."); return }
        queue.async {
            guard let item = self.transfers[id] else { call.reject("Sauvegarde interrompue."); return }
            do {
                try item.handle.synchronize(); try item.handle.close()
                let folder = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let destination = folder.appendingPathComponent("FranceStudent-" + id + ".fsbackup")
                try FileManager.default.moveItem(at: item.url, to: destination)
                self.transfers.removeValue(forKey: id)
                call.resolve(["name": destination.lastPathComponent])
            } catch { self.transfers.removeValue(forKey: id); try? item.handle.close(); try? FileManager.default.removeItem(at: item.url); call.reject("Finalisation de la sauvegarde impossible.") }
        }
    }

    @objc func abort(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("Sauvegarde invalide."); return }
        queue.async {
            if let item = self.transfers.removeValue(forKey: id) { try? item.handle.close(); try? FileManager.default.removeItem(at: item.url) }
            call.resolve()
        }
    }
}
