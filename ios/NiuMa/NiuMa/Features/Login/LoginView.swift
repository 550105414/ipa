import SwiftUI

struct LoginView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppTheme.extraLargeSpacing) {
                LoginHeaderView()
                LoginFormView()

                Text("牛马 · iPhone 个人版")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.mutedInk)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            .frame(maxWidth: 560)
            .padding(.horizontal, AppTheme.largeSpacing)
            .padding(.vertical, 48)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.hidden)
        .background {
            AppTheme.paper
                .overlay(alignment: .topTrailing) {
                    Circle()
                        .fill(AppTheme.brass.opacity(0.08))
                        .frame(width: 220, height: 220)
                        .offset(x: 72, y: -64)
                        .accessibilityHidden(true)
                }
        }
    }
}

#Preview {
    LoginView()
        .environmentObject(SessionStore())
}
