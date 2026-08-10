import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/bottom-navigation';
import { CategoryCard } from '@/components/category-card';
import { FloatingAddButton } from '@/components/floating-add-button';
import { ScreenState } from '@/components/screen-state';
import { SymbolIcon } from '@/components/symbol-icon';
import { useTodos } from '@/providers/todo-provider';
import { colors, layout } from '@/theme/colors';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const {
    categories,
    tasks,
    isLoading,
    errorMessage,
    refresh,
    toggleCompleted,
    toggleStarred,
  } = useTodos();

  const availableWidth = Math.min(width, 520) - layout.horizontalPadding * 2;
  const columnGap = 12;
  const columnWidth = (availableWidth - columnGap) / 2;
  const leftCategories = categories.filter((_, index) => index % 2 === 0);
  const rightCategories = categories.filter((_, index) => index % 2 === 1);

  const renderColumn = (columnCategories: typeof categories) => (
    <View style={[styles.column, { width: columnWidth }]}>
      {columnCategories.map((category) => {
        const categoryTasks = tasks.filter(
          (task) => task.categoryId === category.id && !task.completedAt,
        );
        const completedCount = tasks.filter(
          (task) => task.categoryId === category.id && Boolean(task.completedAt),
        ).length;
        return (
          <CategoryCard
            key={category.id}
            category={category}
            tasks={categoryTasks}
            completedCount={completedCount}
            onToggleCompleted={(id) => void toggleCompleted(id)}
            onToggleStarred={(id) => void toggleStarred(id)}
          />
        );
      })}
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 16,
            paddingBottom: Math.max(insets.bottom, 12) + layout.bottomContentInset,
          },
        ]}>
        <View style={styles.header}>
          <Text selectable style={styles.title}>
            MarkTodo
          </Text>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel="查看计划"
              accessibilityRole="button"
              onPress={() => router.push('/plan')}
              style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.55 : 1 }]}>
              <SymbolIcon name="list.bullet.rectangle" color={colors.label} size={22} />
            </Pressable>
            <Pressable
              accessibilityLabel="新增待办"
              accessibilityRole="button"
              onPress={() => router.push('/add-task')}
              style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.55 : 1 }]}>
              <SymbolIcon name="plus.square.on.square" color={colors.label} size={22} />
            </Pressable>
            <Pressable
              accessibilityLabel="数据说明"
              accessibilityRole="button"
              onPress={() => Alert.alert('个人工作台', '待办数据保存在本机，可在桌面小组件中查看。')}
              style={({ pressed }) => [styles.settingsButton, { opacity: pressed ? 0.55 : 1 }]}>
              <SymbolIcon name="gearshape" color={colors.label} size={22} />
            </Pressable>
          </View>
        </View>

        <ScreenState
          isLoading={isLoading}
          errorMessage={errorMessage}
          onRetry={() => void refresh()}
        />

        {!isLoading && !errorMessage ? (
          <View style={[styles.board, { gap: columnGap }]}>
            {renderColumn(leftCategories)}
            {renderColumn(rightCategories)}
          </View>
        ) : null}
      </ScrollView>
      <FloatingAddButton />
      <BottomNavigation active="home" />
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
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: layout.horizontalPadding,
  },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 15,
  },
  title: {
    flexShrink: 1,
    color: colors.label,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -1.1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  actionButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: colors.card,
  },
  settingsButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: colors.card,
  },
  board: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  column: {
    gap: 13,
  },
});
