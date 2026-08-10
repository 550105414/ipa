import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/bottom-navigation';
import { ScreenState } from '@/components/screen-state';
import { SymbolIcon } from '@/components/symbol-icon';
import { TaskRow } from '@/components/task-row';
import { useTodos } from '@/providers/todo-provider';
import { colors, layout } from '@/theme/colors';

export default function CompletedScreen() {
  const insets = useSafeAreaInsets();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const { categories, tasks, isLoading, errorMessage, refresh, toggleCompleted, toggleStarred } =
    useTodos();
  const completedTasks = tasks.filter(
    (task) => Boolean(task.completedAt) && (selectedCategory === 'all' || task.categoryId === selectedCategory),
  ).sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''));

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
        <View style={styles.header}>
          <Text selectable style={styles.title}>
            已完成
          </Text>
          <View style={styles.yearPill}>
            <Text selectable style={styles.yearText}>
              {new Date().getFullYear()} 年
            </Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: selectedCategory === 'all' }}
            onPress={() => setSelectedCategory('all')}
            style={({ pressed }) => [
              styles.filterChip,
              selectedCategory === 'all' && styles.activeAllChip,
              { opacity: pressed ? 0.6 : 1 },
            ]}>
            <SymbolIcon name="list.bullet" color={colors.blue} size={15} />
            <Text style={[styles.filterText, { color: colors.blue }]}>全部</Text>
          </Pressable>
          {categories.map((category) => {
            const isSelected = selectedCategory === category.id;
            return (
              <Pressable
                key={category.id}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => setSelectedCategory(category.id)}
                style={({ pressed }) => [
                  styles.filterChip,
                  {
                    backgroundColor: category.tint,
                    borderColor: isSelected ? category.color : 'transparent',
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}>
                <SymbolIcon name={category.icon} color={category.color} size={15} />
                <Text style={[styles.filterText, { color: category.color }]}>{category.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScreenState
          isLoading={isLoading}
          errorMessage={errorMessage}
          onRetry={() => void refresh()}
        />

        {!isLoading && !errorMessage ? (
          <View style={styles.listSection}>
            <View style={styles.listHeader}>
              <Text selectable style={styles.listHeaderText}>
                已完成
              </Text>
              <Text selectable style={styles.listHeaderText}>
                {completedTasks.length}
              </Text>
            </View>
            {completedTasks.length > 0 ? (
              <View style={styles.card}>
                {completedTasks.map((task, index) => (
                  <View key={task.id}>
                    {index > 0 ? <View style={styles.separator} /> : null}
                    <TaskRow
                      task={task}
                      showCategory
                      showCompletedDate
                      onToggleCompleted={(id) => void toggleCompleted(id)}
                      onToggleStarred={(id) => void toggleStarred(id)}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <SymbolIcon name="checkmark.circle" color={colors.tertiaryLabel} size={34} />
                <Text selectable style={styles.emptyText}>
                  这个分类还没有已完成的待办
                </Text>
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>
      <BottomNavigation active="completed" />
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
    gap: 21,
    paddingHorizontal: layout.horizontalPadding,
  },
  header: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  title: {
    color: colors.label,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1,
  },
  yearPill: {
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: colors.card,
    boxShadow: '0 2px 8px rgba(34, 42, 60, 0.05)',
  },
  yearText: {
    color: colors.label,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  filters: {
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingHorizontal: 12,
  },
  activeAllChip: {
    borderColor: colors.blue,
    backgroundColor: colors.blueTint,
  },
  filterText: {
    fontSize: 14,
    fontWeight: '700',
  },
  listSection: {
    gap: 10,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  listHeaderText: {
    color: colors.secondaryLabel,
    fontSize: 17,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  card: {
    overflow: 'hidden',
    borderRadius: 24,
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
  emptyCard: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderRadius: 24,
    borderCurve: 'continuous',
    backgroundColor: colors.card,
  },
  emptyText: {
    color: colors.secondaryLabel,
    fontSize: 14,
  },
});
