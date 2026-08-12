import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import { deleteCredential, getCredential } from '@/lib/credential-vault';
import { colors, layout } from '@/theme/colors';
import type { CredentialEntry } from '@/types/credential';

export default function CredentialDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const database = useSQLiteContext();
  const router = useRouter();
  const [entry, setEntry] = useState<CredentialEntry | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setShowPassword(false);
      void getCredential(database, id)
        .then((value) => {
          if (active) setEntry(value);
        })
        .catch((error) => {
          if (active) setMessage(error instanceof Error ? error.message : '密码资料读取失败');
        });
      return () => {
        active = false;
        setShowPassword(false);
        setEntry(null);
      };
    }, [database, id]),
  );

  const copy = async (label: string, value: string) => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    setMessage(`${label}已复制`);
    setTimeout(() => setMessage(null), 1500);
  };

  const remove = () => {
    Alert.alert('删除密码资料？', '删除后无法恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void deleteCredential(database, id).then(() => router.replace('/passwords' as never));
        },
      },
    ]);
  };

  if (!entry) {
    return (
      <View style={styles.loading}>
        <Text selectable style={styles.secondary}>{message ?? '正在解密…'}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <View style={styles.identity}>
        <View style={[styles.bigIcon, { backgroundColor: entry.categoryTint }]}>
          <SymbolIcon name={entry.icon} color={entry.categoryColor} size={38} />
        </View>
        <Text selectable style={styles.title}>{entry.platformName}</Text>
        <Text selectable style={[styles.category, { color: entry.categoryColor }]}>{entry.categoryName}</Text>
      </View>

      {message ? <Text selectable style={styles.toast}>{message}</Text> : null}

      <View style={styles.card}>
        <DetailRow label="账号" value={entry.account} onCopy={() => void copy('账号', entry.account)} />
        <DetailRow
          label="密码"
          value={showPassword ? entry.password : '••••••••••••••••'}
          onCopy={() => void copy('密码', entry.password)}
          action={
            <Pressable accessibilityLabel={showPassword ? '隐藏密码' : '显示密码'} onPress={() => setShowPassword((value) => !value)}>
              <SymbolIcon name={showPassword ? 'eye.slash' : 'eye'} color={colors.blue} size={19} />
            </Pressable>
          }
        />
        <DetailRow label="邮箱" value={entry.email} onCopy={() => void copy('邮箱', entry.email)} />
        <DetailRow label="昵称" value={entry.nickname} onCopy={() => void copy('昵称', entry.nickname)} />
        <DetailRow label="网站" value={entry.website} onCopy={() => void copy('网站', entry.website)} />
      </View>

      {entry.tags.length || entry.notes ? (
        <View style={styles.card}>
          {entry.tags.length ? (
            <View style={styles.tags}>
              {entry.tags.map((tag) => <Text selectable key={tag} style={styles.tag}>#{tag}</Text>)}
            </View>
          ) : null}
          {entry.notes ? <Text selectable style={styles.notes}>{entry.notes}</Text> : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <DetailRow label="创建时间" value={formatDate(entry.createdAt)} />
        <DetailRow label="更新时间" value={formatDate(entry.updatedAt)} />
      </View>

      <Pressable
        onPress={() => router.push({ pathname: '/credential/[id]/edit', params: { id } } as never)}
        style={styles.editButton}>
        <Text style={styles.editText}>编辑资料</Text>
      </Pressable>
      <Pressable onPress={remove} style={styles.deleteButton}>
        <Text style={styles.deleteText}>删除密码资料</Text>
      </Pressable>
    </ScrollView>
  );
}

function DetailRow({ label, value, onCopy, action }: { label: string; value: string; onCopy?: () => void; action?: ReactNode }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text selectable style={styles.rowLabel}>{label}</Text>
      <Text selectable numberOfLines={2} style={styles.rowValue}>{value}</Text>
      {action}
      {onCopy ? (
        <Pressable onPress={onCopy}>
          <Text style={styles.copy}>复制</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: 16, padding: layout.horizontalPadding, paddingBottom: 46 },
  identity: { alignItems: 'center', gap: 7, paddingVertical: 14 },
  bigIcon: { width: 82, height: 82, alignItems: 'center', justifyContent: 'center', borderRadius: 27, borderCurve: 'continuous' },
  title: { color: colors.label, fontSize: 26, fontWeight: '900' },
  category: { fontSize: 14, fontWeight: '700' },
  toast: { color: colors.blue, textAlign: 'center', fontSize: 13, fontWeight: '700' },
  card: { overflow: 'hidden', borderRadius: 22, borderCurve: 'continuous', paddingHorizontal: 16, backgroundColor: colors.card },
  row: { minHeight: 57, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  rowLabel: { width: 72, color: colors.secondaryLabel, fontSize: 14 },
  rowValue: { minWidth: 0, flex: 1, color: colors.label, fontSize: 15, textAlign: 'right' },
  copy: { color: colors.blue, fontSize: 14, fontWeight: '700' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingVertical: 14 },
  tag: { color: colors.blue, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: colors.blueTint },
  notes: { color: colors.label, fontSize: 15, lineHeight: 22, paddingVertical: 14 },
  editButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.blue },
  editText: { color: colors.white, fontSize: 16, fontWeight: '800' },
  deleteButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: colors.red, fontSize: 15, fontWeight: '700' },
  secondary: { color: colors.secondaryLabel, fontSize: 15 },
});
