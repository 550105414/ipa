const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

// SDK 55's RN 0.83 plugin includes Foojay 0.5.0, which references IBM_SEMERU.
// Gradle 9 removed that constant. AGP 8.12 supports Gradle >= 8.13, so stay on
// Gradle 8.14.3 without patching dependencies or changing the Expo/RN SDK.
// Sources:
// https://github.com/reactwg/react-native-releases/issues/1349
// https://developer.android.com/build/releases/agp-8-12-0-release-notes
// https://services.gradle.org/distributions/gradle-8.14.3-bin.zip.sha256
const GRADLE_VERSION = '8.14.3';
const GRADLE_SHA256 = 'bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531';
const DISTRIBUTION_URL = `https\\://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`;

function pinGradleWrapper(contents) {
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const lines = contents.split(/\r?\n/);
  for (const [key, value] of [
    ['distributionUrl', DISTRIBUTION_URL],
    ['distributionSha256Sum', GRADLE_SHA256],
  ]) {
    const pattern = new RegExp(`^\\s*${key}\\s*=`);
    const positions = lines.flatMap((line, index) => pattern.test(line) ? [index] : []);
    if (positions.length > 1 || (key === 'distributionUrl' && positions.length !== 1)) {
      throw new Error(`Expected exactly one Gradle wrapper ${key} property.`);
    }
    const replacement = `${key}=${value}`;
    if (positions.length) lines[positions[0]] = replacement;
    else lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, replacement);
  }
  return lines.join(newline);
}

function assertCompatibleAgp(catalog) {
  const agp = /^agp\s*=\s*"([^"\r\n]+)"\s*$/m.exec(catalog)?.[1];
  if (!agp || !/^8\.12\.\d+$/.test(agp)) {
    throw new Error(`Review the Gradle 8.14.3 compatibility pin before building with AGP ${agp ?? 'unknown'}. Expected SDK 55 / AGP 8.12.x.`);
  }
}

module.exports = function withAndroidGradleCompat(config) {
  return withDangerousMod(config, ['android', async (modConfig) => {
    const projectRoot = modConfig.modRequest.projectRoot;
    const pluginPackage = require.resolve('@react-native/gradle-plugin/package.json', { paths: [projectRoot] });
    const catalog = await fs.readFile(path.join(path.dirname(pluginPackage), 'gradle', 'libs.versions.toml'), 'utf8');
    assertCompatibleAgp(catalog);
    const wrapper = path.join(modConfig.modRequest.platformProjectRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties');
    const original = await fs.readFile(wrapper, 'utf8');
    const pinned = pinGradleWrapper(original);
    if (pinned !== original) await fs.writeFile(wrapper, pinned);
    return modConfig;
  }]);
};

module.exports.pinGradleWrapper = pinGradleWrapper;
module.exports.assertCompatibleAgp = assertCompatibleAgp;
module.exports.GRADLE_VERSION = GRADLE_VERSION;
module.exports.GRADLE_SHA256 = GRADLE_SHA256;
