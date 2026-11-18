import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("publishing watchdog", { minutes: 10 }, internal.publisher.watchdog, {});
crons.interval("purge expired sign-in links", { hours: 1 }, internal.channels.purgeExpiredStates, {});
crons.daily("renew channel tokens", { hourUTC: 9, minuteUTC: 17 }, internal.publisher.renewTokens, {});

crons.daily("prune old activity", { hourUTC: 8, minuteUTC: 43 }, internal.workspaces.pruneActivity, {});

export default crons;
