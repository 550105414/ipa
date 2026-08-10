import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import { TaskRow } from '@/components/task-row';
import { colors } from '@/theme/colors';
import type { TodoCategory, TodoTask } from '@/types/todo';

type CategoryCardProps = {
  category: TodoCategory;
  tasks: TodoTask[];
  completedCount: number;
  onToggleCompleted: (id: number) => void;
  onToggleStarred: (id: number) => void;
};

export function CategoryCard({
  category,
  tasks,
  completedCount,
  onToggleCompleted,
  onToggleStarred,
}: CategoryCardProps) {
  const router = useRouter();
  const totalCount = tasks.length + completedCount;

  return (
    <View style={styles.card}>
      <View style={[styles.header, { backgroundColor: category.color }]}>
        <View style={styles.headerTitle}>
          <SymbolIcon name={category.icon} color={colors.white} size={18} />
          <Text selectable numberOfLines={1} style={styles.categoryName}>
            {category.name}
          </Text>
        </View>
        <View style={styles.progressRow}>
          <Text selectable style={styles.progressText}>
            {tasks.length}/{totalCount || tasks.length}
          </Text>
          <SymbolIcon name="chevron.right" color={colors.white} size={12} />
        </View>
      </View>

      <View style={styles.taskList}>
        {tasks.slice(0, 4).map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            compact
            onToggleCompleted={onToggleCompleted}
            onToggleStarred={onToggleStarred}
          />
        ))}
        {tasks.length === 0 ? (
          <Text selectable style={styles.emptyText}>
            暂无待办
          </Text>
        ) : null}
      </View>

      <Pressable
        accessibilityLabel={`在${category.name}中添加待办`}
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/add-task', params: { category: category.id } })}
        style={({ pressed }) => [
          styles.addButton,
          { backgroundColor: category.tint, opacity: pressed ? 0.62 : 1 },
        ]}>
        <SymbolIcon name="plus" color={category.color} size={14} />
        <Text style={[styles.addText, { color: category.color }]}>添加待办</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderRadius: 17,
    borderCurve: 'continuous',
    backgroundColor: colors.card,
    boxShadow: '0 2px 10px rgba(34, 42, 60, 0.07)',
  },
  header: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 5,
    paddingHorizontal: 11,
  },
  headerTitle: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  categoryName: {
    flexShrink: 1,
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  progressText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  taskList: {
    paddingTop: 2,
  },
  emptyText: {
    color: colors.tertiaryLabel,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 18,
    textAlign: 'center',
  },
  addButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderCurve: 'continuous',
    marginHorizontal: 9,
    marginBottom: 10,
  },
  addText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
