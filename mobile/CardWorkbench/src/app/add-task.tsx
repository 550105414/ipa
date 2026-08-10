import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SymbolIcon } from '@/components/symbol-icon';
import { dateKeyFromNow } from '@/lib/date';
import { useTodos } from '@/providers/todo-provider';
import { colors, layout } from '@/theme/colors';

type DuePreset = {
  id: string;
  label: string;
  offset: number | null;
};

const duePresets: DuePreset[] = [
  { id: 'none', label: '不设日期', offset: null },
  { id: 'today', label: '今天', offset: 0 },
  { id: 'tomorrow', label: '明天', offset: 1 },
  { id: 'week', label: '一周后', offset: 7 },
];

export default function AddTaskScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ category?: string | string[] }>();
  const { categories, addTask } = useTodos();
  const requestedCategory = Array.isArray(params.category) ? params.category[0] : params.category;
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [categoryId, setCategoryId] = useState(requestedCategory ?? '');
  const [selectedDuePreset, setSelectedDuePreset] = useState('none');
  const [isStarred, setIsStarred] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (categories[0] && !categories.some((category) => category.id === categoryId)) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  const dueAt = useMemo(() => {
    const preset = duePresets.find((item) => item.id === selectedDuePreset);
    return preset?.offset === null || preset?.offset === undefined
      ? null
      : dateKeyFromNow(preset.offset);
  }, [selectedDuePreset]);

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('还差一点', '请先填写待办标题。');
      return;
    }
    if (!categoryId) {
      Alert.alert('还差一点', '请选择一个分组。');
      return;
    }

    setIsSaving(true);
    try {
      await addTask({
        title,
        notes,
        categoryId,
        dueAt,
        isStarred,
      });
      router.back();
    } catch (error) {
      Alert.alert('保存失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 14, paddingBottom: Math.max(insets.bottom, 16) + 32 },
        ]}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.55 : 1 }]}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
          <Text selectable style={styles.headerTitle}>
            新增待办
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isSaving}
            onPress={() => void handleSave()}
            style={({ pressed }) => [styles.headerButton, { opacity: pressed || isSaving ? 0.5 : 1 }]}>
            <Text style={styles.saveText}>{isSaving ? '保存中' : '保存'}</Text>
          </Pressable>
        </View>

        <View style={styles.formCard}>
          <TextInput
            accessibilityLabel="待办标题"
            autoFocus
            maxLength={80}
            onChangeText={setTitle}
            placeholder="要做什么？"
            placeholderTextColor="#A1A1A8"
            returnKeyType="next"
            selectionColor={colors.blue}
            style={styles.titleInput}
            value={title}
          />
          <View style={styles.inputSeparator} />
          <TextInput
            accessibilityLabel="备注"
            maxLength={240}
            multiline
            onChangeText={setNotes}
            placeholder="添加备注（可选）"
            placeholderTextColor="#A1A1A8"
            selectionColor={colors.blue}
            style={styles.notesInput}
            textAlignVertical="top"
            value={notes}
          />
        </View>

        <View style={styles.formSection}>
          <Text selectable style={styles.sectionTitle}>
            分组
          </Text>
          <View style={styles.categoryGrid}>
            {categories.map((category) => {
              const selected = categoryId === category.id;
              return (
                <Pressable
                  key={category.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setCategoryId(category.id)}
                  style={({ pressed }) => [
                    styles.categoryChip,
                    {
                      borderColor: selected ? category.color : 'transparent',
                      backgroundColor: category.tint,
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}>
                  <SymbolIcon name={category.icon} color={category.color} size={18} />
                  <Text style={[styles.categoryText, { color: category.color }]}>{category.name}</Text>
                  {selected ? (
                    <SymbolIcon name="checkmark.circle.fill" color={category.color} size={17} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.formSection}>
          <Text selectable style={styles.sectionTitle}>
            日期
          </Text>
          <View style={styles.dueGrid}>
            {duePresets.map((preset) => {
              const selected = selectedDuePreset === preset.id;
              return (
                <Pressable
                  key={preset.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setSelectedDuePreset(preset.id)}
                  style={({ pressed }) => [
                    styles.dueChip,
                    selected && styles.selectedDueChip,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}>
                  <SymbolIcon
                    name={preset.offset === null ? 'calendar.badge.minus' : 'calendar'}
                    color={selected ? colors.blue : colors.secondaryLabel}
                    size={16}
                  />
                  <Text style={[styles.dueText, selected && styles.selectedDueText]}>
                    {preset.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.starCard}>
          <View style={styles.starDescription}>
            <View style={styles.starIcon}>
              <SymbolIcon name="star.fill" color={colors.orange} size={19} />
            </View>
            <View style={styles.starCopy}>
              <Text selectable style={styles.starTitle}>
                加入星标
              </Text>
              <Text selectable style={styles.starSubtitle}>
                在卡片工作台中优先显示
              </Text>
            </View>
          </View>
          <Switch
            accessibilityLabel="加入星标"
            onValueChange={setIsStarred}
            trackColor={{ false: '#D4D4D9', true: colors.blue }}
            value={isStarred}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={isSaving}
          onPress={() => void handleSave()}
          style={({ pressed }) => [
            styles.primaryButton,
            { opacity: pressed || isSaving ? 0.65 : 1 },
          ]}>
          <SymbolIcon name="plus" color={colors.white} size={18} />
          <Text style={styles.primaryButtonText}>{isSaving ? '正在保存…' : '添加待办'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
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
  header: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: {
    minWidth: 64,
    minHeight: 44,
    justifyContent: 'center',
  },
  cancelText: {
    color: colors.secondaryLabel,
    fontSize: 16,
    fontWeight: '500',
  },
  saveText: {
    color: colors.blue,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  headerTitle: {
    color: colors.label,
    fontSize: 18,
    fontWeight: '800',
  },
  formCard: {
    overflow: 'hidden',
    borderRadius: 22,
    borderCurve: 'continuous',
    backgroundColor: colors.card,
    boxShadow: '0 2px 12px rgba(34, 42, 60, 0.05)',
  },
  titleInput: {
    minHeight: 64,
    paddingHorizontal: 18,
    color: colors.label,
    fontSize: 20,
    fontWeight: '600',
  },
  inputSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 18,
    backgroundColor: colors.separator,
  },
  notesInput: {
    minHeight: 100,
    padding: 18,
    color: colors.label,
    fontSize: 15,
    lineHeight: 21,
  },
  formSection: {
    gap: 11,
  },
  sectionTitle: {
    color: colors.secondaryLabel,
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 5,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  categoryChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 15,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    paddingHorizontal: 12,
  },
  categoryText: {
    fontSize: 14,
    fontWeight: '700',
  },
  dueGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  dueChip: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingHorizontal: 12,
    backgroundColor: colors.card,
  },
  selectedDueChip: {
    borderColor: colors.blue,
    backgroundColor: colors.blueTint,
  },
  dueText: {
    color: colors.secondaryLabel,
    fontSize: 14,
    fontWeight: '600',
  },
  selectedDueText: {
    color: colors.blue,
  },
  starCard: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderRadius: 20,
    borderCurve: 'continuous',
    paddingHorizontal: 16,
    backgroundColor: colors.card,
  },
  starDescription: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  starIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#FFF3DE',
  },
  starCopy: {
    flex: 1,
    gap: 2,
  },
  starTitle: {
    color: colors.label,
    fontSize: 16,
    fontWeight: '700',
  },
  starSubtitle: {
    color: colors.secondaryLabel,
    fontSize: 12,
  },
  primaryButton: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: colors.blue,
    boxShadow: '0 7px 18px rgba(52, 121, 200, 0.24)',
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '800',
  },
});
