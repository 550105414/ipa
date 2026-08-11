import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SymbolIcon } from '@/components/symbol-icon';
import { getDueSection } from '@/lib/date';
import { useTodos } from '@/providers/todo-provider';
import { colors } from '@/theme/colors';

export type AppRoute = 'home' | 'plan' | 'completed';

type BottomNavigationProps = {
  active: AppRoute;
};

const items: { key: AppRoute; label: string; icon: string; activeIcon: string }[] = [
  { key: 'home', label: '工作台', icon: 'square.grid.2x2', activeIcon: 'square.grid.2x2.fill' },
  { key: 'plan', label: '计划', icon: 'calendar', activeIcon: 'calendar' },
  { key: 'completed', label: '已完成', icon: 'checkmark.circle', activeIcon: 'checkmark.circle.fill' },
];

export function BottomNavigation({ active }: BottomNavigationProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tasks } = useTodos();
  const plannedCount = tasks.filter((task) => {
    const section = getDueSection(task.dueAt);
    return !task.completedAt && (section === 'overdue' || section === 'today');
  }).length;

  const navigate = (key: AppRoute) => {
    if (key === 'home') {
      router.replace('/');
    } else if (key === 'plan') {
      router.replace('/plan');
    } else {
      router.replace('/completed');
    }
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View style={[styles.bar, { bottom: Math.max(insets.bottom, 10) }]}>
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <Pressable
              key={item.key}
              accessibilityLabel={item.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              onPress={() => navigate(item.key)}
              style={({ pressed }) => [
                styles.item,
                isActive && styles.activeItem,
                { opacity: pressed ? 0.55 : 1 },
              ]}>
              <View>
                <SymbolIcon
                  name={isActive ? item.activeIcon : item.icon}
                  color={isActive ? colors.blue : '#17171A'}
                  size={24}
                />
                {item.key === 'plan' && plannedCount > 0 ? (
                  <View style={styles.badge}>
                    <Text selectable style={styles.badgeText}>
                      {plannedCount > 9 ? '9+' : plannedCount}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.label, isActive && styles.activeLabel]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    alignSelf: 'center',
    width: 304,
    height: 72,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 36,
    borderCurve: 'continuous',
    padding: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    boxShadow: '0 8px 28px rgba(34, 42, 60, 0.14)',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: 29,
  },
  activeItem: {
    backgroundColor: '#EEF0F7',
  },
  label: {
    color: '#17171A',
    fontSize: 12,
    fontWeight: '500',
  },
  activeLabel: {
    color: colors.blue,
    fontWeight: '700',
  },
  badge: {
    position: 'absolute',
    top: -8,
    right: -11,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingHorizontal: 4,
    backgroundColor: '#F04452',
    borderWidth: 2,
    borderColor: colors.white,
  },
  badgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
});
