import JSZip from "jszip";
import { ExamContentSchema, ExamManifestSchema, type ExamContentInput } from "@exam/schemas";

export type { ExamContentInput };

export const EXAM_FORMAT = "exam" as const;
export const CURRENT_EXAM_FORMAT_VERSION = 1;
export const EXAM_FORMAT_VERSION = CURRENT_EXAM_FORMAT_VERSION;

export const MAX_EXAM_ZIP_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const MAX_SINGLE_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_ASSET_COUNT = 200;
export const MAX_MANIFEST_BYTES = 1 * 1024 * 1024;
export const MAX_EXAM_JSON_BYTES = 5 * 1024 * 1024;

export interface ExamManifest {
  format: "exam";
  formatVersion: number;
  examId: string;
  title: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  questionCount: number;
  assets: string[];
}

export interface ExamAsset {
  path: string;
  data: Uint8Array;
  mimeType?: string;
  hash?: string;
}

export interface ImportedExam {
  manifest: ExamManifest;
  content: ExamContentInput;
  assets: ExamAsset[];
  formatVersion: number;
  contentHash: string;
  warnings: string[];
}

export type HashableExamContent = Omit<ExamContentInput, "contentHash">;

export type ExamFormatErrorCode =
  | "INVALID_ZIP"
  | "INVALID_MANIFEST"
  | "UNSUPPORTED_VERSION"
  | "INVALID_CONTENT"
  | "INVALID_SCHEMA"
  | "INVALID_ASSET"
  | "UNDECLARED_ASSET"
  | "PATH_TRAVERSAL"
  | "SIZE_LIMIT_EXCEEDED"
  | "TOO_LARGE"
  | "HASH_MISMATCH"
  | "MIGRATION_FAILED";

export class InvalidExamFormatError extends Error {
  public readonly code: ExamFormatErrorCode;

  constructor(message: string, code: ExamFormatErrorCode) {
    super(message);
    this.code = code;
    this.name = "InvalidExamFormatError";
  }
}
export class ExamFormatError extends InvalidExamFormatError {}

function schemaIssueMessage(prefix: string, issues: Array<{ path: PropertyKey[]; message: string }>): string {
  const details = issues.slice(0, 5).map((issue) => {
    const path = issue.path.map(String).join(".") || "root";
    return `${path}: ${issue.message}`;
  });
  return details.length ? `${prefix}: ${details.join("; ")}` : prefix;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((out, key) => {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
      return out;
    }, {});
  }
  return value;
}

export function canonicalizeExamContent(content: HashableExamContent | ExamContentInput): string {
  const { contentHash: _ignored, ...hashable } = content as ExamContentInput;
  return JSON.stringify(sortKeys(hashable));
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function hashExam(content: HashableExamContent | ExamContentInput): Promise<string> {
  return sha256(new TextEncoder().encode(canonicalizeExamContent(content)));
}

export async function hashAsset(data: Uint8Array): Promise<string> {
  return sha256(data);
}

export interface ExportExamOptions {
  content: HashableExamContent;
  assets?: ExamAsset[];
}

function assertSafeAssetPath(path: string): void {
  if (!path.startsWith("assets/")) throw new InvalidExamFormatError(`Unsafe asset path: ${path}`, "PATH_TRAVERSAL");
  const rest = path.slice("assets/".length);
  if (!rest || rest.startsWith("/") || rest.includes("\\") || rest.split("/").includes("..") || /^[A-Za-z]:/.test(rest) || rest.includes("\0")) {
    throw new InvalidExamFormatError(`Unsafe asset path: ${path}`, "PATH_TRAVERSAL");
  }
  const normalized = rest.split("/").filter(Boolean).join("/");
  if (normalized !== rest || !/^assets\/[^/]+(?:\/[^/]+)*$/.test(path)) {
    throw new InvalidExamFormatError(`Non-canonical asset path: ${path}`, "PATH_TRAVERSAL");
  }
}

function normalizeZipPath(path: string, isDirectory = false): string {
  if (path.includes("\0")) throw new InvalidExamFormatError("ZIP path contains null byte", "PATH_TRAVERSAL");
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\")) {
    throw new InvalidExamFormatError(`Unsafe ZIP path: ${path}`, "PATH_TRAVERSAL");
  }
  const parts = path.split("/");
  if (parts.some((p) => p === ".." || p === ".")) throw new InvalidExamFormatError(`Unsafe ZIP path: ${path}`, "PATH_TRAVERSAL");
  if (isDirectory) {
    if (parts.at(-1) !== "" || parts.slice(0, -1).some((p) => !p)) throw new InvalidExamFormatError(`Non-canonical ZIP path: ${path}`, "PATH_TRAVERSAL");
    return parts.join("/");
  }
  if (parts.some((p) => p === "" && parts.indexOf(p) !== 0)) throw new InvalidExamFormatError(`Non-canonical ZIP path: ${path}`, "PATH_TRAVERSAL");
  return parts.join("/");
}

