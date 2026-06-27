import { describe, expect, it } from 'vitest';
import { PromptLibraryModel } from '../src/prompt-library-model';
import type { SettingsStorage } from '../src/settings-state';

class MemoryStorage implements SettingsStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('prompt library model', () => {
  it('recovers from invalid storage and normalizes saved entries', () => {
    const storage = new MemoryStorage();
    storage.setItem('tc-custom-prompts', '{broken');
    const library = new PromptLibraryModel(storage);
    expect(library.list()).toEqual([]);

    storage.setItem('tc-custom-prompts', JSON.stringify([
      { name: '', prompt: 12, scope: 'invalid' },
      null,
      { name: 'Review', prompt: 'Be precise', scope: 'model' },
    ]));
    expect(library.list()).toEqual([
      { name: 'Untitled', prompt: '', scope: 'global' },
      { name: 'Review', prompt: 'Be precise', scope: 'model' },
    ]);
  });

  it('owns add, update, and remove persistence', () => {
    const library = new PromptLibraryModel(new MemoryStorage());
    library.add({ name: 'Draft', prompt: '', scope: 'global' });
    library.update(0, { name: 'Writer', prompt: 'Write clearly', scope: 'conversation' });
    library.add({ name: 'Reviewer', prompt: 'Find risks', scope: 'model' });

    expect(library.list()).toEqual([
      { name: 'Writer', prompt: 'Write clearly', scope: 'conversation' },
      { name: 'Reviewer', prompt: 'Find risks', scope: 'model' },
    ]);
    expect(library.remove(0)).toEqual([
      { name: 'Reviewer', prompt: 'Find risks', scope: 'model' },
    ]);
    expect(library.remove(99)).toEqual(library.list());
  });
});
