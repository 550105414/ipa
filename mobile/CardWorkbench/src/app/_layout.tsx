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
            <Stack.Screen name="index" options={{ title: '工作台' }} />
            <Stack.Screen name="plan" options={{ title: '计划' }} />
            <Stack.Screen name="completed" options={{ title: '已完成' }} />
            <Stack.Screen
              name="today"
              options={{ headerShown: true, title: '今日工作', headerShadowVisible: false }}
            />
            <Stack.Screen
              name="customers"
              options={{ headerShown: true, title: '客户', headerShadowVisible: false }}
            />
            <Stack.Screen
              name="customer/[id]"
              options={{ headerShown: true, title: '客户资料', headerShadowVisible: false }}
            />
            <Stack.Screen
              name="customer/[id]/edit"
              options={{
                headerShown: true,
                title: '编辑客户',
                headerShadowVisible: false,
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="customer/new"
              options={{
                headerShown: true,
                title: '新增客户',
                headerShadowVisible: false,
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="trash"
              options={{ headerShown: true, title: '客户回收站', headerShadowVisible: false }}
            />
            <Stack.Screen
              name="export-data"
              options={{ headerShown: true, title: '导出资料', headerShadowVisible: false }}
            />
            <Stack.Screen
              name="pair"
              options={{ headerShown: true, title: '连接工作台', headerShadowVisible: false }}
            />
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
