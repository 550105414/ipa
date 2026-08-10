const { withEntitlementsPlist, withXcodeProject } = require('expo/config-plugins');

const WIDGET_BUNDLE_IDENTIFIER = 'com.xiaoke.salesworkspace.TodoWidget';
const REQUIRED_DEPLOYMENT_TARGET = '16.1';

/**
 * expo-widgets 55 creates its extension target with iOS 16.2 even though its
 * widget APIs are guarded for iOS 16.0+. Keep the generated extension aligned
 * with this app's fixed iOS 16.1 deployment target.
 */
module.exports = function withWidgetDeploymentTarget(config) {
  const withoutUnusedPushEntitlement = withEntitlementsPlist(config, (modConfig) => {
    delete modConfig.modResults['aps-environment'];
    return modConfig;
  });

  return withXcodeProject(withoutUnusedPushEntitlement, (projectConfig) => {
    const buildConfigurations = projectConfig.modResults.pbxXCBuildConfigurationSection();
    let updatedConfigurations = 0;

    for (const entry of Object.values(buildConfigurations)) {
      if (!entry || typeof entry !== 'object' || !entry.buildSettings) {
        continue;
      }

      const bundleIdentifier = String(
        entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER ?? '',
      ).replaceAll('"', '');

      if (bundleIdentifier !== WIDGET_BUNDLE_IDENTIFIER) {
        continue;
      }

      entry.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = `"${REQUIRED_DEPLOYMENT_TARGET}"`;
      updatedConfigurations += 1;
    }

    if (updatedConfigurations !== 2) {
      throw new Error(
        `Expected two ${WIDGET_BUNDLE_IDENTIFIER} build configurations, updated ${updatedConfigurations}.`,
      );
    }

    return projectConfig;
  });
};
