import { invoke } from '@tauri-apps/api/core';

export function getBuiltinPrompt(): Promise<string> {
  return invoke<string>('get_builtin_prompt');
}
