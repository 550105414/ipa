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
  TodoWidgetTask,
  WidgetSyncTask,
} from '@/widgets/widget-types';

const DEFAULT_ACCENT = '#3B78B9';

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
          <Image systemName="checkmark.circle" size={24} color="#66B98A" />
          <Text
            modifiers={[
              font({ size: 13, weight: 'medium' }),
              foregroundStyle('#8A8D94'),
            ]}>
            暂无待办
          </Text>
        </VStack>
      ) : (
        visibleTasks.map((task) => <TaskRow key={task.id} task={task} />)
      )}
    </VStack>
  );
}

export const TodoWidget = createWidget<TodoWidgetSnapshot>('TodoWidget', TodoWidgetView);

export function syncTodoWidget(tasks: WidgetSyncTask[]): void {
  const activeTasks = tasks.filter(
    (task) => !task.completedAt && task.isCompleted !== true,
  );

  TodoWidget.updateSnapshot({
    total: activeTasks.length,
    tasks: activeTasks.slice(0, 8).map((task) => ({
      id: task.id,
      title: task.title,
      accent: task.color || DEFAULT_ACCENT,
      starred: task.isStarred === true || task.starred === true,
      dueLabel: task.dueLabel,
    })),
    updatedAt: new Date().toISOString(),
  });
}
