import SwiftUI
import WebKit

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
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(context.coordinator, name: "dragonAudio")

        let webView = WKWebView(frame: .zero, configuration: config)
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

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let audio: NativeAudioPlayer
        let library = OfflineLibrary()
        weak var webView: WKWebView?

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

        private func download(_ body: [String: Any]) {
            guard let raw = body["url"] as? String,
                  let url = URL(string: raw),
                  ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
                emitError("Enter a valid direct audio URL.")
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
