import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/bottom-navigation';
import { FloatingAddButton } from '@/components/floating-add-button';
import { ReminderStatusCard } from '@/components/reminder-status-card';
import { ScreenState } from '@/components/screen-state';
import { SymbolIcon } from '@/components/symbol-icon';
import { TaskRow } from '@/components/task-row';
import { getDueSection, type DueSection } from '@/lib/date';
import { useTodos } from '@/providers/todo-provider';
import { colors, layout } from '@/theme/colors';
import type { TodoTask } from '@/types/todo';

const sectionConfiguration: { key: DueSection; title: string; color: string }[] = [
  { key: 'overdue', title: '过期', color: colors.red },
  { key: 'today', title: '今天', color: '#74747D' },
  { key: 'future', title: '未来', color: '#74747D' },
  { key: 'unscheduled', title: '未安排', color: '#74747D' },
];

type PlanSectionProps = {
  title: string;
  color: string;
  tasks: TodoTask[];
  onToggleCompleted: (id: number) => void;
  onToggleStarred: (id: number) => void;
  onEditDate: (id: number) => void;
};

function PlanSection({
  title,
  color,
  tasks,
  onToggleCompleted,
  onToggleStarred,
  onEditDate,
}: PlanSectionProps) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text selectable style={[styles.sectionTitle, { color }]}>
          {title}
        </Text>
        <Text selectable style={[styles.sectionCount, { color }]}>
          {tasks.length}
        </Text>
      </View>
      <View style={styles.sectionCard}>
        {tasks.map((task, index) => (
          <View key={task.id}>
            {index > 0 ? <View style={styles.separator} /> : null}
            <TaskRow
              task={task}
              showCategory
              onEditDate={onEditDate}
              onToggleCompleted={onToggleCompleted}
              onToggleStarred={onToggleStarred}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

export default function PlanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    tasks,
    isLoading,
    errorMessage,
    syncStatus,
    syncMessage,
    syncMetrics,
    widgetStatus,
    widgetUpdatedAt,
    widgetError,
    refresh,
    toggleCompleted,
    toggleStarred,
  } = useTodos();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pendingTasks = tasks.filter((task) => !task.completedAt);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } catch (error) {
      Alert.alert('刷新失败', error instanceof Error ? error.message : '本机数据仍然保留，请稍后重试。');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={() => void handleRefresh()} />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 18,
            paddingBottom: Math.max(insets.bottom, 12) + layout.bottomContentInset,
          },
        ]}>
        <Text selectable style={styles.title}>
          计划
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="立即同步待办和桌面小组件"
          disabled={syncStatus === 'syncing'}
          onPress={() => void handleRefresh()}
          style={({ pressed }) => [
            styles.syncBanner,
            syncStatus === 'offline' || syncStatus === 'widget-error'
              ? styles.syncBannerError
              : null,
            { opacity: pressed ? 0.62 : 1 },
          ]}>
          <SymbolIcon
            name={
              syncStatus === 'ready'
                ? 'checkmark.circle.fill'
                : syncStatus === 'offline' || syncStatus === 'widget-error'
                  ? 'exclamationmark.arrow.triangle.2.circlepath'
                  : 'arrow.triangle.2.circlepath'
            }
            color={
              syncStatus === 'offline' || syncStatus === 'widget-error'
                ? colors.red
                : colors.blue
            }
            size={18}
          />
          <Text selectable numberOfLines={2} style={styles.syncMessage}>
            {syncMessage ?? '正在检查待办与小组件…'}
          </Text>
          <Text style={styles.syncAction}>
            {syncStatus === 'syncing' ? '同步中' : '刷新'}
          </Text>
        </Pressable>
        <View style={styles.widgetFeedback}>
          <View style={styles.widgetFeedbackHeader}>
            <SymbolIcon name="rectangle.on.rectangle" color={widgetStatus === 'error' ? colors.red : colors.blue} size={17} />
            <Text style={styles.widgetFeedbackTitle}>
              {widgetStatus === 'updating' ? '小组件数据更新中' : widgetStatus === 'error' ? '小组件数据写入失败' : widgetUpdatedAt ? '小组件数据已更新' : '桌面小组件'}
            </Text>
          </View>
          <Text style={styles.widgetFeedbackCopy}>
            {widgetError ?? (widgetUpdatedAt
              ? `最近写入 ${new Date(widgetUpdatedAt).toLocaleTimeString('zh-CN', { hour12: false })} · 当前到期 ${syncMetrics.widgetCount} 条。未到时间的待办保留在 App 中，到时间才显示。`
              : '添加、编辑和完成待办后会自动更新小组件数据。')}
          </Text>
          <Text style={styles.widgetFeedbackCopy}>数据写入成功不代表桌面已重绘；实际刷新由 iOS 调度。</Text>
        </View>
        <ReminderStatusCard />
        <ScreenState
          isLoading={isLoading}
          errorMessage={errorMessage}
          onRetry={() => void handleRefresh()}
        />
        {!isLoading && !errorMessage ? (
          <View style={styles.sections}>
            {sectionConfiguration.map((section) => (
              <PlanSection
                key={section.key}
                title={section.title}
                color={section.color}
                tasks={pendingTasks.filter((task) => getDueSection(task.dueAt) === section.key)}
                onEditDate={(id) =>
                  router.push({ pathname: '/add-task', params: { task: String(id) } })
                }
                onToggleCompleted={(id) => void toggleCompleted(id)}
                onToggleStarred={(id) => void toggleStarred(id)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
      <FloatingAddButton />
      <BottomNavigation active="plan" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    gap: 24,
    paddingHorizontal: layout.horizontalPadding,
  },
  title: {
    color: colors.label,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1,
  },
  syncBanner: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: -12,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: colors.blueTint,
  },
  syncBannerError: {
    backgroundColor: '#FCECEF',
  },
  syncMessage: {
    minWidth: 0,
    flex: 1,
    color: colors.secondaryLabel,
    fontSize: 12,
    lineHeight: 17,
  },
  syncAction: {
    color: colors.blue,
    fontSize: 12,
    fontWeight: '700',
  },
  widgetFeedback: {
    gap: 7,
    padding: 14,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: colors.card,
  },
  widgetFeedbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  widgetFeedbackTitle: {
    color: colors.label,
    fontSize: 14,
    fontWeight: '600',
  },
  widgetFeedbackCopy: {
    color: colors.secondaryLabel,
    fontSize: 12,
    lineHeight: 18,
  },
  sections: {
    gap: 30,
  },
  section: {
    gap: 11,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  sectionCount: {
    fontSize: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  sectionCard: {
    overflow: 'hidden',
    borderRadius: 23,
    borderCurve: 'continuous',
    backgroundColor: colors.card,
    boxShadow: '0 2px 13px rgba(34, 42, 60, 0.06)',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 52,
    marginRight: 16,
    backgroundColor: colors.separator,
  },
});
