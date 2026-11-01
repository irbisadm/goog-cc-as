// Loads the RtcEventLog parser (https://github.com/irbisadm/rtc-event-log):
// the installed package if there is one, otherwise the build of a sibling
// checkout (../rtc-event-log, `yarn build` there). Returns null when neither
// exists, so the tools and their tests can skip cleanly.

import {existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

// The parser's API is used untyped here; see its types/index.d.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RtcEventLogModule = any;

export async function loadRtcEventLog(): Promise<RtcEventLogModule | null> {
  try {
    return await import("@irbisadm/rtc-event-log");
  } catch {
    // Not installed.
  }
  const sibling = join(dirname(fileURLToPath(import.meta.url)), "../../../rtc-event-log/dist/index.mjs");
  if (existsSync(sibling)) {
    return await import(pathToFileURL(sibling).href);
  }
  return null;
}
