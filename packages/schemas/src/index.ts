import { z } from "zod";

// ---------- Manifest (.exam package) ----------

export const ExamManifestSchema = z.object({
  format: z.literal("exam"),
  formatVersion: z.number().int().positive(),
  examId: z.string().min(1),
  title: z.string().min(1),
  version: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  questionCount: z.number().int().nonnegative(),
  assets: z.array(z.string())
});
export type ExamManifestInput = z.infer<typeof ExamManifestSchema>;

// ---------- Profile ----------

export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  avatar: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastActiveAt: z.number()
});

export const CreateProfileInputSchema = z.object({
  name: z.string().min(1, "Tên không được để trống").max(40, "Tên tối đa 40 ký tự"),
  avatar: z.string().optional()
});
export type CreateProfileInput = z.infer<typeof CreateProfileInputSchema>;

// ---------- Questions ----------
const QuestionOptionSchema = z.object({ id:z.string().min(1), text:z.string().min(1), imageUrl:z.string().optional() }).strict();
const BaseQuestionFields = { id:z.string().min(1), examId:z.string().min(1), order:z.number().int().nonnegative(), content:z.string().min(1), imageUrl:z.string().optional(), explanation:z.string().optional(), points:z.number().finite().nonnegative().optional(), imageAssetId:z.string().min(1).optional() };
export const ABCDQuestionSchema = z.object({ ...BaseQuestionFields, type:z.literal("ABCD"), options:z.array(QuestionOptionSchema).length(4), correctOptionId:z.string().min(1) }).strict();
export const TrueFalseQuestionSchema = z.object({ ...BaseQuestionFields, type:z.literal("TRUE_FALSE"), correctAnswer:z.boolean() }).strict();
export const ShortAnswerQuestionSchema = z.object({ ...BaseQuestionFields, type:z.literal("SHORT_ANSWER"), correctAnswers:z.array(z.string().min(1)).min(1), acceptedAnswers:z.array(z.string().min(1)).optional(), caseSensitive:z.boolean().optional() }).strict();
export const QuestionSchema = z.discriminatedUnion("type", [ABCDQuestionSchema, TrueFalseQuestionSchema, ShortAnswerQuestionSchema]);
export type QuestionInput = z.infer<typeof QuestionSchema>;

export const ExamContentSchema = z.object({
  id:z.string().min(1), title:z.string().min(1), description:z.string().optional(), subject:z.string().min(1), grade:z.number().int().optional(), duration:z.number().int().positive().finite().optional(), questionCount:z.number().int().nonnegative(), source:z.enum(["official","shared","local","vocabulary"]), version:z.number().int().nonnegative(), contentHash:z.string().regex(/^sha256:[0-9a-f]{64}$/), createdAt:z.number(), updatedAt:z.number(), questions:z.array(QuestionSchema)
}).strict().superRefine((value,ctx)=>{
  for(const [index,q] of value.questions.entries()){
    if(q.type==='ABCD'){const ids=q.options.map(o=>o.id);if(new Set(ids).size!==4)ctx.addIssue({code:'custom',path:['questions',index,'options'],message:'ABCD option IDs must be unique'});if(!ids.includes(q.correctOptionId))ctx.addIssue({code:'custom',path:['questions',index,'correctOptionId'],message:'correctOptionId must reference an option'});}
  }
});
export type ExamContentInput = z.infer<typeof ExamContentSchema>;

// User-facing JSON editor format. It intentionally excludes runtime state and DB fields.
const DraftBase = { id:z.string().min(1), content:z.string().min(1), points:z.number().finite().positive().optional(), explanation:z.string().optional() };
export const ExamDraftQuestionSchema = z.discriminatedUnion("type", [
  z.object({...DraftBase,type:z.literal("ABCD"),options:z.array(QuestionOptionSchema).length(4),correctOptionId:z.string().min(1)}).strict(),
  z.object({...DraftBase,type:z.literal("TRUE_FALSE"),correctAnswer:z.boolean()}).strict(),
  z.object({...DraftBase,type:z.literal("SHORT_ANSWER"),correctAnswers:z.array(z.string().min(1)),caseSensitive:z.boolean().optional(),needsReview:z.boolean().optional(),reviewNote:z.string().optional()}).strict()
]);
export const ExamDraftSchema = z.object({ title:z.string().trim().min(1).max(120), description:z.string().optional(), subject:z.string().trim().min(1).max(120), grade:z.number().int().min(1).max(12).optional(), duration:z.number().int().positive().optional(), questions:z.array(ExamDraftQuestionSchema).min(1) }).strict();
export type ExamDraftInput = z.infer<typeof ExamDraftSchema>;

