export function createSpeechAdapter(
  invoke: (...args: any[]) => Promise<any>,
  addPluginListener: (plugin: string, event: string, callback: (payload: any) => void) => Promise<{ unregister(): Promise<void> }>
): unknown;
