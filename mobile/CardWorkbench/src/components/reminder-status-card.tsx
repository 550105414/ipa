import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import { formatDueDate } from '@/lib/date';
import {
  enableTaskReminders,
  getReminderStatus,
  scheduleReminderTest,
  type ReminderStatus,
} from '@/lib/todo-notifications';
import { useTodos } from '@/providers/todo-provider';
import { colors } from '@/theme/colors';

export function ReminderStatusCard() {
  const { tasks, reminderError } = useTodos();
  const [status, setStatus] = useState<ReminderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    const currentGeneration = ++generation.current;
    try {
      const next = await getReminderStatus(tasks);
      if (mounted.current && currentGeneration === generation.current) {
        setStatus(next);
        setError(null);
      }
    } catch (caught) {
      if (mounted.current && currentGeneration === generation.current) {
        setError(caught instanceof Error ? caught.message : '无法检查提醒状态，请重试。');
      }
    }
  }, [tasks]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  useEffect(() => {
    void reload();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reload();
    });
    return () => subscription.remove();
  }, [reload, reminderError]);

  const openSettings = async () => {
    try {
      await Linking.openSettings();
    } catch {
      Alert.alert('打开通知设置', '请到 iPhone 设置 → 通知 → 工作台，开启允许通知、锁定屏幕和声音。');
    }
  };

  const run = async (test: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await enableTaskReminders(tasks);
      if (mounted.current) setStatus(next);
      if (!next.granted) {
        Alert.alert('尚未允许通知', '待办已保存在 App 内。请在设置中开启工作台的通知和锁定屏幕提醒。', [
          { text: '稍后', style: 'cancel' },
          { text: '打开设置', onPress: () => void openSettings() },
        ]);
      } else if (test) {
        await scheduleReminderTest();
        Alert.alert('10 秒后测试提醒', '现在可以按侧边键锁屏，查看“工作台”的通知卡片。如果没有声音或没有亮屏，请检查声音、静音开关和专注模式。');
      }
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : '提醒预定失败，请重试。');
    } finally {
      if (mounted.current) setBusy(false);
      void reload();
    }
  };

  const needsSettings = status && (status.authorization === 'denied' || status.authorization === 'quiet' ||
    (status.granted && (status.lockScreen === false || status.sound === false || status.alert === false)));
  const failure = error ?? (status ? status.error : reminderError);
  const permissionLabel = !status ? '正在检查…' :
    !status.supported ? '当前平台不支持原生锁屏提醒' :
      status.authorization === 'not-requested' ? '开启后，到时间显示通知卡片' :
        !status.granted ? '未允许通知，请打开系统设置' :
          status.authorization === 'quiet' ? '当前为静默通知，请在设置中开启提醒' :
            `已预定 ${status.scheduledCount} 条到期提醒`;

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <SymbolIcon name="bell.badge" size={19} color={colors.blue} />
        <Text style={styles.title}>锁屏提醒</Text>
        {status?.granted ? <Text style={styles.active}>已开启</Text> : null}
      </View>
      <Text selectable style={styles.summary}>{permissionLabel}</Text>
      {status?.granted ? (
        <View style={styles.permissions}>
          <Text style={[styles.permission, status.lockScreen === false && styles.warning]}>
            锁屏：{status.lockScreen === null ? '由系统控制' : status.lockScreen ? '开启' : '关闭'}
          </Text>
          <Text style={[styles.permission, status.sound === false && styles.warning]}>
            声音：{status.sound === null ? '由系统控制' : status.sound ? '开启' : '关闭'}
          </Text>
        </View>
      ) : null}
      {status?.granted && status.nextReminderAt ? (
        <Text selectable style={styles.note}>下次：{formatDueDate(status.nextReminderAt)}</Text>
      ) : null}
      {status && status.deferredCount > 0 ? (
        <Text selectable style={[styles.note, styles.warning]}>
          共 {status.requestedCount} 条未来提醒，先预定最近 32 条；其余 {status.deferredCount} 条在再次打开 App 时补排。
        </Text>
      ) : null}
      <Text selectable style={styles.note}>
        选择具体时间按时提醒；只选日期默认上午 9:00。锁屏卡片和声音受系统通知设置、静音及专注模式控制。
      </Text>
      {failure ? <Text selectable style={styles.error}>{failure}</Text> : null}
      {status?.supported !== false ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => needsSettings ? void openSettings() : void run(false)}
            style={({ pressed }) => [styles.button, { opacity: busy || pressed ? 0.55 : 1 }]}>
            <Text style={styles.buttonLabel}>
              {busy ? '处理中…' : needsSettings ? '通知设置' : status?.granted ? '重新检查' : '开启提醒'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="预定十秒后的锁屏测试提醒"
            disabled={busy}
            onPress={() => void run(true)}
            style={({ pressed }) => [styles.button, styles.secondaryButton, { opacity: busy || pressed ? 0.55 : 1 }]}>
            <Text style={styles.buttonLabel}>10 秒测试</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 15,
    gap: 8,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: colors.card,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.label },
  active: { fontSize: 11, fontWeight: '600', color: colors.blue },
  summary: { fontSize: 14, lineHeight: 20, color: colors.label },
  permissions: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  permission: { fontSize: 12, lineHeight: 18, color: colors.secondaryLabel },
  note: { fontSize: 12, lineHeight: 18, color: colors.secondaryLabel },
  warning: { color: colors.orange },
  error: { fontSize: 12, lineHeight: 18, color: colors.red },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 2 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 13, backgroundColor: colors.blueTint },
  secondaryButton: { backgroundColor: colors.cardMuted },
  buttonLabel: { fontSize: 13, fontWeight: '600', color: colors.blue },
});
