// Activity types, grouped for the Activity page filters. Shared by the
// backend and the web app. Every action the backend logs belongs in one group.
export const ACTIVITY_KINDS = {
  publishing: {
    label: "Publishing",
    actions: ["Published", "Partly published", "Publishing failed", "Publishing now", "Retrying failed channels"],
  },
  scheduling: {
    label: "Scheduling",
    actions: ["Post scheduled", "Post rescheduled", "Moved back to drafts", "Post deleted", "Bulk import", "Draft saved"],
  },
  approvals: {
    label: "Approvals",
    actions: ["Sent for approval", "Post approved", "Changes requested"],
  },
  channels: {
    label: "Channels",
    actions: ["Channels connected", "Channel disconnected"],
  },
  team: {
    label: "Team and settings",
    actions: ["Workspace created", "Workspace settings updated", "Member role changed", "Member removed", "Invite link created", "Joined the workspace"],
  },
} as const;

export type ActivityKind = keyof typeof ACTIVITY_KINDS;
export const ACTIVITY_KIND_IDS = Object.keys(ACTIVITY_KINDS) as ActivityKind[];
