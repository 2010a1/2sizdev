/** Unicode-safe whitespace normalization. Vietnamese accents are intentionally preserved. */
export function normalizeWhitespace(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

export function normalizeEnglish(value: string): string {
  return normalizeWhitespace(value).toLocaleLowerCase("en-US");
}

export function normalizeVietnamese(value: string): string {
  return normalizeWhitespace(value).toLocaleLowerCase("vi-VN");
}

export function normalizeForDisplay(value: string): string {
  return normalizeWhitespace(value);
}
