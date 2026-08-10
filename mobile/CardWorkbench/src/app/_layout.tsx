import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { migrateDatabase } from '@/lib/database';

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="cardworkbench.db" onInit={migrateDatabase}>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="dark" />
    </SQLiteProvider>
  );
}
