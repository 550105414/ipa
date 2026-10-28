import { requireNativeModule } from 'expo';

export type CardWorkbenchWidgetNativeModule = {
  updateSnapshot(snapshotJson: string): Promise<void>;
  canScheduleExactAlarms(): boolean;
  openExactAlarmSettings(): boolean;
};

// Android-only module. Import through the .android.tsx widget adapter.
export default requireNativeModule<CardWorkbenchWidgetNativeModule>('CardWorkbenchWidget');
