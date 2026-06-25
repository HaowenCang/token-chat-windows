export function isTauriRuntime(): boolean {
  return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export function isWebRuntime(): boolean {
  return !isTauriRuntime();
}
