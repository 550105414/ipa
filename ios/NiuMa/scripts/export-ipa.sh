#!/bin/zsh
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "用法: ./scripts/export-ipa.sh <TEAM_ID> [debugging|release-testing] [描述文件 UUID]"
  exit 2
fi

TEAM_ID="$1"
REQUESTED_METHOD="${2:-debugging}"
PROFILE_UUID="${3:-}"
BUNDLE_ID="com.xiaoke.salesworkspace"

if [[ ! "$TEAM_ID" =~ '^[A-Za-z0-9]{10}$' ]]; then
  echo "TEAM_ID 格式不正确。"
  exit 2
fi

if [[ -n "$PROFILE_UUID" && ! "$PROFILE_UUID" =~ '^[A-Fa-f0-9-]+$' ]]; then
  echo "描述文件参数必须是 UUID。"
  exit 2
fi

case "$REQUESTED_METHOD" in
  debugging|development)
    EXPORT_METHOD="debugging"
    SIGNING_CERTIFICATE="Apple Development"
    ;;
  release-testing|ad-hoc)
    EXPORT_METHOD="release-testing"
    SIGNING_CERTIFICATE="Apple Distribution"
    ;;
  *)
    echo "导出方式只支持 debugging 或 release-testing（兼容 development/ad-hoc 别名）。"
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_DIR/build}"
ARCHIVE_PATH="$OUTPUT_DIR/NiuMa.xcarchive"
EXPORT_PATH="$OUTPUT_DIR/ipa"
OPTIONS_DIR="$(mktemp -d)"
OPTIONS_PLIST="$OPTIONS_DIR/ExportOptions.plist"

cleanup() {
  rm -rf "$OPTIONS_DIR"
}
trap cleanup EXIT

SIGNING_STYLE="automatic"
PROFILE_XML=""
SIGNING_CERTIFICATE_XML=""
ARCHIVE_SIGNING_ARGS=(CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates)
EXPORT_SIGNING_ARGS=(-allowProvisioningUpdates)

if [[ -n "$PROFILE_UUID" ]]; then
  SIGNING_STYLE="manual"
  SIGNING_CERTIFICATE_XML="
  <key>signingCertificate</key>
  <string>${SIGNING_CERTIFICATE}</string>"
  PROFILE_XML="
  <key>provisioningProfiles</key>
  <dict>
    <key>${BUNDLE_ID}</key>
    <string>${PROFILE_UUID}</string>
  </dict>"
  ARCHIVE_SIGNING_ARGS=(
    CODE_SIGN_STYLE=Manual
    "CODE_SIGN_IDENTITY=$SIGNING_CERTIFICATE"
    "PROVISIONING_PROFILE_SPECIFIER=$PROFILE_UUID"
  )
  EXPORT_SIGNING_ARGS=()
fi

rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH"
mkdir -p "$OUTPUT_DIR" "$EXPORT_PATH"

cat > "$OPTIONS_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${EXPORT_METHOD}</string>
  <key>signingStyle</key>
  <string>${SIGNING_STYLE}</string>
  <key>teamID</key>
  <string>${TEAM_ID}</string>
  ${SIGNING_CERTIFICATE_XML}
  <key>stripSwiftSymbols</key>
  <true/>
  <key>uploadSymbols</key>
  <false/>
  ${PROFILE_XML}
</dict>
</plist>
PLIST

echo "1/2 正在归档牛马…"
xcodebuild \
  -project "$PROJECT_DIR/NiuMa.xcodeproj" \
  -scheme NiuMa \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  "${ARCHIVE_SIGNING_ARGS[@]}" \
  clean archive

echo "2/2 正在导出 IPA…"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$OPTIONS_PLIST" \
  "${EXPORT_SIGNING_ARGS[@]}"

echo "完成：$EXPORT_PATH"
