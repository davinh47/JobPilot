import { z } from "zod";

function withoutUnsupportedFormats(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUnsupportedFormats);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => key === "format" ? [] : [[key, withoutUnsupportedFormats(child)]]),
  );
}

export function openAiCompatibleJsonSchema(schema: z.ZodType) {
  return withoutUnsupportedFormats(z.toJSONSchema(schema));
}
