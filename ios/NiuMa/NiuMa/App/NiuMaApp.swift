import SwiftUI

@main
struct NiuMaApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environment(session)
                .tint(AppTheme.brass)
                .onChange(of: scenePhase) { _, newPhase in
                    session.handleScenePhase(newPhase)
                }
        }
    }
}
