import Foundation
import QuickLook
import Tauri
import UIKit

private struct OpenArgs: Decodable { let path: String }

/// Keeps the security-scoped URL alive until Quick Look is dismissed.
final class FilePreviewPlugin: Plugin, QLPreviewControllerDataSource, QLPreviewControllerDelegate, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    private var documentURL: URL?
    private var hasSecurityScope = false
    private var controller: QLPreviewController?
    private var exportRequest: Invoke?
    private weak var exportPicker: UIDocumentPickerViewController?

    @objc public func open(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(OpenArgs.self)
        guard !args.path.isEmpty, !args.path.contains("\0") else {
            invoke.reject("Chemin de fichier invalide.")
            return
        }
        let url: URL
        if args.path.hasPrefix("file:") {
            guard let parsed = URL(string: args.path), parsed.isFileURL, parsed.host == nil || parsed.host == "" || parsed.host == "localhost" else {
                invoke.reject("URL de fichier invalide.")
                return
            }
            url = parsed.standardizedFileURL.resolvingSymlinksInPath()
        } else {
            guard args.path.hasPrefix("/") else { invoke.reject("Chemin de fichier invalide."); return }
            url = URL(fileURLWithPath: args.path).standardizedFileURL.resolvingSymlinksInPath()
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { invoke.reject("Aperçu indisponible."); return }
            guard self.controller == nil else { invoke.reject("Un aperçu est déjà ouvert."); return }
            guard let presenter = self.manager.viewController, presenter.presentedViewController == nil else {
                invoke.reject("Impossible d’ouvrir l’aperçu maintenant.")
                return
            }
            let scoped = url.startAccessingSecurityScopedResource()
            let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.standardizedFileURL.resolvingSymlinksInPath()
            let inDocuments = documents.map { url.pathComponents.starts(with: $0.pathComponents) } ?? false
            guard scoped || inDocuments else {
                invoke.reject("Accès au fichier refusé. Sélectionne à nouveau sa destination.")
                return
            }
            guard FileManager.default.isReadableFile(atPath: url.path), QLPreviewController.canPreview(url as NSURL) else {
                if scoped { url.stopAccessingSecurityScopedResource() }
                invoke.reject("Ce fichier ne peut pas être ouvert par l’aperçu iOS.")
                return
            }
            let controller = QLPreviewController()
            controller.dataSource = self
            controller.delegate = self
            self.documentURL = url
            self.hasSecurityScope = scoped
            self.controller = controller
            presenter.present(controller, animated: true) { invoke.resolve() }
        }
    }

    @objc public func exportFile(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(OpenArgs.self)
        let url = URL(fileURLWithPath: args.path).standardizedFileURL.resolvingSymlinksInPath()
        let folder = url.deletingLastPathComponent()
        let root = folder.deletingLastPathComponent()
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.standardizedFileURL.resolvingSymlinksInPath()
        guard let cache = cache, root.lastPathComponent == "frst-exports", UUID(uuidString: folder.lastPathComponent) != nil,
              root.deletingLastPathComponent().pathComponents.starts(with: cache.pathComponents),
              (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else {
            invoke.reject("Fichier d’export indisponible.")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.exportRequest == nil,
                  let presenter = self.manager.viewController, presenter.presentedViewController == nil else {
                invoke.reject("Impossible d’ouvrir le sélecteur de fichiers maintenant.")
                return
            }
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = self
            picker.presentationController?.delegate = self
            self.exportRequest = invoke
            self.exportPicker = picker
            presenter.present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard controller === exportPicker else { return }
        finishExport(urls.first?.path)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if controller === exportPicker { finishExport(nil) }
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        if presentationController.presentedViewController === exportPicker { finishExport(nil) }
    }

    private func finishExport(_ path: String?) {
        let request = exportRequest
        exportPicker = nil
        exportRequest = nil
        if let path = path { request?.resolve(path) }
        else { request?.reject("Enregistrement annulé.") }
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { documentURL == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        return documentURL! as NSURL
    }
    func previewControllerDidDismiss(_ controller: QLPreviewController) {
        if hasSecurityScope { documentURL?.stopAccessingSecurityScopedResource() }
        hasSecurityScope = false
        documentURL = nil
        self.controller = nil
    }
}

@_cdecl("init_plugin_file_preview")
func initPluginFilePreview() -> Plugin { FilePreviewPlugin() }
