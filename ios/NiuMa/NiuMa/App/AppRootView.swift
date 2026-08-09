import SwiftUI

struct AppRootView: View {
    @EnvironmentObject private var session: SessionStore

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
        .environmentObject(SessionStore())
}
