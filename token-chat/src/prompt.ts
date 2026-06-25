import { getBuiltinPrompt } from './ipc/prompt-ipc';
import { isWebRuntime } from './platform/runtime';

const isDev = isWebRuntime();
let builtinPrompt: string | null = null;

export async function loadBuiltinPrompt(): Promise<void> {
  if (builtinPrompt !== null) return;
  if (isDev) {
    builtinPrompt = '';
    return;
  }
  try {
    builtinPrompt = await getBuiltinPrompt();
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
