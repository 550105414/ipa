import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/bottom-navigation';
import { FloatingAddButton } from '@/components/floating-add-button';
import { ScreenState } from '@/components/screen-state';
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
  const { tasks, isLoading, errorMessage, refresh, toggleCompleted, toggleStarred } = useTodos();
  const pendingTasks = tasks.filter((task) => !task.completedAt);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
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
        <ScreenState
          isLoading={isLoading}
          errorMessage={errorMessage}
          onRetry={() => void refresh()}
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
