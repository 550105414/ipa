import { useRouter } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import { getAccountSyncStatus, subscribeAccountSyncStatus } from '@/lib/account-sync';
import { subscribeAccountSyncChanges } from '@/lib/account-sync-events';
import { useTodos } from '@/providers/todo-provider';
import { colors } from '@/theme/colors';

export function AccountSyncBridge() {
  const { refresh } = useTodos();
  useEffect(() => subscribeAccountSyncChanges((event) => {
    if (event === 'local-changed' || event === 'settings-changed') void refresh().catch(() => undefined);
  }), [refresh]);
  return null;
}

export function AccountSyncCard() {
  const router = useRouter();
  const status = useSyncExternalStore(subscribeAccountSyncStatus, getAccountSyncStatus, getAccountSyncStatus);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="打开 iPhone 与安卓加密同步设置"
      onPress={() => router.push('/sync' as never)}
      style={({ pressed }) => ({ padding: 16, gap: 8, marginBottom: 16, borderRadius: 20, backgroundColor: colors.card, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <SymbolIcon name="arrow.triangle.2.circlepath" size={19} color={colors.blue} />
        <Text style={{ color: colors.label, fontWeight: '700', fontSize: 16, flex: 1 }}>iPhone / 安卓加密同步</Text>
        <SymbolIcon name="chevron.right" size={13} color={colors.secondaryLabel} />
      </View>
      <Text selectable style={{ color: status.phase === 'error' || status.phase === 'conflict' ? colors.red : colors.secondaryLabel, fontSize: 12, lineHeight: 18 }}>{status.message}</Text>
      {status.lastSyncedAt ? <Text selectable style={{ fontSize: 11, color: colors.secondaryLabel }}>最近同步：{new Date(status.lastSyncedAt).toLocaleString()}</Text> : null}
    </Pressable>
  );
}
