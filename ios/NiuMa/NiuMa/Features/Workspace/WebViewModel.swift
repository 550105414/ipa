import Combine
import WebKit

@MainActor
final class WebViewModel: ObservableObject {
    @Published private(set) var isLoading = true
    @Published private(set) var canGoBack = false
    @Published var errorMessage: String?
    weak var webView: WKWebView?

    func attach(_ webView: WKWebView) {
        self.webView = webView
        updateNavigationState(from: webView)
    }

    func didStartLoading() {
        isLoading = true
        errorMessage = nil
    }

    func didFinishLoading(_ webView: WKWebView) {
        isLoading = false
        updateNavigationState(from: webView)
    }

    func didFailLoading(_ error: Error) {
        isLoading = false

        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else {
            return
        }
        errorMessage = "工作台暂时无法打开，请检查网络后重试。"
    }

    func reload() {
        errorMessage = nil
        webView?.reload()
    }

    func goBack() {
        webView?.goBack()
    }

    private func updateNavigationState(from webView: WKWebView) {
        canGoBack = webView.canGoBack
    }
}