export function sanitizeFilename(title: string): string {
  const cleaned = title.replace(/[\u0000-\u001F\u007F]/g, "").replace(/[\\/:*?"<>|]/g, "-").trim().replace(/\.+$/g, "");
  const base = cleaned.slice(0, 100) || "exam";
  const withoutExtension = base.toLowerCase().endsWith(".exam") ? base.slice(0, -5) : base;
  return `${withoutExtension || "exam"}.exam`;
}

export async function exportExam(options: ExportExamOptions): Promise<Uint8Array> {
  const { content, assets = [] } = options;
  const parsed = ExamContentSchema.safeParse({ ...content, contentHash: `sha256:${"0".repeat(64)}` });
  if (!parsed.success) throw new InvalidExamFormatError(schemaIssueMessage("Invalid exam content", parsed.error.issues), "INVALID_CONTENT");
  if (assets.length > MAX_ASSET_COUNT) throw new InvalidExamFormatError("Too many assets", "SIZE_LIMIT_EXCEEDED");

  const seen = new Set<string>();
  let total = 0;
  const normalizedAssets: ExamAsset[] = [];
  for (const asset of assets) {
    const fullPath = asset.path.startsWith("assets/") ? asset.path : `assets/${asset.path}`;
    assertSafeAssetPath(fullPath);
    if (seen.has(fullPath)) throw new InvalidExamFormatError(`Duplicate asset path: ${fullPath}`, "INVALID_ASSET");
    seen.add(fullPath);
    if (asset.data.byteLength > MAX_SINGLE_ASSET_BYTES) throw new InvalidExamFormatError(`Asset too large: ${fullPath}`, "SIZE_LIMIT_EXCEEDED");
    total += asset.data.byteLength;
    if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new InvalidExamFormatError("Total asset size too large", "SIZE_LIMIT_EXCEEDED");
    normalizedAssets.push({ ...asset, path: fullPath.slice("assets/".length), hash: asset.hash ?? await hashAsset(asset.data) });
  }

  const contentHash = await hashExam(content);
  const contentWithHash = { ...content, contentHash } as ExamContentInput;
  const manifest: ExamManifest = {
    format: EXAM_FORMAT,
    formatVersion: CURRENT_EXAM_FORMAT_VERSION,
    examId: content.id,
    title: content.title,
    version: content.version,
    createdAt: new Date(content.createdAt).toISOString(),
    updatedAt: new Date(content.updatedAt).toISOString(),
    contentHash,
    questionCount: content.questionCount,
    assets: normalizedAssets.map((a) => `assets/${a.path}`)
  };

  const manifestText = JSON.stringify(manifest, null, 2);
  const examText = JSON.stringify(contentWithHash, null, 2);
  if (new TextEncoder().encode(manifestText).byteLength > MAX_MANIFEST_BYTES) throw new InvalidExamFormatError("manifest.json too large", "SIZE_LIMIT_EXCEEDED");
  if (new TextEncoder().encode(examText).byteLength > MAX_EXAM_JSON_BYTES) throw new InvalidExamFormatError("exam.json too large", "SIZE_LIMIT_EXCEEDED");

  const zip = new JSZip();
  zip.file("manifest.json", manifestText);
  zip.file("exam.json", examText);
  for (const asset of normalizedAssets) zip.file(`assets/${asset.path}`, asset.data);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  if (bytes.byteLength > MAX_EXAM_ZIP_BYTES) throw new InvalidExamFormatError(".exam file too large", "SIZE_LIMIT_EXCEEDED");
  return bytes;
}

interface ZipMeta { name: string; size: number; dir: boolean; }
function zipEntrySize(file: JSZip.JSZipObject): number {
  const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) throw new InvalidExamFormatError(`Cannot determine ZIP entry size: ${file.name}`, "INVALID_ZIP");
  return size;
}

export async function importExam(input: Uint8Array | ArrayBuffer): Promise<ImportedExam> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_EXAM_ZIP_BYTES) throw new InvalidExamFormatError(".exam file too large", "SIZE_LIMIT_EXCEEDED");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false }); }
  catch { throw new InvalidExamFormatError("Invalid ZIP", "INVALID_ZIP"); }

  const metas: ZipMeta[] = [];
  const normalizedNames = new Set<string>();
  let total = 0;
  for (const file of Object.values(zip.files)) {
    const normalized = normalizeZipPath(file.name, file.dir);
    if (normalizedNames.has(normalized)) throw new InvalidExamFormatError(`Duplicate ZIP path: ${file.name}`, "INVALID_ZIP");
    normalizedNames.add(normalized);
    const dir = file.dir;
    const size = dir ? 0 : zipEntrySize(file);
    total += size;
    if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new InvalidExamFormatError("Total uncompressed size too large", "SIZE_LIMIT_EXCEEDED");
    if (!dir && normalized !== "manifest.json" && normalized !== "exam.json" && !normalized.startsWith("assets/")) {
      throw new InvalidExamFormatError(`Undeclared runtime ZIP entry: ${normalized}`, "INVALID_ZIP");
    }
    if (!dir && normalized.startsWith("assets/") && size > MAX_SINGLE_ASSET_BYTES) throw new InvalidExamFormatError(`Asset too large: ${normalized}`, "SIZE_LIMIT_EXCEEDED");
    metas.push({ name: normalized, size, dir });
  }

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile || zipEntrySize(manifestFile) > MAX_MANIFEST_BYTES) throw new InvalidExamFormatError("Invalid or missing manifest.json", "INVALID_MANIFEST");
  let manifestJson: unknown;
  try { manifestJson = JSON.parse(await manifestFile.async("string")); }
  catch { throw new InvalidExamFormatError("Invalid manifest.json", "INVALID_MANIFEST"); }
  const manifestResult = ExamManifestSchema.safeParse(manifestJson);
  if (!manifestResult.success) throw new InvalidExamFormatError("Invalid manifest schema", "INVALID_MANIFEST");
  let manifest = manifestResult.data as ExamManifest;
  if (manifest.assets.length > MAX_ASSET_COUNT) throw new InvalidExamFormatError("Too many assets", "SIZE_LIMIT_EXCEEDED");
  const normalizedManifestAssets = manifest.assets.map((path) => { assertSafeAssetPath(path); return path; });
  if (new Set(normalizedManifestAssets).size !== normalizedManifestAssets.length) throw new InvalidExamFormatError("Duplicate normalized asset path", "INVALID_ASSET");

  const manifestAssets = new Set(manifest.assets);
  for (const meta of metas.filter((m) => !m.dir && m.name.startsWith("assets/"))) {
    if (!manifestAssets.has(meta.name)) throw new InvalidExamFormatError(`Undeclared asset: ${meta.name}`, "UNDECLARED_ASSET");
  }
  for (const path of manifest.assets) {
    if (!zip.file(path)) throw new InvalidExamFormatError(`Missing asset: ${path}`, "INVALID_ASSET");
  }

  if (manifest.formatVersion > CURRENT_EXAM_FORMAT_VERSION || manifest.formatVersion < 1) {
    throw new InvalidExamFormatError(`Unsupported format version: ${manifest.formatVersion}`, "UNSUPPORTED_VERSION");
  }

  const examFile = zip.file("exam.json");
  if (!examFile || zipEntrySize(examFile) > MAX_EXAM_JSON_BYTES) throw new InvalidExamFormatError("Invalid or missing exam.json", "INVALID_CONTENT");
  let contentJson: unknown;
  try { contentJson = JSON.parse(await examFile.async("string")); }
  catch { throw new InvalidExamFormatError("Invalid exam.json", "INVALID_CONTENT"); }

  let migrated: unknown;
  try { migrated = migrateExamContent(contentJson, manifest.formatVersion); }
  catch (error) {
    if (error instanceof InvalidExamFormatError) throw error;
    throw new InvalidExamFormatError("Migration failed", "MIGRATION_FAILED");
  }
  const legacy = isLegacyExamContent(contentJson);
  if (legacy) {
    const rawHash = await hashExam(contentJson as any);
    if (rawHash !== manifest.contentHash || (contentJson as any)?.contentHash !== manifest.contentHash) throw new InvalidExamFormatError("Hash mismatch", "HASH_MISMATCH");
  }
  const contentResult = ExamContentSchema.safeParse(migrated);
  if (!contentResult.success) throw new InvalidExamFormatError(schemaIssueMessage("Invalid exam content", contentResult.error.issues), "INVALID_CONTENT");
  const content = contentResult.data;
  const declaredAssets = new Set(manifest.assets);
  for (const question of content.questions) {
    if (question.imageAssetId && !declaredAssets.has(question.imageAssetId)) {
      throw new InvalidExamFormatError(`Question references undeclared asset: ${question.imageAssetId}`, "INVALID_ASSET");
    }
  }
  if (content.id !== manifest.examId || content.title !== manifest.title || content.version !== manifest.version || content.questionCount !== manifest.questionCount || content.questions.length !== content.questionCount || content.questions.some(q => q.examId !== content.id)) {
    throw new InvalidExamFormatError("Manifest/content mismatch", "INVALID_MANIFEST");
  }
  const computedHash = await hashExam(content);
  if (!legacy && (computedHash !== manifest.contentHash || computedHash !== content.contentHash)) throw new InvalidExamFormatError("Hash mismatch", "HASH_MISMATCH");
  if (legacy) {
    manifest = { ...manifest, contentHash: computedHash };
  }

  const assets: ExamAsset[] = [];
  for (const path of manifest.assets) {
    const file = zip.file(path)!;
    const data = await file.async("uint8array");
    assets.push({ path: path.slice("assets/".length), data, hash: await hashAsset(data) });
  }
  return { manifest, content, assets, formatVersion: manifest.formatVersion, contentHash: computedHash, warnings: [] };
}

