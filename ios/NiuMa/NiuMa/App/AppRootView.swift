import SwiftUI

struct AppRootView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        Group {
            if session.isAuthenticated {
                WorkspaceView()
            } else {
                LoginView()
            }
        }
        .background(AppTheme.paper)
        .preferredColorScheme(nil)
    }
}

#Preview {
    AppRootView()
        .environment(SessionStore())
}
