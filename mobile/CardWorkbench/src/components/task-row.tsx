import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import { formatCompletedDate, formatDueDate } from '@/lib/date';
import { colors } from '@/theme/colors';
import type { TodoTask } from '@/types/todo';

type TaskRowProps = {
  task: TodoTask;
  compact?: boolean;
  showCategory?: boolean;
  showCompletedDate?: boolean;
  onToggleCompleted: (id: number) => void;
  onToggleStarred: (id: number) => void;
};

export function TaskRow({
  task,
  compact = false,
  showCategory = false,
  showCompletedDate = false,
  onToggleCompleted,
  onToggleStarred,
}: TaskRowProps) {
  const isCompleted = Boolean(task.completedAt);
  const dueLabel = formatDueDate(task.dueAt);

  return (
    <View style={[styles.row, compact ? styles.compactRow : styles.regularRow]}>
      <Pressable
        accessibilityLabel={isCompleted ? `恢复待办：${task.title}` : `完成待办：${task.title}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isCompleted }}
        hitSlop={8}
        onPress={() => onToggleCompleted(task.id)}
        style={({ pressed }) => [
          styles.checkButton,
          {
            borderColor: isCompleted ? '#D8D8DE' : task.categoryColor,
            backgroundColor: isCompleted ? '#E7E7EC' : 'transparent',
            opacity: pressed ? 0.55 : 1,
          },
        ]}>
        {isCompleted ? <SymbolIcon name="checkmark" color={colors.white} size={11} /> : null}
      </Pressable>

      <View style={styles.content}>
        {showCompletedDate ? (
          <Text selectable style={styles.completedDate}>
            {formatCompletedDate(task.completedAt)}
          </Text>
        ) : null}
        <Text
          selectable
          numberOfLines={compact ? 2 : 1}
          style={[styles.title, compact && styles.compactTitle, isCompleted && styles.completedTitle]}>
          {task.title}
        </Text>
        {task.notes ? (
          <Text selectable numberOfLines={1} style={styles.notes}>
            {task.notes}
          </Text>
        ) : null}
        {dueLabel || task.label ? (
          <View style={styles.metadataRow}>
            {dueLabel ? (
              <View style={styles.dueRow}>
                <SymbolIcon name="calendar" color={task.categoryColor} size={12} />
                <Text selectable style={[styles.dueText, { color: task.categoryColor }]}>
                  {dueLabel}
                </Text>
              </View>
            ) : null}
            {task.label ? (
              <Text selectable style={[styles.label, { color: task.categoryColor, backgroundColor: task.categoryTint }]}>
                {task.label}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.trailing}>
        <Pressable
          accessibilityLabel={task.isStarred ? `取消星标：${task.title}` : `添加星标：${task.title}`}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => onToggleStarred(task.id)}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 2 })}>
          <SymbolIcon
            name={task.isStarred ? 'star.fill' : 'star'}
            color={task.isStarred ? task.categoryColor : '#B9B9BF'}
            size={compact ? 18 : 24}
          />
        </Pressable>
        {showCategory ? (
          <Text selectable numberOfLines={1} style={styles.categoryName}>
            {task.categoryName}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compactRow: {
    minHeight: 49,
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  regularRow: {
    minHeight: 78,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  checkButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.label,
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 23,
  },
  compactTitle: {
    fontSize: 14.5,
    lineHeight: 19,
  },
  completedTitle: {
    color: '#5D5D64',
  },
  notes: {
    color: colors.tertiaryLabel,
    fontSize: 13,
    lineHeight: 18,
  },
  completedDate: {
    color: '#898990',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
    fontVariant: ['tabular-nums'],
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    paddingTop: 2,
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  dueText: {
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  label: {
    overflow: 'hidden',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 11,
  },
  trailing: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  categoryName: {
    maxWidth: 58,
    color: colors.tertiaryLabel,
    fontSize: 12,
  },
});
