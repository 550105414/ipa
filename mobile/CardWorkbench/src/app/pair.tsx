import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import { WORKSPACE_PRODUCTION_BASE_URL } from '@/config/workspace';
import {
  clearWorkspaceSession,
  exchangePairing,
  hasStoredWorkspaceCredentials,
  loadWorkspaceSession,
} from '@/lib/workspace-api';
import { useTodos } from '@/providers/todo-provider';
import { colors } from '@/theme/colors';

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default function PairScreen() {
  const router = useRouter();
  const { refresh } = useTodos();
  const params = useLocalSearchParams<{
    base_url?: string | string[];
    code?: string | string[];
    dispatch_token?: string | string[];
  }>();
  const pairing = useMemo(
    () => ({
      baseUrl: first(params.base_url),
      code: first(params.code),
      dispatchToken: first(params.dispatch_token),
    }),
    [params.base_url, params.code, params.dispatch_token],
  );
  const hasPairingLink = Boolean(pairing.baseUrl && pairing.code && pairing.dispatchToken);
  const handledPairingKey = useRef('');
  const [status, setStatus] = useState<'checking' | 'idle' | 'pairing' | 'paired' | 'error'>('checking');
  const [message, setMessage] = useState('');

  const pair = useCallback(async () => {
    if (!hasPairingLink) return;
    setStatus('pairing');
    setMessage('');
    try {
      await exchangePairing(pairing);
      await refresh();
      setStatus('paired');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '配对失败，请重新生成配对链接。');
    }
  }, [hasPairingLink, pairing, refresh]);

  const requestPairing = useCallback(async () => {
    if (!hasPairingLink) return;
    try {
      const hasExistingCredentials = await hasStoredWorkspaceCredentials();
      if (!hasExistingCredentials) {
        await pair();
        return;
      }

      setStatus('paired');
      setMessage('检测到本机已有工作台连接。只有确认后才会替换现有连接凭证。');
      Alert.alert(
        '替换当前工作台连接？',
        '确认后将使用新的设备凭证替换本机现有连接。未同步的本地待办不会被删除。',
        [
          {
            text: '取消',
            style: 'cancel',
            onPress: () => {
              setStatus('paired');
              setMessage('已保留原有工作台连接。');
            },
          },
          {
            text: '确认替换',
            style: 'destructive',
            onPress: () => void pair(),
          },
        ],
        { cancelable: false },
      );
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '无法检查本机配对状态，请重试。');
    }
  }, [hasPairingLink, pair]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (hasPairingLink) {
        const pairingKey = `${pairing.baseUrl}\u0000${pairing.code}\u0000${pairing.dispatchToken}`;
        if (handledPairingKey.current === pairingKey) return;
        handledPairingKey.current = pairingKey;
        await requestPairing();
        return;
      }
      const existing = await loadWorkspaceSession();
      if (!active) return;
      setStatus(existing ? 'paired' : 'idle');
    })();
    return () => {
      active = false;
    };
  }, [hasPairingLink, pairing, requestPairing]);

  const clear = async () => {
    await clearWorkspaceSession();
    setMessage('本机配对信息已清除。请在电脑工作台重新生成配对链接，并用这台 iPhone 打开。');
    setStatus('idle');
  };

  const busy = status === 'checking' || status === 'pairing';
  const paired = status === 'paired';
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 22, padding: 28 }}>
      <View style={{ alignItems: 'center', gap: 14 }}>
        <View
          style={{
            width: 72,
            height: 72,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 24,
            borderCurve: 'continuous',
            backgroundColor: paired ? '#E8F7EF' : '#EAF2FF',
          }}>
          {busy ? (
            <ActivityIndicator size="large" color={colors.blue} />
          ) : (
            <SymbolIcon
              name={paired ? 'checkmark.seal.fill' : 'link.badge.plus'}
              size={32}
              color={paired ? '#3A9B67' : colors.blue}
            />
          )}
        </View>
        <Text selectable style={{ color: colors.label, fontSize: 28, fontWeight: '800' }}>
          {status === 'pairing'
            ? '正在配对'
            : paired
              ? '已连接工作台'
              : status === 'error'
                ? '配对失败'
                : '连接电脑工作台'}
        </Text>
        <Text
          selectable
          style={{ color: colors.secondaryLabel, lineHeight: 22, textAlign: 'center' }}>
          {message ||
            (paired
              ? '这台 iPhone 已取得独立设备凭证，可以直接读取和更新客户资料。'
              : '请在电脑工作台生成一次性配对链接，再用这台 iPhone 打开。')}
        </Text>
      </View>

      {paired ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/customers' as never)}
          style={({ pressed }) => ({
            minHeight: 52,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 17,
            borderCurve: 'continuous',
            backgroundColor: colors.blue,
            opacity: pressed ? 0.65 : 1,
          })}>
          <Text style={{ color: colors.white, fontSize: 17, fontWeight: '800' }}>查看客户</Text>
        </Pressable>
      ) : null}

      {status === 'error' && hasPairingLink ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void pair()}
          style={({ pressed }) => ({
            minHeight: 52,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 17,
            borderCurve: 'continuous',
            backgroundColor: colors.blue,
            opacity: pressed ? 0.65 : 1,
          })}>
          <Text style={{ color: colors.white, fontSize: 17, fontWeight: '800' }}>重试配对</Text>
        </Pressable>
      ) : null}

      {(status === 'idle' && !hasPairingLink) || status === 'error' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            void Linking.openURL(
              new URL('/settings/data', WORKSPACE_PRODUCTION_BASE_URL).toString(),
            )
          }
          style={({ pressed }) => ({
            minHeight: 52,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 17,
            borderCurve: 'continuous',
            backgroundColor: colors.blue,
            opacity: pressed ? 0.65 : 1,
          })}>
          <Text style={{ color: colors.white, fontSize: 17, fontWeight: '800' }}>
            打开网页生成配对链接
          </Text>
        </Pressable>
      ) : null}

      {!busy ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void clear()}
          style={({ pressed }) => ({
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 16,
            borderCurve: 'continuous',
            backgroundColor: colors.card,
            opacity: pressed ? 0.62 : 1,
          })}>
          <Text style={{ color: '#C13C3C', fontWeight: '700' }}>清除本机配对</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
