import SwiftUI

struct WorkspaceView: View {
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
    }
}

#Preview {
    WorkspaceView()
}
