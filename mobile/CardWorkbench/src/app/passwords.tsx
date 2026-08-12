import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import { getCredentialCategories, getCredentials } from '@/lib/credential-vault';
import { colors, layout } from '@/theme/colors';
import type { CredentialCategory, CredentialEntry } from '@/types/credential';

export default function PasswordsScreen() {
  const database = useSQLiteContext();
  const router = useRouter();
  const [entries, setEntries] = useState<CredentialEntry[]>([]);
  const [categories, setCategories] = useState<CredentialCategory[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextEntries, nextCategories] = await Promise.all([
        getCredentials(database),
        getCredentialCategories(database),
      ]);
      setEntries(nextEntries);
      setCategories(nextCategories);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '密码库读取失败');
    }
  }, [database]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return entries.filter((entry) => {
      if (selectedCategory && entry.categoryId !== selectedCategory) return false;
      if (!normalized) return true;
      return [
        entry.platformName,
        entry.account,
        entry.email,
        entry.nickname,
        entry.website,
        ...entry.tags,
      ].some((value) => value.toLocaleLowerCase().includes(normalized));
    });
  }, [entries, query, selectedCategory]);

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      await load();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} />}
      contentContainerStyle={styles.content}>
      <View style={styles.topActions}>
        <View style={styles.searchBox}>
          <SymbolIcon name="magnifyingglass" color={colors.secondaryLabel} size={18} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            placeholder="搜索平台、账号、邮箱或标签"
            placeholderTextColor={colors.tertiaryLabel}
            style={styles.searchInput}
          />
        </View>
        <Pressable
          accessibilityLabel="新增密码"
          onPress={() => router.push('/credential/new' as never)}
          style={styles.addButton}>
          <SymbolIcon name="plus" color={colors.white} size={22} />
        </Pressable>
      </View>

      <View style={styles.overview}>
        <View style={styles.overviewCopy}>
          <Text selectable style={styles.overviewTitle}>密码总览</Text>
          <Text selectable style={styles.overviewSubtitle}>已安全保存 {entries.length} 个账号</Text>
        </View>
        <Pressable onPress={() => router.push('/credential/new' as never)} style={styles.overviewButton}>
          <Text style={styles.overviewButtonText}>新增账号</Text>
        </Pressable>
      </View>

      <View style={styles.sectionHeader}>
        <Text selectable style={styles.sectionTitle}>分类</Text>
        {selectedCategory ? (
          <Pressable onPress={() => setSelectedCategory(null)}>
            <Text style={styles.clearText}>查看全部</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.categoryGrid}>
        {categories.map((category) => {
          const count = entries.filter((entry) => entry.categoryId === category.id).length;
          const selected = selectedCategory === category.id;
          return (
            <Pressable
              key={category.id}
              onPress={() => setSelectedCategory(selected ? null : category.id)}
              style={[
                styles.categoryCard,
                { backgroundColor: category.color, opacity: selectedCategory && !selected ? 0.5 : 1 },
              ]}>
              <View style={styles.categoryTop}>
                <View style={styles.categoryIcon}>
                  <SymbolIcon name={category.icon} color={colors.white} size={17} />
                </View>
                <Text selectable style={styles.categoryCount}>{count}</Text>
              </View>
              <Text selectable style={styles.categoryName}>{category.name}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text selectable style={styles.sectionTitle}>账号</Text>
      {errorMessage ? <Text selectable style={styles.error}>{errorMessage}</Text> : null}
      <View style={styles.entryList}>
        {filteredEntries.map((entry) => (
          <Pressable
            key={entry.id}
            onPress={() => router.push({ pathname: '/credential/[id]', params: { id: entry.id } } as never)}
            style={({ pressed }) => [styles.entryRow, { opacity: pressed ? 0.56 : 1 }]}>
            <View style={[styles.entryIcon, { backgroundColor: entry.categoryTint }]}>
              <SymbolIcon name={entry.icon} color={entry.categoryColor} size={21} />
            </View>
            <View style={styles.entryCopy}>
              <Text selectable numberOfLines={1} style={styles.entryTitle}>{entry.platformName}</Text>
              <Text selectable numberOfLines={1} style={styles.entryAccount}>{entry.account || entry.email}</Text>
            </View>
            <Text selectable style={[styles.entryCategory, { color: entry.categoryColor }]}>{entry.categoryName}</Text>
            <SymbolIcon name="chevron.right" color={colors.tertiaryLabel} size={14} />
          </Pressable>
        ))}
        {filteredEntries.length === 0 ? (
          <View style={styles.empty}>
            <SymbolIcon name="key.slash" color={colors.tertiaryLabel} size={30} />
            <Text selectable style={styles.emptyTitle}>{entries.length === 0 ? '还没有账号密码' : '没有匹配结果'}</Text>
            <Text selectable style={styles.emptyText}>{entries.length === 0 ? '点击“新增账号”保存第一条资料' : '换个关键词或分类试试'}</Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 620, alignSelf: 'center', gap: 16, padding: layout.horizontalPadding, paddingBottom: 44 },
  topActions: { flexDirection: 'row', gap: 10 },
  searchBox: { minWidth: 0, flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 17, borderCurve: 'continuous', backgroundColor: colors.card },
  searchInput: { minWidth: 0, flex: 1, color: colors.label, fontSize: 15 },
  addButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: colors.blue },
  overview: { minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, borderRadius: 27, borderCurve: 'continuous', backgroundColor: '#FFC229', boxShadow: '0 8px 24px rgba(203,145,23,0.18)' },
  overviewCopy: { minWidth: 0, flex: 1, gap: 5 },
  overviewTitle: { color: '#2C2113', fontSize: 24, fontWeight: '900' },
  overviewSubtitle: { color: '#73551A', fontSize: 13 },
  overviewButton: { paddingHorizontal: 15, paddingVertical: 11, borderRadius: 18, backgroundColor: '#3A2B16' },
  overviewButtonText: { color: '#FFD765', fontSize: 13, fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.label, fontSize: 20, fontWeight: '900' },
  clearText: { color: colors.blue, fontSize: 13, fontWeight: '700' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryCard: { width: '48%', minHeight: 105, justifyContent: 'space-between', padding: 14, borderRadius: 22, borderCurve: 'continuous' },
  categoryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  categoryIcon: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.22)' },
  categoryCount: { color: colors.white, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  categoryName: { color: colors.white, fontSize: 17, fontWeight: '800' },
  error: { color: colors.red, fontSize: 13, lineHeight: 19 },
  entryList: { overflow: 'hidden', borderRadius: 22, borderCurve: 'continuous', backgroundColor: colors.card },
  entryRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  entryIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  entryCopy: { minWidth: 0, flex: 1, gap: 3 },
  entryTitle: { color: colors.label, fontSize: 16, fontWeight: '800' },
  entryAccount: { color: colors.secondaryLabel, fontSize: 13 },
  entryCategory: { fontSize: 11, fontWeight: '700' },
  empty: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 7, padding: 20 },
  emptyTitle: { color: colors.label, fontSize: 16, fontWeight: '800' },
  emptyText: { color: colors.secondaryLabel, fontSize: 13, textAlign: 'center' },
});
