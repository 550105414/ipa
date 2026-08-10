import SwiftUI
import WebKit

struct WorkspaceWebView: UIViewRepresentable {
    private static let workspaceURL = URL(string: "https://xiaoke-sales-workspace.rich-mug-8653.chatgpt.site/")

    /// iOS 16 WebKit lacks the static `Response.json` factory used by the hosted login page.
    private static let responseJSONCompatibilitySource = #"""
    (function () {
        if (typeof Response === "undefined" || typeof Response.json === "function") {
            return;
        }

        Object.defineProperty(Response, "json", {
            configurable: true,
            writable: true,
            value: function (data, init) {
                var body = JSON.stringify(data);
                if (body === undefined) {
                    throw new TypeError("Value is not JSON serializable");
                }

                var responseInit = init == null ? {} : init;
                var headers = new Headers(responseInit.headers);
                if (!headers.has("content-type")) {
                    headers.set("content-type", "application/json");
                }

                return new Response(body, {
                    headers: headers,
                    status: responseInit.status,
                    statusText: responseInit.statusText
                });
            }
        });
    }());
    """#
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
        configuration.applicationNameForUserAgent = "NiuMa-iOS/1.1.0"
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController.add(
            context.coordinator,
            name: TodoWidgetStore.messageHandlerName
        )
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: Self.responseJSONCompatibilitySource,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false
            )
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .clear
        model.attach(webView)

        if let url = model.consumePendingURL() ?? Self.workspaceURL {
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
