// The RtcEventLog parser (@irbisadm/rtc-event-log,
// https://github.com/irbisadm/rtc-event-log), a devDependency.

import * as rtcEventLog from "@irbisadm/rtc-event-log";

export {rtcEventLog};

// The parser module; the tools use its API untyped (see its types/index.d.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RtcEventLogModule = any;
