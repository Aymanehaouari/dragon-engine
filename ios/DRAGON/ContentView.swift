import SwiftUI

struct ContentView: View {
    @EnvironmentObject var audio: NativeAudioPlayer

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()

            DragonWebView(
                startURL: URL(string: "https://dragon-music-app.onrender.com")!,
                audio: audio
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .ignoresSafeArea(.all, edges: .all)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .preferredColorScheme(.dark)
    }
}
