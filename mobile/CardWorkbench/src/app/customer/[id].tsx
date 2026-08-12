import { Image, type ImageSource } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import { WorkspaceError, WorkspaceLoading } from '@/components/workspace-screen-state';
import { workspaceImageSource, workspaceJson } from '@/lib/workspace-api';
import { colors } from '@/theme/colors';
import type { CustomerActivity, CustomerDetail, CustomerSensitive } from '@/types/customer';

type DetailResponse = { customer: CustomerDetail };
const contactResults = ['已联系', '未接', '待回访', '已成交'] as const;

export default function CustomerDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] ?? '' : params.id ?? '';
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [sensitive, setSensitive] = useState<CustomerSensitive | null>(null);
  const [imageSources, setImageSources] = useState<{
    front?: ImageSource;
    back?: ImageSource;
    license?: ImageSource;
  }>({});
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<CustomerActivity[]>([]);
  const [contactNote, setContactNote] = useState('');
  const [savingContact, setSavingContact] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, protectedData, activityResponse] = await Promise.all([
        workspaceJson<DetailResponse>(`/api/customers/${encodeURIComponent(id)}`),
        workspaceJson<CustomerSensitive>(`/api/customers/${encodeURIComponent(id)}/sensitive`, {
          method: 'POST', body: '{}',
        }),
        workspaceJson<{ items: CustomerActivity[] }>(`/api/customers/${encodeURIComponent(id)}/activity`),
      ]);
      const [front, back, license] = await Promise.all([
        workspaceImageSource(protectedData.idCard.frontUrl),
        workspaceImageSource(protectedData.idCard.backUrl),
        workspaceImageSource(protectedData.businessLicenseUrl ?? null),
      ]);
      setCustomer(detail.customer);
      setSensitive(protectedData);
      setActivities(activityResponse.items);
      setImageSources({ front, back, license });
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const moveToTrash = () => {
    if (!customer) return;
    Alert.alert('删除客户？', `${customer.name} 将进入回收站并保留 30 天。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移入回收站',
        style: 'destructive',
        onPress: () => {
          setDeleting(true);
          void workspaceJson(`/api/customers/${encodeURIComponent(id)}`, { method: 'DELETE' })
            .then(() => router.replace('/customers' as never))
            .catch((deleteError) => Alert.alert('删除失败', errorMessage(deleteError)))
            .finally(() => setDeleting(false));
        },
      },
    ]);
  };

  const recordContact = async (result: (typeof contactResults)[number]) => {
    setSavingContact(true);
    try {
      await workspaceJson(`/api/customers/${encodeURIComponent(id)}/activity`, {
        method: 'POST',
        body: JSON.stringify({ result, note: contactNote.trim() }),
      });
      setContactNote('');
      await load();
    } catch (activityError) {
      Alert.alert('记录失败', errorMessage(activityError));
    } finally {
      setSavingContact(false);
    }
  };

  if (loading) return <WorkspaceLoading label="正在读取客户资料…" />;
  if (error || !customer) return <WorkspaceError error={error} onRetry={() => void load()} />;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ gap: 14, padding: 16, paddingBottom: 80 }}>
      <View style={styles.hero}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{customer.name.slice(0, 1)}</Text>
        </View>
        <View style={{ minWidth: 0, flex: 1, gap: 3 }}>
          <Text selectable style={styles.name}>{customer.name}</Text>
          <Text selectable style={styles.phone}>{sensitive?.phone || customer.maskedPhone}</Text>
          {customer.shopName ? <Text selectable style={styles.shop}>{customer.shopName}</Text> : null}
        </View>
        {sensitive?.phone ? (
          <Pressable
            accessibilityLabel="拨打电话"
            accessibilityRole="button"
            onPress={() => void Linking.openURL(`tel:${sensitive.phone.replace(/[^+\d]/g, '')}`)}
            style={({ pressed }) => [styles.callButton, { opacity: pressed ? 0.6 : 1 }]}>
            <SymbolIcon name="phone.fill" size={19} color={colors.blue} />
          </Pressable>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/customer/${id}/edit` as never)}
        style={({ pressed }) => [styles.editButton, { opacity: pressed ? 0.62 : 1 }]}>
        <SymbolIcon name="pencil" size={18} color={colors.blue} />
        <Text style={styles.editText}>编辑与补充资料</Text>
      </Pressable>

      <Section title="客户信息">
        <InfoRow label="客户分类" value={customer.category ?? '直营'} />
        <InfoRow label="客户阶段" value={customer.stage ?? '新客户'} />
        <InfoRow label="资料状态" value={customer.profileStatus === 'completed' ? '资料完整' : '资料待补'} />
        <InfoRow label="录入时间" value={formatDateTime(customer.createdAt)} />
        <InfoRow label="下次跟进" value={formatDateTime(customer.nextFollowUpAt)} />
        <InfoRow label="地址" value={customer.address || '未录入'} />
        <InfoRow label="标签" value={customer.tags?.join('、') || '未录入'} last />
      </Section>

      <Section title="机器与费率">
        <InfoRow label="机器" value={customer.machineType || '未选择'} />
        <InfoRow label="模式" value={customer.machineMode || '未选择'} />
        <InfoRow label="费率" value={customer.feeRate == null ? '未录入' : `${customer.feeRate}%`} />
        <InfoRow label="押金" value={customer.depositAmount == null ? '未录入' : `¥${customer.depositAmount}`} last />
      </Section>

      <Section title="机器台账与收益">
        <InfoRow label="序列号" value={customer.machineSerial || '未录入'} />
        <InfoRow label="机器状态" value={customer.machineStatus || '未设置'} />
        <InfoRow label="安装时间" value={formatDateTime(customer.installedAt)} />
        <InfoRow label="月交易额" value={customer.monthlyVolume == null ? '未录入' : `¥${formatMoney(customer.monthlyVolume)}`} />
        <InfoRow label="分润比例" value={customer.profitShareRate == null ? '未录入' : `${customer.profitShareRate}%`} />
        <InfoRow label="预计月收益" value={`¥${formatMoney((customer.monthlyVolume ?? 0) * (customer.profitShareRate ?? 0) / 100)}`} last />
      </Section>

      <Section title="记录本次跟进">
        <TextInput
          value={contactNote}
          onChangeText={setContactNote}
          maxLength={300}
          multiline
          placeholder="填写沟通重点（选填）"
          placeholderTextColor={colors.tertiaryLabel}
          style={styles.contactInput}
        />
        <View style={styles.contactChoices}>
          {contactResults.map((result) => (
            <Pressable
              key={result}
              disabled={savingContact}
              onPress={() => void recordContact(result)}
              style={({ pressed }) => [styles.contactChoice, { opacity: pressed || savingContact ? 0.55 : 1 }]}>
              <Text style={styles.contactChoiceText}>{result}</Text>
            </Pressable>
          ))}
        </View>
      </Section>

      <Section title="跟进与操作记录">
        {activities.length ? activities.map((activity, index) => (
          <View key={activity.id} style={[styles.activity, index < activities.length - 1 && styles.divider]}>
            <View style={styles.activityDot} />
            <View style={{ minWidth: 0, flex: 1, gap: 4 }}>
              <Text selectable style={styles.activitySummary}>{activity.summary}</Text>
              <Text selectable style={styles.activityTime}>{formatDateTime(activity.createdAt)}</Text>
            </View>
          </View>
        )) : <Text selectable style={styles.activityEmpty}>还没有跟进记录</Text>}
      </Section>

      <Section title="银行卡">
        <InfoRow label="银行卡号" value={formatBankCard(sensitive?.bankCardNumber)} last monospace />
      </Section>

      <Section title="证件图片">
        <DocumentImage title="身份证正面" source={imageSources.front} />
        <DocumentImage title="身份证反面" source={imageSources.back} />
        <DocumentImage title="营业执照" source={imageSources.license} last />
      </Section>

      <Pressable
        accessibilityRole="button"
        disabled={deleting}
        onPress={moveToTrash}
        style={({ pressed }) => [styles.deleteButton, { opacity: pressed || deleting ? 0.55 : 1 }]}>
        <SymbolIcon name="trash" size={18} color="#C43D3D" />
        <Text style={styles.deleteText}>{deleting ? '正在删除…' : '删除客户'}</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text selectable style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({
  label,
  value,
  last,
  monospace,
}: {
  label: string;
  value: string;
  last?: boolean;
  monospace?: boolean;
}) {
  return (
    <View style={[styles.infoRow, !last && styles.divider]}>
      <Text selectable style={styles.infoLabel}>{label}</Text>
      <Text
        selectable
        style={[styles.infoValue, monospace && { fontVariant: ['tabular-nums'] }]}>
        {value}
      </Text>
    </View>
  );
}

