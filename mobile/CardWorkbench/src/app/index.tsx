import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/bottom-navigation';
import { CategoryCard } from '@/components/category-card';
import { FloatingAddButton } from '@/components/floating-add-button';
import { ScreenState } from '@/components/screen-state';
import { SymbolIcon } from '@/components/symbol-icon';
import { loadWorkspaceSession } from '@/lib/workspace-api';
import { runDailyWorkspaceBackup } from '@/lib/auto-backup';
import { useTodos } from '@/providers/todo-provider';
import { colors, layout } from '@/theme/colors';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [workspaceConnected, setWorkspaceConnected] = useState<boolean | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
      setWorkspaceConnected(Boolean(await loadWorkspaceSession()));
    } finally {
      setIsRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void loadWorkspaceSession().then((session) => {
        if (active) setWorkspaceConnected(Boolean(session));
        if (session) void runDailyWorkspaceBackup().catch(() => undefined);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const openWorkspace = (path: '/today' | '/customers' | '/customer/new' | '/trash' | '/export-data') => {
    router.push((workspaceConnected ? path : '/pair') as never);
  };

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
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={() => void handleRefresh()} />
        }
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
            工作台
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
              accessibilityLabel="打开客户资料"
              accessibilityRole="button"
              onPress={() => openWorkspace('/customers')}
              style={({ pressed }) => [styles.settingsButton, { opacity: pressed ? 0.55 : 1 }]}>
              <SymbolIcon name="person.crop.rectangle.stack" color={colors.label} size={22} />
            </Pressable>
          </View>
        </View>

        <Text selectable style={styles.subtitle}>
          客户资料与今日待办，一处处理
        </Text>

        <View style={styles.customerPanel}>
          <View style={styles.customerPanelHeader}>
            <View style={styles.customerPanelTitleRow}>
              <View style={styles.workspaceIcon}>
                <SymbolIcon name="person.2.fill" color={colors.white} size={22} />
              </View>
              <View style={styles.customerPanelCopy}>
                <Text selectable style={styles.workspaceTitle}>客户资料</Text>
                <Text selectable style={styles.workspaceSubtitle}>手机与电脑端云端同步</Text>
              </View>
            </View>
            <View style={[styles.syncPill, !workspaceConnected && styles.syncPillPending]}>
              <View style={[styles.syncDot, !workspaceConnected && styles.syncDotPending]} />
              <Text selectable style={[styles.syncText, !workspaceConnected && styles.syncTextPending]}>
                {workspaceConnected === null ? '检查中' : workspaceConnected ? '已连接' : '待绑定'}
              </Text>
            </View>
          </View>

          <View style={styles.customerActions}>
            <CustomerAction
              icon="calendar.badge.clock"
              label="今日工作"
              onPress={() => openWorkspace('/today')}
            />
            <CustomerAction
              icon="person.2"
              label="客户列表"
              onPress={() => openWorkspace('/customers')}
            />
            <CustomerAction
              icon="person.badge.plus"
              label="新增客户"
              onPress={() => openWorkspace('/customer/new')}
            />
            <CustomerAction
              icon="archivebox"
              label="回收站"
              onPress={() => openWorkspace('/trash')}
            />
            <CustomerAction
              icon="square.and.arrow.down"
              label="导出资料"
              onPress={() => openWorkspace('/export-data')}
            />
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

function CustomerAction({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.customerAction, { opacity: pressed ? 0.58 : 1 }]}>
      <View style={styles.customerActionIcon}>
        <SymbolIcon name={icon} color={colors.blue} size={19} />
      </View>
      <Text style={styles.customerActionText}>{label}</Text>
    </Pressable>
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
  subtitle: {
    color: colors.secondaryLabel,
    fontSize: 15,
    lineHeight: 21,
    marginTop: -12,
    marginBottom: 15,
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
  customerPanel: {
    overflow: 'hidden',
    padding: 14,
    marginBottom: 16,
    borderRadius: 24,
    borderCurve: 'continuous',
    backgroundColor: colors.card,
    boxShadow: '0 6px 20px rgba(52, 121, 200, 0.10)',
  },
  customerPanelHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 13,
  },
  customerPanelTitleRow: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  customerPanelCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  workspaceIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: colors.blue,
  },
  workspaceTitle: {
    color: colors.label,
    fontSize: 18,
    fontWeight: '800',
  },
  workspaceSubtitle: {
    color: colors.secondaryLabel,
    fontSize: 12,
    lineHeight: 17,
  },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: '#EDF8F2',
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4FB381',
  },
  syncText: {
    color: '#33845D',
    fontSize: 11,
    fontWeight: '700',
  },
  syncPillPending: {
    backgroundColor: '#FFF3DF',
  },
  syncDotPending: {
    backgroundColor: '#D39032',
  },
  syncTextPending: {
    color: '#A96816',
  },
  customerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    paddingTop: 12,
  },
  customerAction: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    borderRadius: 15,
    borderCurve: 'continuous',
    paddingVertical: 8,
  },
  customerActionIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderCurve: 'continuous',
    backgroundColor: colors.blueTint,
  },
  customerActionText: {
    color: colors.label,
    fontSize: 11,
    fontWeight: '600',
  },
  column: {
    gap: 13,
  },
});
