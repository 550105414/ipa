// Re-export the native module. On web, it will be resolved to CardWorkbenchWidgetSnapshotModule.web.ts
// and on native platforms to CardWorkbenchWidgetSnapshotModule.ts
export { default } from './src/CardWorkbenchWidgetSnapshotModule';
export * from './src/CardWorkbenchWidgetSnapshot.types';
