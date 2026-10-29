import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';

import { AccountSyncProgress } from '@/components/account-sync-progress';
import { SymbolIcon } from '@/components/symbol-icon';
import { getAccountSyncStatus, subscribeAccountSyncStatus, syncCredentialVault } from '@/lib/account-sync';
import { subscribeAccountSyncChanges } from '@/lib/account-sync-events';
import { subscribeToFaceIdSessionGranted } from '@/lib/face-id-session';
import { useTodos } from '@/providers/todo-provider';
import { colors } from '@/theme/colors';

export function AccountSyncBridge() {
  const database = useSQLiteContext();
  const { refresh } = useTodos();
  useEffect(() => {
    // Do not await TodoProvider/WidgetKit before starting the independent vault
    // subset. The sync engine itself enforces foreground, unlock and identity.
    const synchronize = () => { void syncCredentialVault(database).catch(() => undefined); };
    synchronize();
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') synchronize(); });
    const granted = subscribeToFaceIdSessionGranted(synchronize);
    const changes = subscribeAccountSyncChanges((event) => {
      if (event !== 'local-changed' && event !== 'settings-changed') return;
      synchronize();
      void refresh().catch(() => undefined);
    });
    return () => { appState.remove(); granted(); changes(); };
  }, [database, refresh]);
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
      <AccountSyncProgress status={status} />
      {status.lastVaultSyncedAt ? <Text selectable style={{ fontSize: 11, color: colors.secondaryLabel }}>密码库最近成功：{new Date(status.lastVaultSyncedAt).toLocaleString()}</Text> : null}
      {status.lastSyncedAt ? <Text selectable style={{ fontSize: 11, color: colors.secondaryLabel }}>完整资料最近成功：{new Date(status.lastSyncedAt).toLocaleString()}</Text> : null}
    </Pressable>
  );
}
