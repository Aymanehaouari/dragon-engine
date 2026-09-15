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

            default:
                break
            }
        }
    }
}
