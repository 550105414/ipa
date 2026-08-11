import { Stack } from 'expo-router/stack';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { migrateDatabase } from '@/lib/database';
import { TodoProvider } from '@/providers/todo-provider';
import { PrivacyGate } from '@/components/privacy-gate';

export default function RootLayout() {
  return (
    <PrivacyGate>
      <SQLiteProvider databaseName="cardworkbench.db" onInit={migrateDatabase}>
        <TodoProvider>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F6F5FB' } }}>
            <Stack.Screen name="index" options={{ title: 'MarkTodo' }} />
            <Stack.Screen name="plan" options={{ title: '计划' }} />
            <Stack.Screen name="completed" options={{ title: '已完成' }} />
            <Stack.Screen name="workspace" options={{ title: '客户工作台' }} />
            <Stack.Screen
              name="add-task"
              options={{
                title: '新增待办',
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
          </Stack>
          <StatusBar style="dark" />
        </TodoProvider>
      </SQLiteProvider>
    </PrivacyGate>
  );
}
