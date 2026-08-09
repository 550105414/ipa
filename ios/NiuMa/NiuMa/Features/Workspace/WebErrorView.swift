import SwiftUI

struct WebErrorView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: AppTheme.mediumSpacing) {
            Image(systemName: "wifi.exclamationmark")
                .font(.largeTitle)
                .foregroundStyle(AppTheme.brass)
                .accessibilityHidden(true)

            Text("无法连接工作台")
                .font(.title2)
                .fontDesign(.serif)
                .bold()
                .foregroundStyle(AppTheme.ink)

            Text(message)
                .font(.body)
                .foregroundStyle(AppTheme.mutedInk)
                .multilineTextAlignment(.center)

            Button("重新加载", systemImage: "arrow.clockwise", action: retry)
                .bold()
                .foregroundStyle(AppTheme.surface)
                .frame(minWidth: 160, minHeight: 48)
                .background(AppTheme.brass)
                .clipShape(RoundedRectangle(cornerRadius: AppTheme.mediumRadius))
        }
        .padding(AppTheme.largeSpacing)
        .frame(maxWidth: 420)
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.largeRadius))
        .overlay {
            RoundedRectangle(cornerRadius: AppTheme.largeRadius)
                .stroke(AppTheme.hairline, lineWidth: 1)
        }
        .padding(AppTheme.largeSpacing)
    }
}