function DocumentImage({ title, source, last }: { title: string; source?: ImageSource; last?: boolean }) {
  return (
    <View style={[styles.document, !last && styles.divider]}>
      <Text selectable style={styles.documentTitle}>{title}</Text>
      {source ? (
        <Image source={source} contentFit="contain" style={styles.documentImage} transition={160} />
      ) : (
        <View style={styles.documentEmpty}>
          <SymbolIcon name="photo" size={22} color={colors.tertiaryLabel} />
          <Text selectable style={styles.documentEmptyText}>未上传</Text>
        </View>
      )}
    </View>
  );
}

function formatDateTime(value?: string | null): string {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatBankCard(value?: string | null): string {
  return value ? value.replace(/(\d{4})(?=\d)/g, '$1 ') : '未录入';
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请稍后重试。';
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 17,
    borderRadius: 23,
    borderCurve: 'continuous',
    backgroundColor: colors.card,
  },
  avatar: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 19, borderCurve: 'continuous', backgroundColor: colors.blueTint },
  avatarText: { color: colors.blue, fontSize: 22, fontWeight: '800' },
  name: { color: colors.label, fontSize: 21, fontWeight: '800' },
  phone: { color: colors.label, fontSize: 15, fontVariant: ['tabular-nums'] },
  shop: { color: colors.secondaryLabel, fontSize: 13 },
  callButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.blueTint },
  section: { overflow: 'hidden', borderRadius: 21, borderCurve: 'continuous', paddingHorizontal: 16, backgroundColor: colors.card },
  sectionTitle: { color: colors.label, fontSize: 17, fontWeight: '800', paddingTop: 16, paddingBottom: 8 },
  infoRow: { minHeight: 47, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 18, paddingVertical: 10 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  infoLabel: { color: colors.secondaryLabel, fontSize: 14 },
  infoValue: { minWidth: 0, flex: 1, color: colors.label, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  document: { gap: 10, paddingVertical: 13 },
  documentTitle: { color: colors.secondaryLabel, fontSize: 14 },
  documentImage: { width: '100%', aspectRatio: 1.58, borderRadius: 14, borderCurve: 'continuous', backgroundColor: '#F0F1F5' },
  documentEmpty: { minHeight: 86, alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, borderCurve: 'continuous', backgroundColor: '#F3F4F7' },
  documentEmptyText: { color: colors.tertiaryLabel, fontSize: 13 },
  deleteButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 17, borderCurve: 'continuous', backgroundColor: '#FDECEC' },
  deleteText: { color: '#C43D3D', fontSize: 16, fontWeight: '800' },
  editButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 17, borderCurve: 'continuous', backgroundColor: colors.blueTint },
  editText: { color: colors.blue, fontSize: 16, fontWeight: '800' },
  contactInput: { minHeight: 78, padding: 12, borderRadius: 14, borderCurve: 'continuous', backgroundColor: '#F4F6FA', color: colors.label, fontSize: 15, textAlignVertical: 'top' },
  contactChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 14 },
  contactChoice: { minHeight: 40, flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 13, borderCurve: 'continuous', backgroundColor: colors.blueTint },
  contactChoiceText: { color: colors.blue, fontSize: 14, fontWeight: '800' },
  activity: { minHeight: 63, flexDirection: 'row', gap: 11, paddingVertical: 12 },
  activityDot: { width: 9, height: 9, marginTop: 5, borderRadius: 5, backgroundColor: colors.blue },
  activitySummary: { color: colors.label, fontSize: 14, lineHeight: 20 },
  activityTime: { color: colors.tertiaryLabel, fontSize: 11 },
  activityEmpty: { color: colors.secondaryLabel, fontSize: 14, paddingVertical: 20, textAlign: 'center' },
});
