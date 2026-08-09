import SwiftUI

struct WorkspaceToolbarView: View {
    @EnvironmentObject private var session: SessionStore
    @ObservedObject var model: WebViewModel

    var body: some View {
        HStack(spacing: AppTheme.smallSpacing) {
            if model.canGoBack {
                Button("返回", systemImage: "chevron.left", action: model.goBack)
                    .labelStyle(.iconOnly)
                    .frame(width: 44, height: 44)
                    .accessibilityHint("返回工作台上一页")
            }

            BrandMarkView(compact: true)

            Spacer(minLength: AppTheme.smallSpacing)

            if model.isLoading {
                ProgressView()
                    .frame(width: 44, height: 44)
                    .accessibilityLabel("正在加载工作台")
            }

            Menu("工作台菜单", systemImage: "ellipsis.circle") {
                Button("重新加载", systemImage: "arrow.clockwise", action: model.reload)
                Button("退出应用登录", systemImage: "lock.fill", role: .destructive, action: session.signOut)
            }
            .labelStyle(.iconOnly)
            .frame(width: 44, height: 44)
        }
        .foregroundStyle(AppTheme.ink)
        .padding(.horizontal, AppTheme.mediumSpacing)
        .padding(.vertical, AppTheme.smallSpacing)
        .background(AppTheme.surface)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(AppTheme.hairline)
                .frame(height: 1)
        }
    }
}
