import SwiftUI
import WebKit
import UIKit
import UniformTypeIdentifiers

struct DragonWebView: UIViewRepresentable {
    let startURL: URL
    let audio: NativeAudioPlayer

    func makeCoordinator() -> Coordinator {
        Coordinator(audio: audio)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.preferredContentMode = .mobile
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.allowsInlineMediaPlayback = true

        let viewportScript = """
        (() => {
          let meta = document.querySelector('meta[name="viewport"]');
          if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'viewport';
            document.head.appendChild(meta);
          }
          meta.content = 'width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
          document.documentElement.style.width = '100%';
          document.documentElement.style.minHeight = '100%';
          document.documentElement.style.margin = '0';
          document.documentElement.style.padding = '0';
        })();
        """
        config.userContentController.addUserScript(
            WKUserScript(
                source: viewportScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(context.coordinator, name: "dragonAudio")

        let webView = WKWebView(frame: UIScreen.main.bounds, configuration: config)
        context.coordinator.webView = webView
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.contentInset = .zero
        webView.scrollView.verticalScrollIndicatorInsets = .zero
        webView.scrollView.horizontalScrollIndicatorInsets = .zero
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.scrollView.bounces = false
        webView.backgroundColor = .black
        webView.isOpaque = false

        var request = URLRequest(
            url: startURL,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 30
        )
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")
        webView.load(request)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "dragonAudio")
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, UIDocumentPickerDelegate {
        let audio: NativeAudioPlayer
        let library = OfflineLibrary()
        weak var webView: WKWebView?
        private var pendingImportTitle = ""
        private var pendingImportArtist = ""
        private var pendingImportArtwork = ""

        init(audio: NativeAudioPlayer) {
            self.audio = audio
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard message.name == "dragonAudio",
                  let body = message.body as? [String: Any],
                  let action = body["action"] as? String else {
                return
            }

            switch action {
            case "play":
                guard let raw = body["url"] as? String,
                      let url = URL(string: raw),
                      ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
                    return
                }

                audio.play(
                    url: url,
                    title: body["title"] as? String ?? "DRAGON",
                    artist: body["artist"] as? String ?? "",
                    artworkURL: (body["artwork"] as? String).flatMap(URL.init(string:))
                )

            case "pause":
                audio.pause()

            case "resume":
                audio.resume()

            case "stop":
                audio.stop()

            case "download":
                download(body)

            case "openConverter":
                openConverter(body)

            case "importMedia":
                presentMediaImporter(body)

            case "library":
                emitLibrary()

            case "playOffline":
                guard let id = body["id"] as? String,
                      let localURL = library.localURL(for: id),
                      let track = library.track(for: id) else {
                    emitError("Saved media was not found.")
                    return
                }

                if (track.kind ?? "audio") == "video" {
                    OfflineVideoPlayer.present(url: localURL)
                } else {
                    audio.play(
                        url: localURL,
                        title: track.title,
                        artist: track.artist,
                        artworkURL: URL(string: track.artwork)
                    )
                }

            case "deleteOffline":
                guard let id = body["id"] as? String else { return }
                do {
                    try library.delete(id: id)
                    emitLibrary()
                } catch {
                    emitError("Could not delete this saved track.")
                }

            default:
                break
            }
        }

        private func openConverter(_ body: [String: Any]) {
            guard let raw = body["youtubeUrl"] as? String,
                  let youtubeURL = URL(string: raw),
                  let host = youtubeURL.host?.lowercased(),
                  host == "youtube.com" || host == "www.youtube.com" || host == "m.youtube.com" || host == "youtu.be" else {
                emitError("Choose a valid YouTube video first.")
                return
            }

            pendingImportTitle = body["title"] as? String ?? ""
            pendingImportArtist = body["artist"] as? String ?? ""
            pendingImportArtwork = body["artwork"] as? String ?? ""

            UIPasteboard.general.string = raw

            guard let converterURL = URL(string: "https://ytmp3.nz") else { return }
            DispatchQueue.main.async { [weak self] in
                UIApplication.shared.open(converterURL, options: [:]) { opened in
                    if opened {
                        self?.emit(
                            event: "dragon:converter-opened",
                            detail: ["copied": true]
                        )
                    } else {
                        self?.emitError("Could not open the converter website.")
                    }
                }
            }
        }

        private func presentMediaImporter(_ body: [String: Any]) {
            if let title = body["title"] as? String, !title.isEmpty {
                pendingImportTitle = title
            }
            if let artist = body["artist"] as? String, !artist.isEmpty {
                pendingImportArtist = artist
            }
            if let artwork = body["artwork"] as? String, !artwork.isEmpty {
                pendingImportArtwork = artwork
            }

            DispatchQueue.main.async { [weak self] in
                guard let self,
                      let presenter = self.topViewController() else {
                    self?.emitError("Could not open the Files picker.")
                    return
                }

                let picker = UIDocumentPickerViewController(
                    forOpeningContentTypes: [UTType.audio, UTType.movie],
                    asCopy: true
                )
                picker.delegate = self
                picker.allowsMultipleSelection = false
                presenter.present(picker, animated: true)
            }
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }

            do {
                let track = try library.importFile(
                    url: url,
                    title: pendingImportTitle,
                    artist: pendingImportArtist,
                    artwork: pendingImportArtwork
                )

                emit(event: "dragon:download-complete", detail: [
                    "id": track.id,
                    "title": track.title,
                    "kind": track.kind ?? "audio",
                    "imported": true
                ])
                emitLibrary()

                pendingImportTitle = ""
                pendingImportArtist = ""
                pendingImportArtwork = ""
            } catch {
                emitError(error.localizedDescription)
            }
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            emit(event: "dragon:import-cancelled", detail: [:])
        }

        private func topViewController() -> UIViewController? {
            guard let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }),
                  let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
                return nil
            }

            var current = root
            while let presented = current.presentedViewController {
                current = presented
            }
            return current
        }

        private func download(_ body: [String: Any]) {
            guard let raw = body["url"] as? String,
                  let url = URL(string: raw),
                  ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
                emitError("Enter a valid direct audio or video URL.")
                return
            }

            let title = body["title"] as? String ?? ""
            let artist = body["artist"] as? String ?? ""
            let artwork = body["artwork"] as? String ?? ""
            let kind = body["kind"] as? String ?? "audio"

            emit(event: "dragon:download-state", detail: ["state": "downloading", "kind": kind])

            library.download(
                url: url,
                expectedKind: kind,
                title: title,
                artist: artist,
                artwork: artwork
            ) { [weak self] result in
                DispatchQueue.main.async {
                    switch result {
                    case .success(let track):
                        self?.emit(event: "dragon:download-complete", detail: [
                            "id": track.id,
                            "title": track.title,
                            "kind": track.kind ?? "audio"
                        ])
                        self?.emitLibrary()

                    case .failure(let error):
                        self?.emitError(error.localizedDescription)
                    }
                }
            }
        }

        private func emitLibrary() {
            let tracks = library.allTracks().map {
                [
                    "id": $0.id,
                    "title": $0.title,
                    "artist": $0.artist,
                    "artwork": $0.artwork,
                    "kind": $0.kind ?? "audio",
                    "createdAt": ISO8601DateFormatter().string(from: $0.createdAt)
                ]
            }
            emit(event: "dragon:library-changed", detail: ["tracks": tracks])
        }

        private func emitError(_ message: String) {
            emit(event: "dragon:native-error", detail: ["message": message])
        }

        private func emit(event: String, detail: [String: Any]) {
            guard JSONSerialization.isValidJSONObject(detail),
                  let data = try? JSONSerialization.data(withJSONObject: detail),
                  let json = String(data: data, encoding: .utf8) else {
                return
            }

            let script = """
            window.dispatchEvent(new CustomEvent(\(String(reflecting: event)), { detail: \(json) }));
            """

            webView?.evaluateJavaScript(script)
        }
    }
}
