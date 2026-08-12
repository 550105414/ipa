import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import { WorkspaceError, WorkspaceLoading } from '@/components/workspace-screen-state';
import { workspaceJson } from '@/lib/workspace-api';
import { colors } from '@/theme/colors';
import type { WorkspaceDashboard } from '@/types/customer';

export default function TodayScreen() {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try { setData(await workspaceJson<WorkspaceDashboard>('/api/workspace-dashboard')); }
    catch (loadError) { setError(loadError); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));
  if (loading && !data) return <WorkspaceLoading label="正在整理今日工作…" />;
  if (error && !data) return <WorkspaceError error={error} onRetry={() => void load()} />;
  if (!data) return null;
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />} contentContainerStyle={styles.content}>
      <View style={styles.hero}><Text selectable style={styles.eyebrow}>TODAY · 今日工作</Text><Text selectable style={styles.title}>先处理 {data.followUps.totalDue} 位到期客户</Text><Text selectable style={styles.copy}>逾期 {data.followUps.overdue} 位 · 资料待补 {data.totals.draft} 位</Text></View>
      <View style={styles.metrics}><Metric label="客户" value={data.totals.customers} color="#3479C8" /><Metric label="已商户" value={data.totals.merchants} color="#2F9461" /><Metric label="机器" value={data.earnings.activeMachines} color="#A66A2A" /><Metric label="资料问题" value={data.health.total} color="#C44D58" /></View>
      <Section title="到期跟进">
        {data.followUps.items.length ? data.followUps.items.map((item) => <Row key={item.id} title={item.name} subtitle={`${item.maskedPhone} · ${formatTime(item.nextFollowUpAt)}`} warning={item.overdue} onPress={() => router.push(`/customer/${item.id}` as never)} />) : <Empty text="今天没有到期跟进" />}
      </Section>
      <Section title="客户阶段"><View style={styles.stageGrid}>{data.stages.map((item) => <View key={item.stage} style={styles.stage}><Text selectable style={styles.stageCount}>{item.count}</Text><Text selectable style={styles.stageLabel}>{item.stage}</Text></View>)}</View></Section>
      <Section title="本月收益估算"><View style={styles.earnings}><Value label="月交易额" value={`¥${money(data.earnings.monthlyVolume)}`} /><Value label="预计分润" value={`¥${money(data.earnings.estimatedProfit)}`} green /></View></Section>
      <Section title="数据体检">{data.health.issues.length ? data.health.issues.map((item) => <Row key={item.id} title={item.name} subtitle={item.issues.join('、')} warning onPress={() => router.push(`/customer/${item.id}` as never)} />) : <Empty text="客户资料状态良好" />}</Section>
    </ScrollView>
  );
}
function Metric({ label, value, color }: { label: string; value: number; color: string }) { return <View style={styles.metric}><Text selectable style={[styles.metricValue, { color }]}>{value}</Text><Text selectable style={styles.metricLabel}>{label}</Text></View>; }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <View style={styles.section}><Text selectable style={styles.sectionTitle}>{title}</Text>{children}</View>; }
function Row({ title, subtitle, warning, onPress }: { title: string; subtitle: string; warning?: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}><View style={[styles.rowIcon, warning && styles.rowIconWarning]}><SymbolIcon name={warning ? 'exclamationmark.circle.fill' : 'checkmark.circle.fill'} size={18} color={warning ? '#C44D58' : '#2F9461'} /></View><View style={{ flex: 1, gap: 3 }}><Text selectable style={styles.rowTitle}>{title}</Text><Text selectable style={styles.rowSubtitle}>{subtitle}</Text></View><SymbolIcon name="chevron.right" size={13} color={colors.tertiaryLabel} /></Pressable>; }
function Value({ label, value, green }: { label: string; value: string; green?: boolean }) { return <View><Text selectable style={styles.valueLabel}>{label}</Text><Text selectable style={[styles.value, green && { color: '#2F9461' }]}>{value}</Text></View>; }
function Empty({ text }: { text: string }) { return <Text selectable style={styles.empty}>{text}</Text>; }
function money(value: number) { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value); }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date); }
const styles = StyleSheet.create({
  content: { gap: 14, padding: 16, paddingBottom: 70 }, hero: { gap: 7, padding: 20, borderRadius: 25, borderCurve: 'continuous', backgroundColor: '#EAF2FF' }, eyebrow: { color: colors.blue, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 }, title: { color: colors.label, fontSize: 23, fontWeight: '800' }, copy: { color: colors.secondaryLabel, fontSize: 13 }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, metric: { width: '47%', flexGrow: 1, gap: 4, padding: 15, borderRadius: 19, borderCurve: 'continuous', backgroundColor: colors.card }, metricValue: { fontSize: 25, fontWeight: '800', fontVariant: ['tabular-nums'] }, metricLabel: { color: colors.secondaryLabel, fontSize: 12 }, section: { overflow: 'hidden', gap: 8, padding: 16, borderRadius: 22, borderCurve: 'continuous', backgroundColor: colors.card }, sectionTitle: { color: colors.label, fontSize: 18, fontWeight: '800' }, row: { minHeight: 61, flexDirection: 'row', alignItems: 'center', gap: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator }, rowIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#EAF7F0' }, rowIconWarning: { backgroundColor: '#FDECEF' }, rowTitle: { color: colors.label, fontSize: 15, fontWeight: '700' }, rowSubtitle: { color: colors.secondaryLabel, fontSize: 12 }, stageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, stage: { width: '30%', flexGrow: 1, gap: 2, padding: 11, borderRadius: 14, borderCurve: 'continuous', backgroundColor: '#F4F6FA' }, stageCount: { color: colors.label, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }, stageLabel: { color: colors.secondaryLabel, fontSize: 11 }, earnings: { flexDirection: 'row', justifyContent: 'space-between', gap: 15, paddingTop: 5 }, valueLabel: { color: colors.secondaryLabel, fontSize: 12, paddingBottom: 5 }, value: { color: colors.label, fontSize: 21, fontWeight: '800', fontVariant: ['tabular-nums'] }, empty: { color: colors.secondaryLabel, fontSize: 14, paddingVertical: 18, textAlign: 'center' },
});
