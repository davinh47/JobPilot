import assert from "node:assert/strict";
import test from "node:test";
import { aiLanguageInstruction, localeFromStored, storedLocale, translate } from "./i18n";

test("stored locale values map to the interface locale", () => {
  assert.equal(localeFromStored("zh-CN"), "zh");
  assert.equal(localeFromStored("en-US"), "en");
  assert.equal(localeFromStored(undefined), "zh");
  assert.equal(storedLocale("zh"), "zh-CN");
  assert.equal(storedLocale("en"), "en-US");
});

test("AI language instructions cover all user-facing generated fields", () => {
  assert.match(aiLanguageInstruction("zh"), /Simplified Chinese/);
  assert.match(aiLanguageInstruction("zh"), /summary/);
  assert.match(aiLanguageInstruction("en"), /written in English/);
  assert.match(aiLanguageInstruction("en"), /suggested wording/);
});

test("shared interface messages exist in both supported locales", () => {
  assert.equal(translate("zh", "save"), "保存");
  assert.equal(translate("en", "save"), "Save");
});