export async function validateExam(input: Uint8Array | ArrayBuffer): Promise<boolean> {
  try { await importExam(input); return true; } catch { return false; }
}

function isLegacyExamContent(content: any): boolean {
  return Array.isArray(content?.questions) && content.questions.some((q:any) => ["single_choice","text","ordering","true_false"].includes(q?.type));
}

export function migrateExamContent(content: unknown, fromVersion: number): unknown {
  if (fromVersion !== CURRENT_EXAM_FORMAT_VERSION) throw new InvalidExamFormatError(`No migration path from format ${fromVersion}`, "MIGRATION_FAILED");
  const source:any = content;
  if (!isLegacyExamContent(source)) return content;
  const questions = source.questions.map((q:any, index:number) => {
    const base = { id:q.id, examId:q.examId, order:index, content:q.content, explanation:q.explanation, points:q.points, imageAssetId:q.imageAssetId };
    if (q.type === "single_choice") {
      const options = Array.isArray(q.options) ? q.options.slice(0,4) : [];
      while (options.length < 4) options.push({ id:`legacy_${options.length+1}`, text:`Lựa chọn ${options.length+1}` });
      return { ...base, type:"ABCD", options, correctOptionId:q.correctOptionId ?? q.answer };
    }
    if (q.type === "true_false") return { ...base, type:"TRUE_FALSE", correctAnswer:Boolean(q.answer) };
    if (q.type === "text") return { ...base, type:"SHORT_ANSWER", correctAnswers:q.acceptedAnswers?.length ? q.acceptedAnswers : (q.answer ? [q.answer] : []), caseSensitive:q.caseSensitive };
    if (q.type === "ordering") {
      const byId = new Map((q.items ?? []).map((x:any) => [x.id, x.text]));
      const answer = (q.answer ?? []).map((id:string) => byId.get(id) ?? id).join(", ");
      return { ...base, type:"SHORT_ANSWER", correctAnswers:answer ? [answer] : [] };
    }
    return q;
  });
  return { ...source, questions, questionCount:questions.length };
}

export function migrateExamFormat(manifest: ExamManifest): ExamManifest {
  if (manifest.formatVersion === CURRENT_EXAM_FORMAT_VERSION) return manifest;
  if (manifest.formatVersion > CURRENT_EXAM_FORMAT_VERSION) throw new InvalidExamFormatError("Future format version", "UNSUPPORTED_VERSION");
  throw new InvalidExamFormatError("No migration path", "MIGRATION_FAILED");
}
