import type { SettingsStorage } from './settings-state';

export const promptScopes = ['global', 'conversation', 'model'] as const;

export type PromptScope = typeof promptScopes[number];

export interface LibraryPrompt {
  name: string;
  prompt: string;
  scope: PromptScope;
}

const PROMPT_LIBRARY_KEY = 'tc-custom-prompts';

function normalizeScope(value: unknown): PromptScope {
  return promptScopes.includes(value as PromptScope) ? value as PromptScope : 'global';
}

function normalizePrompt(value: unknown): LibraryPrompt | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<LibraryPrompt>;
  return {
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : 'Untitled',
    prompt: typeof candidate.prompt === 'string' ? candidate.prompt : '',
    scope: normalizeScope(candidate.scope),
  };
}

export class PromptLibraryModel {
  constructor(private readonly storage: SettingsStorage) {}

  list(): LibraryPrompt[] {
    try {
      const parsed = JSON.parse(this.storage.getItem(PROMPT_LIBRARY_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap(item => {
        const prompt = normalizePrompt(item);
        return prompt ? [prompt] : [];
      });
    } catch {
      return [];
    }
  }

  add(prompt: LibraryPrompt): LibraryPrompt[] {
    return this.persist([...this.list(), normalizePrompt(prompt)!]);
  }

  update(index: number, prompt: LibraryPrompt): LibraryPrompt[] {
    const prompts = this.list();
    if (!Number.isInteger(index) || index < 0 || index >= prompts.length) return prompts;
    prompts[index] = normalizePrompt(prompt)!;
    return this.persist(prompts);
  }

  remove(index: number): LibraryPrompt[] {
    const prompts = this.list();
    if (!Number.isInteger(index) || index < 0 || index >= prompts.length) return prompts;
    prompts.splice(index, 1);
    return this.persist(prompts);
  }

  private persist(prompts: LibraryPrompt[]): LibraryPrompt[] {
    this.storage.setItem(PROMPT_LIBRARY_KEY, JSON.stringify(prompts));
    return prompts.map(prompt => ({ ...prompt }));
  }
}
