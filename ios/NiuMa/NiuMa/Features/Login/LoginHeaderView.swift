import SwiftUI

struct LoginHeaderView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.largeSpacing) {
            BrandMarkView()

            HStack(spacing: AppTheme.smallSpacing) {
                Image(systemName: "lock.shield.fill")
                    .foregroundStyle(AppTheme.brass)
                    .accessibilityHidden(true)
                Text("个人工作台 · 本机门禁")
                    .font(.subheadline)
                    .bold()
                    .foregroundStyle(AppTheme.ink)
            }

            Text("登录后直接进入现有客户工作台。应用退出后不会保存密码，后台超过五分钟会自动锁定。")
                .font(.body)
                .foregroundStyle(AppTheme.mutedInk)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
