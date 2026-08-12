import * as LocalAuthentication from 'expo-local-authentication';
import { type PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  createFaceIdSession,
  loadValidFaceIdSession,
  subscribeToFaceIdSessionRevocation,
} from '@/lib/face-id-session';
import { colors } from '@/theme/colors';

export function PrivacyGate({ children }: PropsWithChildren) {
  const [locked, setLocked] = useState(true);
  const [message, setMessage] = useState('正在检查 Face ID…');
  const authenticating = useRef(false);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lock = useCallback((nextMessage = 'Face ID 解锁已过期，请重新验证。') => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    expiryTimer.current = null;
    setLocked(true);
    setMessage(nextMessage);
  }, []);

  const acceptSession = useCallback(
    (expiresAt: number) => {
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        lock();
        return;
      }
      setLocked(false);
      setMessage('');
      expiryTimer.current = setTimeout(() => lock(), remaining);
    },
    [lock],
  );

  const unlock = useCallback(async () => {
    if (authenticating.current) return;
    authenticating.current = true;
    setMessage('正在验证 Face ID…');
    try {
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHardware) {
        lock('这台设备不支持 Face ID，无法解锁个人资料。');
        return;
      }
      if (!enrolled) {
        lock('请先在 iPhone“设置”中录入 Face ID。');
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: '解锁个人工作台',
        fallbackLabel: '使用设备密码',
        cancelLabel: '取消',
        disableDeviceFallback: false,
      });
      if (result.success) {
        acceptSession(await createFaceIdSession());
      } else {
        setMessage('验证未完成，请重试。');
      }
    } catch {
      lock('暂时无法验证 Face ID，请重试。');
    } finally {
      authenticating.current = false;
    }
  }, [acceptSession, lock]);

  const restoreOrUnlock = useCallback(async () => {
    try {
      const expiresAt = await loadValidFaceIdSession();
      if (expiresAt) {
        acceptSession(expiresAt);
        return;
      }
    } catch {
      // A Keychain read failure must never silently bypass the privacy gate.
    }
    lock('请使用 Face ID 解锁，有效期为 1 小时。');
    await unlock();
  }, [acceptSession, lock, unlock]);

  useEffect(() => {
    void restoreOrUnlock();
    const unsubscribe = subscribeToFaceIdSessionRevocation(() =>
      lock('登录状态已变更，请重新验证 Face ID。'),
    );
    return () => {
      unsubscribe();
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    };
  }, [lock, restoreOrUnlock]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      // Backgrounding does not extend the one-hour lease. Re-check the signed
      // Keychain timestamp whenever the app returns to the foreground.
      if (state === 'active') void restoreOrUnlock();
    });
    return () => subscription.remove();
  }, [restoreOrUnlock]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        accessibilityElementsHidden={locked}
        importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}
        pointerEvents={locked ? 'none' : 'auto'}
        style={{ flex: 1, opacity: locked ? 0 : 1 }}>
        {children}
      </View>
      {locked ? (
        <View
          accessibilityViewIsModal
          style={{
            ...StyleSheet.absoluteFillObject,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
            padding: 32,
            backgroundColor: colors.background,
          }}>
          <View
            style={{
              width: 72,
              height: 72,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 24,
              borderCurve: 'continuous',
              backgroundColor: colors.blueTint,
            }}>
            <Text style={{ fontSize: 34 }} accessibilityLabel="已锁定">
              🔒
            </Text>
          </View>
          <View style={{ alignItems: 'center', gap: 7 }}>
            <Text selectable style={{ color: colors.label, fontSize: 22, fontWeight: '700' }}>
              Face ID 已锁定
            </Text>
            <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14, textAlign: 'center' }}>
              {message}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void unlock()}
            style={({ pressed }) => ({
              minWidth: 180,
              minHeight: 48,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 16,
              borderCurve: 'continuous',
              backgroundColor: pressed ? '#2866AB' : colors.blue,
            })}>
            <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>使用 Face ID 解锁</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
