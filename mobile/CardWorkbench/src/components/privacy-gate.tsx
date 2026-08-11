import * as LocalAuthentication from 'expo-local-authentication';
import { type PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

export function PrivacyGate({ children }: PropsWithChildren) {
  const [locked, setLocked] = useState(true);
  const [message, setMessage] = useState('正在验证设备身份…');
  const authenticating = useRef(false);

  const unlock = useCallback(async () => {
    if (authenticating.current) return;
    authenticating.current = true;
    setMessage('正在验证设备身份…');
    try {
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHardware || !enrolled) {
        setLocked(false);
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: '解锁个人工作台',
        fallbackLabel: '使用设备密码',
        cancelLabel: '取消',
        disableDeviceFallback: false,
      });
      if (result.success) {
        setLocked(false);
        setMessage('');
      } else {
        setMessage('验证未完成，请重试。');
      }
    } catch {
      setMessage('暂时无法验证设备身份，请重试。');
    } finally {
      authenticating.current = false;
    }
  }, []);

  useEffect(() => {
    void unlock();
  }, [unlock]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        setLocked(true);
        setMessage('工作台已锁定');
      } else if (state === 'active' && locked) {
        void unlock();
      }
    });
    return () => subscription.remove();
  }, [locked, unlock]);

  if (!locked) return children;

  return (
    <View
      accessibilityViewIsModal
      style={{
        flex: 1,
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
          个人工作台已锁定
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
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>验证并进入</Text>
      </Pressable>
    </View>
  );
}
