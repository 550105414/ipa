import SwiftUI

struct WorkspaceView: View {
    @EnvironmentObject private var deepLinks: WorkspaceDeepLinkStore
    @StateObject private var model = WebViewModel()

    var body: some View {
        VStack(spacing: 0) {
            WorkspaceToolbarView(model: model)

            ZStack {
                WorkspaceWebView(model: model)

                if let errorMessage = model.errorMessage {
                    AppTheme.paper
                    WebErrorView(message: errorMessage, retry: model.reload)
                }
            }
        }
        .background(AppTheme.paper)
        .ignoresSafeArea(.container, edges: .bottom)
        .onAppear(perform: openPendingDeepLink)
        .onChange(of: deepLinks.pendingPath) { _ in
            openPendingDeepLink()
        }
    }

    private func openPendingDeepLink() {
        guard let path = deepLinks.consumePath() else {
            return
        }
        model.navigate(to: path)
    }
}

#Preview {
    WorkspaceView()
        .environmentObject(WorkspaceDeepLinkStore())
}
