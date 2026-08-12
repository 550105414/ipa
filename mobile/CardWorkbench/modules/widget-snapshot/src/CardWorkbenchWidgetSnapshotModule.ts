import { NativeModule, requireNativeModule } from 'expo';

export type WidgetSnapshotWriteResult = {
  updatedAt: string;
  taskCount: number;
  byteCount: number;
};

declare class CardWorkbenchWidgetSnapshotModule extends NativeModule<Record<string, never>> {
  writeSnapshotAsync(snapshotJSON: string): Promise<WidgetSnapshotWriteResult>;
  readSnapshotAsync(): Promise<string | null>;
  reload(): void;
}

export default requireNativeModule<CardWorkbenchWidgetSnapshotModule>('CardWorkbenchWidgetSnapshot');
