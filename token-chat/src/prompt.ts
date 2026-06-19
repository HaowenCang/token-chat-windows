import { invoke } from '@tauri-apps/api/core';

const isDev = !(window as any).__TAURI_INTERNALS__;
let builtinPrompt: string | null = null;

export async function loadBuiltinPrompt(): Promise<void> {
  if (builtinPrompt !== null) return;
  if (isDev) {
    builtinPrompt = '';
    return;
  }
  try {
    builtinPrompt = await invoke<string>('get_builtin_prompt');
  } catch {
    builtinPrompt = '';
  }
}

export function getBuiltinPromptSnapshot(): string {
  return builtinPrompt ?? '';
}

export function getEffectiveSystemPrompt(): string {
  const custom = localStorage.getItem('tc-global-prompt');
  if (custom !== null && custom.trim()) return custom;
  return getBuiltinPromptSnapshot();
}
