import SwiftUI

@main
struct NiuMaApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environmentObject(session)
                .tint(AppTheme.brass)
                .onChange(of: scenePhase) { newPhase in
                    session.handleScenePhase(newPhase)
                }
        }
    }
}
