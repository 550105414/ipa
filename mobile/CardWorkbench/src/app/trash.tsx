import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import { WorkspaceError, WorkspaceLoading } from '@/components/workspace-screen-state';
import { workspaceJson, workspaceRequest } from '@/lib/workspace-api';
import { colors } from '@/theme/colors';
import type { TrashedCustomer } from '@/types/customer';

export default function TrashScreen() {
  const [items, setItems] = useState<TrashedCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await workspaceJson<{ items: TrashedCustomer[] }>('/api/customers/trash');
      setItems(data.items);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => void load(), [load]));

  const restore = async (item: TrashedCustomer) => {
    setBusyId(item.id);
    try {
      await workspaceJson(`/api/customers/${encodeURIComponent(item.id)}/restore`, { method: 'POST' });
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch (restoreError) {
      Alert.alert('恢复失败', message(restoreError));
    } finally {
      setBusyId(null);
    }
  };

  const permanentlyDelete = (item: TrashedCustomer) => {
    Alert.alert('永久删除？', `${item.name} 的客户资料和证件图片将无法恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '永久删除',
        style: 'destructive',
        onPress: () => {
          setBusyId(item.id);
          void workspaceRequest(`/api/customers/${encodeURIComponent(item.id)}/permanent`, { method: 'DELETE' })
            .then(() => setItems((current) => current.filter((candidate) => candidate.id !== item.id)))
            .catch((deleteError) => Alert.alert('删除失败', message(deleteError)))
            .finally(() => setBusyId(null));
        },
      },
    ]);
  };

  if (loading) return <WorkspaceLoading label="正在读取回收站…" />;
  if (error) return <WorkspaceError error={error} onRetry={() => void load()} />;

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <Text selectable style={styles.notice}>删除的客户保留 30 天，到期后自动永久清除。</Text>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <SymbolIcon name="archivebox" size={34} color={colors.tertiaryLabel} />
          <Text selectable style={styles.emptyTitle}>回收站是空的</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={{ minWidth: 0, flex: 1, gap: 3 }}>
              <Text selectable style={styles.name}>{item.name}</Text>
              <Text selectable style={styles.meta}>{item.maskedPhone} · {item.category}</Text>
              {item.shopName ? <Text selectable style={styles.meta}>{item.shopName}</Text> : null}
            </View>
            <Text selectable style={styles.remaining}>{daysRemaining(item.purgeAfter)} 天后清除</Text>
          </View>
          <View style={styles.actions}>
            <Pressable
              disabled={busyId === item.id}
              onPress={() => void restore(item)}
              style={({ pressed }) => [styles.restoreButton, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={styles.restoreText}>恢复客户</Text>
            </Pressable>
            <Pressable
              disabled={busyId === item.id}
              onPress={() => permanentlyDelete(item)}
              style={({ pressed }) => [styles.deleteButton, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={styles.deleteText}>永久删除</Text>
            </Pressable>
          </View>
        </View>
      )}
    />
  );
}

function daysRemaining(value: string): number {
  const milliseconds = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.ceil(milliseconds / 86_400_000));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '请稍后重试。';
}

const styles = StyleSheet.create({
  content: { gap: 11, padding: 16, paddingBottom: 70 },
  notice: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 19, paddingBottom: 2 },
  card: { gap: 14, padding: 16, borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.card },
  cardTop: { flexDirection: 'row', gap: 12 },
  name: { color: colors.label, fontSize: 17, fontWeight: '800' },
  meta: { color: colors.secondaryLabel, fontSize: 13 },
  remaining: { color: '#B66B12', fontSize: 12, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 9 },
  restoreButton: { flex: 1, minHeight: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.blueTint },
  restoreText: { color: colors.blue, fontWeight: '800' },
  deleteButton: { flex: 1, minHeight: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderCurve: 'continuous', backgroundColor: '#FDECEC' },
  deleteText: { color: '#C43D3D', fontWeight: '800' },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 90 },
  emptyTitle: { color: colors.label, fontSize: 18, fontWeight: '800' },
});
