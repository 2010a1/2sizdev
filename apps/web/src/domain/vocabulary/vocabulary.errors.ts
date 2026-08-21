export class VocabularyError extends Error { constructor(message: string) { super(message); this.name = "VocabularyError"; } }
export class VocabularyNotFoundError extends VocabularyError { constructor() { super("Không tìm thấy từ vựng."); } }
export class DuplicateVocabularyError extends VocabularyError { constructor() { super("Bạn đã có từ này."); } }
export class VocabularyValidationError extends VocabularyError { constructor(message: string) { super(message); } }
export class VocabularySessionError extends VocabularyError { constructor(message: string) { super(message); } }
