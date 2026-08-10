import UIKit
import WebKit
import WidgetKit

@MainActor
final class WebNavigationCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private let model: WebViewModel

    init(model: WebViewModel) {
        self.model = model
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
        model.didStartLoading()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        model.didFinishLoading(webView)
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation?,
        withError error: Error
    ) {
        model.didFailLoading(error)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation?,
        withError error: Error
    ) {
        model.didFailLoading(error)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if ["tel", "mailto", "sms"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == TodoWidgetStore.messageHandlerName,
              let snapshot = TodoWidgetMessageDecoder.decode(message.body),
              TodoWidgetStore.save(snapshot) else {
            return
        }
        WidgetCenter.shared.reloadTimelines(ofKind: TodoWidgetStore.widgetKind)
    }
}
