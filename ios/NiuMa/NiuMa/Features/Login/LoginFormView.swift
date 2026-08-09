import SwiftUI

struct LoginFormView: View {
    @EnvironmentObject private var session: SessionStore
    @FocusState private var focusedField: LoginField?
    @State private var account = ""
    @State private var password = ""

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.largeSpacing) {
            VStack(alignment: .leading, spacing: AppTheme.smallSpacing) {
                Text("账号")
                    .font(.headline)
                    .foregroundStyle(AppTheme.ink)

                TextField("请输入账号", text: $account)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focusedField, equals: .account)
                    .onSubmit {
                        focusedField = .password
                    }
                    .padding(.horizontal, AppTheme.mediumSpacing)
                    .frame(minHeight: 52)
                    .background(AppTheme.paper)
                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.mediumRadius))
                    .overlay {
                        RoundedRectangle(cornerRadius: AppTheme.mediumRadius)
                            .stroke(AppTheme.hairline, lineWidth: 1)
                    }
            }

            VStack(alignment: .leading, spacing: AppTheme.smallSpacing) {
                Text("密码")
                    .font(.headline)
                    .foregroundStyle(AppTheme.ink)

                SecureField("请输入密码", text: $password)
                    .textContentType(.password)
                    .submitLabel(.go)
                    .focused($focusedField, equals: .password)
                    .onSubmit(submit)
                    .padding(.horizontal, AppTheme.mediumSpacing)
                    .frame(minHeight: 52)
                    .background(AppTheme.paper)
                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.mediumRadius))
                    .overlay {
                        RoundedRectangle(cornerRadius: AppTheme.mediumRadius)
                            .stroke(AppTheme.hairline, lineWidth: 1)
                    }
            }

            if let errorMessage = session.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.error)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button(action: submit) {
                HStack(spacing: AppTheme.smallSpacing) {
                    if session.isSigningIn {
                        ProgressView()
                            .tint(AppTheme.surface)
                            .accessibilityHidden(true)
                    } else {
                        Image(systemName: "arrow.right")
                            .accessibilityHidden(true)
                    }
                    Text(session.isSigningIn ? "正在验证" : "进入工作台")
                        .bold()
                }
                .frame(maxWidth: .infinity, minHeight: 52)
                .foregroundStyle(AppTheme.surface)
                .background(session.isLockedOut ? AppTheme.mutedInk : AppTheme.brass)
                .clipShape(RoundedRectangle(cornerRadius: AppTheme.mediumRadius))
            }
            .buttonStyle(.plain)
            .disabled(account.isEmpty || password.isEmpty || session.isSigningIn || session.isLockedOut)
            .accessibilityHint("验证账号密码并打开客户工作台")

            Label("工作台仍使用原有的私有站点登录和数据权限。", systemImage: "checkmark.shield.fill")
                .font(.footnote)
                .foregroundStyle(AppTheme.mutedInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(AppTheme.largeSpacing)
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.largeRadius))
        .overlay {
            RoundedRectangle(cornerRadius: AppTheme.largeRadius)
                .stroke(AppTheme.hairline, lineWidth: 1)
        }
    }

    private func submit() {
        guard !account.isEmpty, !password.isEmpty else {
            return
        }

        focusedField = nil
        let submittedPassword = password
        password = ""
        Task {
            await session.signIn(account: account, password: submittedPassword)
        }
    }
}
