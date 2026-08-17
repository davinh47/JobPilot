/**
 * Compatibility exports for integrations that still import the original
 * DeepSeek-named structured generation boundary.
 */
export {
  requestStructuredAiJson as requestDeepSeekJson,
  requestStructuredAiJsonWithKey as requestDeepSeekJsonWithKey,
} from "@/lib/structured-ai";
export type { StructuredRequest } from "@/lib/structured-ai";
