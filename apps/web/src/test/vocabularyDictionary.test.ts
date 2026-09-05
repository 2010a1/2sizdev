import { describe, expect, it } from "vitest";
import { autoTranslateText, expandBulkInput, translateEnToVi } from "../domain/vocabulary/vocabulary.dictionary";

describe("offline EN→VI dictionary", () => {
  it("translates known words case-insensitively", () => {
    expect(translateEnToVi("happy")).toBe("vui vẻ");
    expect(translateEnToVi("  Hello ")).toBe("xin chào");
    expect(translateEnToVi("BOOK")).toBe("quyển sách");
  });

  it("returns undefined for unknown words instead of guessing", () => {
    expect(translateEnToVi("flabbergasted")).toBeUndefined();
  });

  it("auto-translates bare words separated by newline, comma or semicolon", () => {
    const { entries, unknown } = expandBulkInput("happy\nhello,apple;dog");
    expect(entries).toEqual([
      { english: "happy", vietnamese: "vui vẻ" },
      { english: "hello", vietnamese: "xin chào" },
      { english: "apple", vietnamese: "quả táo" },
      { english: "dog", vietnamese: "chó" }
    ]);
    expect(unknown).toEqual([]);
  });

  it("keeps explicit word:meaning pairs untouched", () => {
    const { entries, unknown } = expandBulkInput("happy:hạnh phúc");
    expect(entries).toEqual([{ english: "happy", vietnamese: "hạnh phúc" }]);
    expect(unknown).toEqual([]);
  });

  it("splits comma-separated pairs only when every segment has a colon", () => {
    // User's desired form: happy:vui vẻ,hello:xin chào → two pairs.
    const split = expandBulkInput("happy:vui vẻ,hello:xin chào");
    expect(split.entries).toEqual([
      { english: "happy", vietnamese: "vui vẻ" },
      { english: "hello", vietnamese: "xin chào" }
    ]);
    // A meaning containing a comma must NOT be split.
    const kept = expandBulkInput("manager:quản lý, người điều hành");
    expect(kept.entries).toEqual([{ english: "manager", vietnamese: "quản lý, người điều hành" }]);
  });

  it("reports unknown bare words instead of inventing meanings", () => {
    const { entries, unknown } = expandBulkInput("happy,zzzunknown");
    expect(entries).toEqual([{ english: "happy", vietnamese: "vui vẻ" }]);
    expect(unknown).toEqual(["zzzunknown"]);
  });

  it("autoTranslateText fills meanings in place and keeps unknown words visible", () => {
    const { text, unknown } = autoTranslateText("happy,hello\nbanana");
    expect(text).toBe("happy:vui vẻ\nhello:xin chào\nbanana:quả chuối");
    expect(unknown).toEqual([]);
    const partial = autoTranslateText("happy,zzzunknown");
    expect(partial.text).toBe("happy:vui vẻ\nzzzunknown");
    expect(partial.unknown).toEqual(["zzzunknown"]);
  });
});