export const ExamFormSchema = z.object({ title:z.string().min(1,"Tiêu đề không được để trống").max(120), subject:z.string().min(1,"Chọn môn học"), grade:z.number().int().min(1).max(12).optional(), duration:z.number().int().positive().finite().optional() });
export type ExamFormInput = z.infer<typeof ExamFormSchema>;

// ---------- API ----------

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string()
  })
});

export const UpdatesResponseSchema = z.object({
  serverVersion: z.number(),
  changes: z.array(
    z.object({
      examId: z.string(),
      serverVersion: z.number(),
      version: z.number(),
      contentHash: z.string(),
      downloadUrl: z.string()
    })
  )
});

export const SyncMutationSchema = z.object({
  mutationId: z.string().min(1).max(200), profileId: z.string().min(1).max(200), deviceId: z.string().min(1).max(200),
  entityType: z.enum(['exam','question','examAsset','vocabulary','vocabQuestion','vocabularySet','vocabularySetItem','legacy']),
  entityId: z.string().min(1).max(300), operation: z.enum(['CREATE','UPDATE','DELETE']), baseRevision: z.number().int().nonnegative(),
  updatedAt: z.number().finite(), payload: z.unknown().optional()
});
export const SyncPushRequestSchema = z.object({deviceId:z.string().min(1),mutations:z.array(SyncMutationSchema).max(500)});
export const ShareCreateRequestSchema = z.object({ packageBase64:z.string().min(1), contentHash:z.string().regex(/^sha256:[0-9a-f]{64}$/), formatVersion:z.number().int().nonnegative(), expiresIn:z.enum(['24h','7d','never']), ownerDeviceId:z.string().max(200).optional() });
export const ShareCreateResponseSchema = z.object({ shareId:z.string(), shareCode:z.string().regex(/^[A-HJ-NP-Z2-9]{6,10}$/), contentHash:z.string(), formatVersion:z.number().int(), createdAt:z.number(), expiresAt:z.number().optional(), shareUrl:z.string() });

// ---------- Vocabulary ----------

export const VocabularyInputSchema = z.object({
  english: z.string().trim().min(1).max(200),
  vietnamese: z.string().trim().min(1).max(300),
  pronunciation: z.string().trim().max(120).optional(),
  exampleSentence: z.string().trim().max(500).optional(),
  note: z.string().trim().max(500).optional()
});
export type VocabularyInput = z.infer<typeof VocabularyInputSchema>;

export const VocabQuestionSchema = z.object({
  id: z.string().min(1), vocabularyId: z.string().min(1), profileId: z.string().min(1),
  type: z.enum(["MC_EN_TO_VI", "TEXT_EN_TO_VI", "TEXT_VI_TO_EN", "LETTER_ORDER"]),
  prompt: z.string().min(1), answer: z.string(), options: z.array(z.string()).optional(), letters: z.array(z.string()).optional(),
  availability: z.enum(["available", "unavailable"]), unavailableReason: z.string().optional(),
  generatorVersion: z.number().int().positive(), vocabularyGeneration: z.number().int().positive(), createdAt: z.number().finite(), updatedAt: z.number().finite(), deletedAt: z.number().finite().optional()
});


export const VocabularySetInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional()
});
export const VocabularySetSchema = z.object({
  id: z.string().min(1), profileId: z.string().min(1), name: z.string().min(1).max(120),
  description: z.string().max(500).optional(), createdAt: z.number().finite(), updatedAt: z.number().finite(),
  deletedAt: z.number().finite().optional(), wordCount: z.number().int().nonnegative(), version: z.number().int().positive()
});
