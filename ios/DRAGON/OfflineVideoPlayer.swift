import AVKit
import UIKit

enum OfflineVideoPlayer {
    static func present(url: URL) {
        DispatchQueue.main.async {
            guard let presenter = topViewController() else { return }

            let controller = AVPlayerViewController()
            controller.player = AVPlayer(url: url)
            controller.modalPresentationStyle = .fullScreen

            presenter.present(controller, animated: true) {
                controller.player?.play()
            }
        }
    }

    private static func topViewController(
        from root: UIViewController? = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first(where: { $0.isKeyWindow })?
            .rootViewController
    ) -> UIViewController? {
        if let presented = root?.presentedViewController {
            return topViewController(from: presented)
        }
        if let navigation = root as? UINavigationController {
            return topViewController(from: navigation.visibleViewController)
        }
        if let tab = root as? UITabBarController {
            return topViewController(from: tab.selectedViewController)
        }
        return root
    }
}
