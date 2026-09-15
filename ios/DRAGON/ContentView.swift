import SwiftUI

struct ContentView: View {
    @EnvironmentObject var audio: NativeAudioPlayer

    var body: some View {
        DragonWebView(
            startURL: URL(string: "https://dragon-music-app.onrender.com")!,
            audio: audio
        )
        .ignoresSafeArea()
        .preferredColorScheme(.dark)
    }
}
