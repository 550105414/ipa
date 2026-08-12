import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  background,
  cornerRadius,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type {
  TodoWidgetSnapshot,
  TodoWidgetSyncResult,
  TodoWidgetSyncState,
  TodoWidgetTask,
  WidgetSyncTask,
} from '@/widgets/widget-types';

const DEFAULT_ACCENT = '#3B78B9';
const DEFERRED_RELOAD_DELAY_MS = 450;
const VERIFY_RETRY_DELAYS_MS = [80, 180, 360] as const;
let deferredReload: ReturnType<typeof setTimeout> | null = null;

function TaskRow({ task }: { task: TodoWidgetTask }) {
  'widget';

  return (
    <HStack spacing={7}>
      <Image systemName="circle" size={15} color={task.accent || DEFAULT_ACCENT} />
      <VStack
        alignment="leading"
        spacing={1}
        modifiers={[frame({ maxWidth: 240, alignment: 'leading' })]}>
        <Text
          modifiers={[
            font({ size: 14, weight: 'medium' }),
            foregroundStyle('#16181D'),
            lineLimit(1),
          ]}>
          {task.title}
        </Text>
        {task.dueLabel ? (
          <HStack spacing={3}>
            <Image systemName="calendar" size={9} color={task.accent || DEFAULT_ACCENT} />
            <Text
              modifiers={[
                font({ size: 10, weight: 'medium' }),
                foregroundStyle(task.accent || DEFAULT_ACCENT),
                lineLimit(1),
              ]}>
              {task.dueLabel}
            </Text>
          </HStack>
        ) : null}
      </VStack>
      <Spacer minLength={2} />
      <Image
        systemName={task.starred ? 'star.fill' : 'star'}
        size={14}
        color={task.starred ? '#FF962E' : '#B8BBC2'}
      />
    </HStack>
  );
}

function TodoWidgetView(props: TodoWidgetSnapshot, environment: WidgetEnvironment) {
  'widget';

  const visibleTasks = props.tasks.slice(
    0,
    environment.widgetFamily === 'systemSmall' ? 3 : 5,
  );
  const emptyMessage =
    props.syncState === 'unpaired'
      ? '打开工作台完成连接'
      : props.syncState === 'error'
        ? '同步失败，打开工作台重试'
        : '暂无待办';

  return (
    <VStack
      alignment="leading"
      spacing={7}
      modifiers={[
        padding({ all: 12 }),
        background('#FFFFFF'),
        widgetURL('cardworkbench://plan'),
      ]}>
      <HStack spacing={7}>
        <Image systemName="list.bullet.rectangle" size={17} color={DEFAULT_ACCENT} />
        <Text
          modifiers={[
            font({ size: 17, weight: 'bold' }),
            foregroundStyle(DEFAULT_ACCENT),
          ]}>
          全部
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({ size: 13, weight: 'bold' }),
            foregroundStyle('#17181B'),
            padding({ horizontal: 9, vertical: 4 }),
            background('#F1F1F3'),
            cornerRadius(13),
          ]}>
          {String(props.total)}
        </Text>
      </HStack>

      {visibleTasks.length === 0 ? (
        <VStack
          alignment="center"
          spacing={6}
          modifiers={[frame({ maxWidth: 300, maxHeight: 110, alignment: 'center' })]}>
          <Image
            systemName={props.syncState === 'ready' ? 'checkmark.circle' : 'arrow.triangle.2.circlepath'}
            size={24}
            color={props.syncState === 'ready' ? '#66B98A' : DEFAULT_ACCENT}
          />
          <Text
            modifiers={[
              font({ size: 13, weight: 'medium' }),
              foregroundStyle('#8A8D94'),
            ]}>
            {emptyMessage}
          </Text>
        </VStack>
      ) : (
        visibleTasks.map((task) => <TaskRow key={task.id} task={task} />)
      )}
    </VStack>
  );
}

export const TodoWidget = createWidget<TodoWidgetSnapshot>('TodoWidget', TodoWidgetView);

export async function syncTodoWidget(
  tasks: WidgetSyncTask[],
  syncState: TodoWidgetSyncState = 'ready',
): Promise<TodoWidgetSyncResult> {
  const activeTasks = tasks.filter(
    (task) => !task.completedAt && task.isCompleted !== true,
  );
  const snapshot: TodoWidgetSnapshot = {
    total: activeTasks.length,
    tasks: activeTasks.slice(0, 8).map((task) => {
      const dueLabel = task.dueLabel?.trim();
      const color = task.color ?? '';
      return {
        id: String(task.id),
        title: task.title.trim() || '未命名待办',
        accent: /^#[0-9A-F]{6}$/i.test(color) ? color : DEFAULT_ACCENT,
        starred: task.isStarred === true || task.starred === true,
        ...(dueLabel ? { dueLabel } : {}),
      };
    }),
    updatedAt: new Date().toISOString(),
    syncState,
  };

  let verified = false;
  let lastError: unknown;
  for (const delayMs of VERIFY_RETRY_DELAYS_MS) {
    try {
      TodoWidget.updateSnapshot(snapshot);
      TodoWidget.reload();
      await delay(delayMs);
      const timeline = await TodoWidget.getTimeline();
      verified = timeline.some(
        (entry) =>
          entry.props.updatedAt === snapshot.updatedAt &&
          entry.props.total === snapshot.total &&
          entry.props.tasks.length === snapshot.tasks.length,
      );
      if (verified) break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!verified) {
    throw lastError instanceof Error
      ? lastError
      : new Error('小组件数据写入后无法读取，请重新打开工作台重试。');
  }

  if (deferredReload) clearTimeout(deferredReload);
  deferredReload = setTimeout(() => {
    deferredReload = null;
    TodoWidget.reload();
  }, DEFERRED_RELOAD_DELAY_MS);

  return { total: snapshot.total, updatedAt: snapshot.updatedAt };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
