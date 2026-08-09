import SwiftUI
import WebKit

struct WorkspaceWebView: UIViewRepresentable {
    private static let workspaceURL = URL(string: "https://xiaoke-sales-workspace.rich-mug-8653.chatgpt.site/")
    let model: WebViewModel

    func makeCoordinator() -> WebNavigationCoordinator {
        WebNavigationCoordinator(model: model)
    }

    func makeUIView(context: Context) -> WKWebView {
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true

        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences = preferences
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "NiuMa-iOS/1.0"
        configuration.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .clear
        model.attach(webView)

        if let url = Self.workspaceURL {
            var request = URLRequest(url: url)
            request.cachePolicy = .reloadRevalidatingCacheData
            request.timeoutInterval = 30
            webView.load(request)
        } else {
            model.didFailLoading(WorkspaceAddressError.invalidAddress)
        }

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        model.attach(webView)
    }
}
