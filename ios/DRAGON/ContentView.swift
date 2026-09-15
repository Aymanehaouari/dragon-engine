import SwiftUI
import UIKit

struct ContentView: View {
    @EnvironmentObject var audio: NativeAudioPlayer

    private var screenSize: CGSize {
        UIScreen.main.bounds.size
    }

    var body: some View {
        DragonWebView(
            startURL: URL(string: "https://dragon-music-app.onrender.com/?dragon=20260915-4")!,
            audio: audio
        )
        .frame(
            width: screenSize.width,
            height: screenSize.height,
            alignment: .topLeading
        )
        .background(Color.black)
        .ignoresSafeArea(.all, edges: .all)
    }
}
