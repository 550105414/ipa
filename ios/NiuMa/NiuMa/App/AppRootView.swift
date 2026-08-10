import SwiftUI

struct AppRootView: View {
    var body: some View {
        WorkspaceView()
            .background(AppTheme.paper)
            .preferredColorScheme(nil)
    }
}

#Preview {
    AppRootView()
        .environmentObject(WorkspaceDeepLinkStore())
}
