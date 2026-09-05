import { request } from './base';

/** Online EN→VI dictionary lookup (server proxies a translation-memory API). */
export const vocabularyApi = {
  translate: (words: string[]) =>
    request<{ translations: Record<string, string | null> }>(`/api/vocabulary/translate?words=${encodeURIComponent(words.join(','))}`)
};
