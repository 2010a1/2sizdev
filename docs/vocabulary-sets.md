# Vocabulary Sets

`VocabularySet` is a lightweight relation over existing vocabulary records.

Tables:
- `vocabularySets`: set metadata and derived wordCount.
- `vocabularySetItems`: ordered membership relation.

All repository operations require `profileId`. Cross-profile get/update/delete/add operations are rejected or return no record.

Routes:
- `/vocabulary/sets`
- `/vocabulary/sets/new`
- `/vocabulary/sets/:setId`
- `/vocabulary/sets/:setId/edit`
- `/vocabulary/sets/:setId/practice`
- `/vocabulary/sets/:setId/result`

A set does not own vocabulary data. Deleting a set therefore never deletes a vocabulary.
