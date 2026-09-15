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
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(context.coordinator, name: "dragonAudio")

        let webView = WKWebView(frame: .zero, configuration: config)
        context.coordinator.webView = webView
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.backgroundColor = .black
        webView.isOpaque = false

        let request = URLRequest(url: startURL)
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
                      let track = library.allTracks().first(where: { $0.id == id }) else {
                    emitError("Saved track was not found.")
                    return
                }

                audio.play(
                    url: localURL,
                    title: track.title,
                    artist: track.artist,
                    artworkURL: URL(string: track.artwork)
                )

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

            let title = body["title"] as? String ?? "Saved track"
            let artist = body["artist"] as? String ?? ""
            let artwork = body["artwork"] as? String ?? ""

            emit(event: "dragon:download-state", detail: ["state": "downloading"])

            library.download(
                url: url,
                title: title,
                artist: artist,
                artwork: artwork
            ) { [weak self] result in
                DispatchQueue.main.async {
                    switch result {
                    case .success(let track):
                        self?.emit(event: "dragon:download-complete", detail: [
                            "id": track.id,
                            "title": track.title
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
