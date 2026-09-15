import SwiftUI

@main
struct DRAGONApp: App {
    @StateObject private var audio = NativeAudioPlayer()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(audio)
                .onAppear {
                    audio.configureAudioSession()
                    audio.configureRemoteCommands()
                }
        }
    }
}
