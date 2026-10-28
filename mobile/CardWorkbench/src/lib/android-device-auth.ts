import * as LocalAuthentication from 'expo-local-authentication';

/**
 * A secure screen-lock PIN/password is enough to show Android's system prompt.
 * hasHardwareAsync/isEnrolledAsync only describe biometrics, not device PINs.
 * This check never grants access: authenticateAsync must still succeed.
 */
export async function hasAndroidDeviceAuthentication(): Promise<boolean> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  return Number.isInteger(level) && level >= LocalAuthentication.SecurityLevel.SECRET;
}
