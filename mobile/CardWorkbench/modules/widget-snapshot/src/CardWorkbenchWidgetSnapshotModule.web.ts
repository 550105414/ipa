import { registerWebModule, NativeModule } from 'expo';

// CardWorkbenchWidgetSnapshotModule is not available on the web platform.
class CardWorkbenchWidgetSnapshotModule extends NativeModule<{}> {}

export default registerWebModule(CardWorkbenchWidgetSnapshotModule, 'CardWorkbenchWidgetSnapshotModule');
