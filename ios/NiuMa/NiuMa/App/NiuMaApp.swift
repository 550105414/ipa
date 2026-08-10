import SwiftUI

@main
struct NiuMaApp: App {
    @StateObject private var deepLinks = WorkspaceDeepLinkStore()

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environmentObject(deepLinks)
                .tint(AppTheme.brass)
                .onOpenURL(perform: deepLinks.handle)
        }
    }
}
