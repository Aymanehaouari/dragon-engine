import Foundation

struct OfflineTrack: Codable, Identifiable {
    let id: String
    let title: String
    let artist: String
    let fileName: String
    let artwork: String
    let createdAt: Date
}

final class OfflineLibrary {
    private let fileManager = FileManager.default
    private let queue = DispatchQueue(label: "com.dragon.music.offline-library")

    private var root: URL {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("DRAGON Offline", isDirectory: true)
    }

    private var manifestURL: URL {
        root.appendingPathComponent("library.json")
    }

    init() {
        try? fileManager.createDirectory(at: root, withIntermediateDirectories: true)
    }

    func allTracks() -> [OfflineTrack] {
        queue.sync { loadTracks() }
    }

    func localURL(for id: String) -> URL? {
        queue.sync {
            guard let track = loadTracks().first(where: { $0.id == id }) else { return nil }
            let url = root.appendingPathComponent(track.fileName)
            return fileManager.fileExists(atPath: url.path) ? url : nil
        }
    }

    func delete(id: String) throws {
        try queue.sync {
            var tracks = loadTracks()
            guard let index = tracks.firstIndex(where: { $0.id == id }) else { return }
            let track = tracks[index]
            let fileURL = root.appendingPathComponent(track.fileName)
            try? fileManager.removeItem(at: fileURL)
            tracks.remove(at: index)
            try saveTracks(tracks)
        }
    }

    func download(
        url: URL,
        title: String,
        artist: String,
        artwork: String,
        completion: @escaping (Result<OfflineTrack, Error>) -> Void
    ) {
        var request = URLRequest(url: url)
        request.timeoutInterval = 60

        URLSession.shared.downloadTask(with: request) { [weak self] tempURL, response, error in
            guard let self else { return }

            if let error {
                completion(.failure(error))
                return
            }

            guard let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode),
                  let tempURL else {
                completion(.failure(NSError(
                    domain: "DRAGON",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "The audio server did not return a downloadable file."]
                )))
                return
            }

            let mime = (http.mimeType ?? "").lowercased()
            let ext = self.fileExtension(for: url, mimeType: mime)

            guard mime.hasPrefix("audio/") || self.isKnownAudioExtension(ext) else {
                completion(.failure(NSError(
                    domain: "DRAGON",
                    code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "This link is not a direct audio file."]
                )))
                return
            }

            do {
                let id = UUID().uuidString
                let fileName = id + "." + ext
                let destination = self.root.appendingPathComponent(fileName)

                try self.fileManager.createDirectory(at: self.root, withIntermediateDirectories: true)
                if self.fileManager.fileExists(atPath: destination.path) {
                    try self.fileManager.removeItem(at: destination)
                }
                try self.fileManager.moveItem(at: tempURL, to: destination)

                let track = OfflineTrack(
                    id: id,
                    title: title.isEmpty ? (response?.suggestedFilename ?? "Saved track") : title,
                    artist: artist,
                    fileName: fileName,
                    artwork: artwork,
                    createdAt: Date()
                )

                try self.queue.sync {
                    var tracks = self.loadTracks()
                    tracks.insert(track, at: 0)
                    try self.saveTracks(tracks)
                }

                completion(.success(track))
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }

    private func loadTracks() -> [OfflineTrack] {
        guard let data = try? Data(contentsOf: manifestURL),
              let tracks = try? JSONDecoder().decode([OfflineTrack].self, from: data) else {
            return []
        }

        return tracks.filter {
            fileManager.fileExists(atPath: root.appendingPathComponent($0.fileName).path)
        }
    }

    private func saveTracks(_ tracks: [OfflineTrack]) throws {
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(tracks)
        try data.write(to: manifestURL, options: .atomic)
    }

    private func fileExtension(for url: URL, mimeType: String) -> String {
        let pathExt = url.pathExtension.lowercased()
        if isKnownAudioExtension(pathExt) { return pathExt }

        switch mimeType {
        case "audio/mpeg": return "mp3"
        case "audio/mp4", "audio/x-m4a": return "m4a"
        case "audio/aac": return "aac"
        case "audio/wav", "audio/x-wav": return "wav"
        case "audio/flac": return "flac"
        case "audio/ogg": return "ogg"
        default: return "m4a"
        }
    }

    private func isKnownAudioExtension(_ ext: String) -> Bool {
        ["mp3", "m4a", "aac", "wav", "flac", "ogg"].contains(ext)
    }
}
