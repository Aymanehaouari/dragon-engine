import AVFoundation
import MediaPlayer
import UIKit

final class NativeAudioPlayer: ObservableObject {
    private var player: AVPlayer?
    private var currentTitle = "DRAGON"
    private var currentArtist = ""

    func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            print("DRAGON audio session error:", error)
        }
    }

    func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in
            self?.resume()
            return .success
        }

        center.pauseCommand.addTarget { [weak self] _ in
            self?.pause()
            return .success
        }

        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.player?.timeControlStatus == .playing {
                self.pause()
            } else {
                self.resume()
            }
            return .success
        }
    }

    func play(url: URL, title: String, artist: String, artworkURL: URL?) {
        configureAudioSession()
        currentTitle = title
        currentArtist = artist

        let item = AVPlayerItem(url: url)
        player = AVPlayer(playerItem: item)
        player?.play()

        updateNowPlaying(artworkURL: artworkURL)
    }

    func pause() {
        player?.pause()
        updatePlaybackState()
    }

    func resume() {
        configureAudioSession()
        player?.play()
        updatePlaybackState()
    }

    func stop() {
        player?.pause()
        player = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func updatePlaybackState() {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPNowPlayingInfoPropertyPlaybackRate] =
            player?.timeControlStatus == .playing ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func updateNowPlaying(artworkURL: URL?) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: currentTitle,
            MPMediaItemPropertyArtist: currentArtist,
            MPNowPlayingInfoPropertyPlaybackRate: 1.0
        ]

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        guard let artworkURL else { return }

        URLSession.shared.dataTask(with: artworkURL) { data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }

            DispatchQueue.main.async {
                info[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }.resume()
    }
}
