import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import { WorkspaceError, WorkspaceLoading } from '@/components/workspace-screen-state';
import { workspaceJson } from '@/lib/workspace-api';
import { colors } from '@/theme/colors';
import type { CustomerSummary, SearchResponse } from '@/types/customer';

export default function CustomersScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [items, setItems] = useState<CustomerSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const requestId = useRef(0);
  const queryRef = useRef('');
  const hasFocusedOnce = useRef(false);
  const loadRef = useRef<(options?: { refreshing?: boolean }) => Promise<void>>(async () => {});

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (options?: { refreshing?: boolean }) => {
      const currentRequest = ++requestId.current;
      const inputAtRequest = queryRef.current.trim();
      if (options?.refreshing) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const data = await workspaceJson<SearchResponse>('/api/search', {
          method: 'POST',
          body: JSON.stringify({
            q: debouncedQuery,
            scope: 'customers',
            status: 'all',
            period: 'all',
            category: 'all',
            limit: 20,
          }),
        });
        if (
          requestId.current !== currentRequest ||
          queryRef.current.trim() !== inputAtRequest
        ) return;
        setItems(data.items.filter((item) => item.kind === 'customer'));
        setNextCursor(data.nextCursor);
        setTotal(data.total ?? data.items.length);
      } catch (loadError) {
        if (
          requestId.current === currentRequest &&
          queryRef.current.trim() === inputAtRequest
        ) setError(loadError);
      } finally {
        if (requestId.current === currentRequest) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [debouncedQuery],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (hasFocusedOnce.current) {
        void loadRef.current({ refreshing: true });
      } else {
        hasFocusedOnce.current = true;
      }
    }, []),
  );

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const currentRequest = ++requestId.current;
    const inputAtRequest = queryRef.current.trim();
    setLoadingMore(true);
    try {
      const data = await workspaceJson<SearchResponse>('/api/search', {
        method: 'POST',
        body: JSON.stringify({
          q: debouncedQuery,
          scope: 'customers',
          status: 'all',
          period: 'all',
          category: 'all',
          cursor: nextCursor,
          limit: 20,
        }),
      });
      if (
        requestId.current !== currentRequest ||
        queryRef.current.trim() !== inputAtRequest
      ) return;
      setItems((current) => [...current, ...data.items.filter((item) => item.kind === 'customer')]);
      setNextCursor(data.nextCursor);
    } catch (loadError) {
      if (
        requestId.current === currentRequest &&
        queryRef.current.trim() === inputAtRequest
      ) setError(loadError);
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading && items.length === 0 && !error) return <WorkspaceLoading label="正在读取客户…" />;
  if (error && items.length === 0) return <WorkspaceError error={error} onRetry={() => void load()} />;

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load({ refreshing: true })} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.searchBox}>
            <SymbolIcon name="magnifyingglass" color={colors.secondaryLabel} size={18} />
            <TextInput
              value={query}
              onChangeText={(value) => {
                queryRef.current = value;
                setQuery(value);
              }}
              placeholder="搜索姓名、手机号或店铺"
              placeholderTextColor={colors.tertiaryLabel}
              clearButtonMode="while-editing"
              returnKeyType="search"
              style={styles.searchInput}
            />
          </View>
          <View style={styles.summaryRow}>
            <Text selectable style={styles.summaryText}>共 {total} 位客户</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/trash' as never)}
              style={({ pressed }) => [styles.trashButton, { opacity: pressed ? 0.55 : 1 }]}>
              <SymbolIcon name="archivebox" color={colors.blue} size={16} />
              <Text style={styles.trashButtonText}>回收站</Text>
            </Pressable>
          </View>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <SymbolIcon name="person.2" size={34} color={colors.tertiaryLabel} />
          <Text selectable style={styles.emptyTitle}>{query.trim() ? '没有找到匹配客户' : '还没有客户'}</Text>
          <Text selectable style={styles.emptyText}>
            {query.trim() ? '请更换姓名、手机号或店铺关键词。' : '录入第一位客户后，手机与电脑会自动同步。'}
          </Text>
          {!query.trim() ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/customer/new' as never)}
              style={({ pressed }) => [styles.emptyAddButton, { opacity: pressed ? 0.62 : 1 }]}>
              <SymbolIcon name="person.badge.plus" size={18} color={colors.white} />
              <Text style={styles.emptyAddText}>新增客户</Text>
            </Pressable>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/customer/${item.id}` as never)}
          style={({ pressed }) => [styles.card, { opacity: pressed ? 0.64 : 1 }]}>
          <View style={styles.cardTop}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name.slice(0, 1)}</Text>
            </View>
            <View style={styles.cardCopy}>
              <Text selectable numberOfLines={1} style={styles.name}>{item.name}</Text>
              <Text selectable style={styles.phone}>{item.maskedPhone}</Text>
              {item.shopName ? <Text selectable numberOfLines={1} style={styles.shop}>{item.shopName}</Text> : null}
            </View>
            <SymbolIcon name="chevron.right" size={15} color={colors.tertiaryLabel} />
          </View>
          <View style={styles.metaRow}>
            <View style={[styles.statusPill, item.profileStatus === 'completed' ? styles.complete : styles.draft]}>
              <Text style={item.profileStatus === 'completed' ? styles.completeText : styles.draftText}>
                {item.profileStatus === 'completed' ? '资料完整' : '资料待补'}
              </Text>
            </View>
            <Text selectable style={styles.metaText}>{item.category ?? '直营'}</Text>
            {item.nextFollowUpAt ? (
              <Text selectable style={styles.followUp}>跟进 {formatDate(item.nextFollowUpAt)}</Text>
            ) : null}
          </View>
        </Pressable>
      )}
      ListFooterComponent={
        nextCursor ? (
          <Pressable
            disabled={loadingMore}
            onPress={() => void loadMore()}
            style={({ pressed }) => [styles.loadMore, { opacity: pressed || loadingMore ? 0.55 : 1 }]}>
            <Text style={styles.loadMoreText}>{loadingMore ? '正在加载…' : '加载更多'}</Text>
          </Pressable>
        ) : null
      }
    />
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 11, paddingBottom: 110 },
  header: { gap: 12, paddingBottom: 5 },
  searchBox: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: colors.card,
  },
  searchInput: { flex: 1, minHeight: 48, color: colors.label, fontSize: 16 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryText: { color: colors.secondaryLabel, fontSize: 13 },
  trashButton: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 7 },
  trashButtonText: { color: colors.blue, fontSize: 13, fontWeight: '700' },
  card: {
    gap: 12,
    padding: 15,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: colors.card,
    boxShadow: '0 3px 12px rgba(40,50,75,0.06)',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: colors.blueTint,
  },
  avatarText: { color: colors.blue, fontSize: 18, fontWeight: '800' },
  cardCopy: { minWidth: 0, flex: 1, gap: 2 },
  name: { color: colors.label, fontSize: 17, fontWeight: '800' },
  phone: { color: colors.secondaryLabel, fontSize: 14, fontVariant: ['tabular-nums'] },
  shop: { color: colors.secondaryLabel, fontSize: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusPill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  complete: { backgroundColor: '#E9F7F0' },
  draft: { backgroundColor: '#FFF3DF' },
  completeText: { color: '#348462', fontSize: 11, fontWeight: '700' },
  draftText: { color: '#B66B12', fontSize: 11, fontWeight: '700' },
  metaText: { color: colors.secondaryLabel, fontSize: 12 },
  followUp: { marginLeft: 'auto', color: colors.blue, fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', gap: 9, paddingVertical: 78 },
  emptyTitle: { color: colors.label, fontSize: 18, fontWeight: '800' },
  emptyText: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  emptyAddButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 18, borderRadius: 15, borderCurve: 'continuous', backgroundColor: colors.blue },
  emptyAddText: { color: colors.white, fontSize: 15, fontWeight: '800' },
  loadMore: { alignItems: 'center', padding: 18 },
  loadMoreText: { color: colors.blue, fontWeight: '700' },
});
