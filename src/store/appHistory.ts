import { useTailWagStore } from './useTailWagStore';
import { installHistory } from './undoHistory';

/** The one undo/redo history for the app's store. */
export const appHistory = installHistory(useTailWagStore);

// Avoid stacking subscriptions when the dev server hot-reloads this module.
const hot = (import.meta as unknown as { hot?: { dispose: (cb: () => void) => void } }).hot;
hot?.dispose(() => appHistory.dispose());