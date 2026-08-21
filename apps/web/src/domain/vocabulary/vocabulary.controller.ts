import { vocabularyService } from "./vocabulary.service";

export const vocabularyController = {
  create: vocabularyService.create.bind(vocabularyService),
  update: vocabularyService.update.bind(vocabularyService),
  delete: vocabularyService.delete.bind(vocabularyService),
  get: vocabularyService.get.bind(vocabularyService),
  list: vocabularyService.list.bind(vocabularyService),
  search: vocabularyService.search.bind(vocabularyService),
  questions: vocabularyService.questions.bind(vocabularyService),
  progress: vocabularyService.progress.bind(vocabularyService)
};
