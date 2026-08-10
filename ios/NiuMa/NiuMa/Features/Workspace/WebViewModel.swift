import Combine
import WebKit

@MainActor
final class WebViewModel: ObservableObject {
    private static let workspaceURL = URL(string: "https://xiaoke-sales-workspace.rich-mug-8653.chatgpt.site/")

    @Published private(set) var isLoading = true
    @Published private(set) var canGoBack = false
    @Published var errorMessage: String?
    weak var webView: WKWebView?
    private var pendingURL: URL?

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

    func navigate(to path: String) {
        guard let workspaceURL = Self.workspaceURL,
              let destination = URL(string: path, relativeTo: workspaceURL)?.absoluteURL,
              destination.host == workspaceURL.host else {
            return
        }

        guard let webView else {
            pendingURL = destination
            return
        }
        webView.load(URLRequest(url: destination))
    }

    func consumePendingURL() -> URL? {
        defer { pendingURL = nil }
        return pendingURL
    }

    private func updateNavigationState(from webView: WKWebView) {
        canGoBack = webView.canGoBack
    }
}
