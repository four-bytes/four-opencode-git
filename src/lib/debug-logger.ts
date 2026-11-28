// Re-exported from @four-bytes/opencode-plugin-lib — single source of truth.
import { createJsonlLogger } from "@four-bytes/opencode-plugin-lib";

export type { DebugEvent } from "@four-bytes/opencode-plugin-lib";

export const logDebugEvent = createJsonlLogger("four-opencode-git");
