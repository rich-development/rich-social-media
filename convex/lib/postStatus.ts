import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function targetsOf(ctx: MutationCtx, postId: Id<"posts">) {
  return await ctx.db.query("postTargets").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
}

/** Stop a target's pending job, if it has one that has not started. */
export async function cancelJob(ctx: MutationCtx, target: Doc<"postTargets">) {
  if (!target.scheduledFnId) return;
  const job = await ctx.db.system.get(target.scheduledFnId);
  if (job && job.state.kind === "pending") await ctx.scheduler.cancel(target.scheduledFnId);
}

/**
 * Queue a publish job for every pending target of a post. Each job carries a
 * fresh run token. A job whose token no longer matches does nothing, which
 * makes rescheduling and editing safe against double posting.
 */
export async function scheduleTargets(ctx: MutationCtx, postId: Id<"posts">, at: number) {
  for (const target of await targetsOf(ctx, postId)) {
    if (target.status !== "pending") continue;
    await cancelJob(ctx, target);
    const runToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const scheduledFnId = await ctx.scheduler.runAt(
      Math.max(at, Date.now()),
      internal.publisher.publishTarget,
      { targetId: target._id, runToken },
    );
    await ctx.db.patch(target._id, { scheduledFnId, runToken });
  }
}

export async function cancelTargets(ctx: MutationCtx, postId: Id<"posts">) {
  for (const target of await targetsOf(ctx, postId)) {
    if (target.status !== "pending") continue;
    await cancelJob(ctx, target);
    await ctx.db.patch(target._id, { scheduledFnId: undefined, runToken: undefined });
  }
}

/** Roll the per-channel results up into the post's overall status. */
export async function recomputePostStatus(ctx: MutationCtx, postId: Id<"posts">) {
  const post = await ctx.db.get(postId);
  if (!post || post.status === "draft" || post.status === "pending_approval") return;
  const targets = await targetsOf(ctx, postId);
  const count = (s: Doc<"postTargets">["status"]) => targets.filter((t) => t.status === s).length;
  const open = count("pending") + count("publishing");
  let status: Doc<"posts">["status"];
  if (targets.length > 0 && count("published") === targets.length) status = "published";
  else if (open > 0) status = count("publishing") + count("published") + count("failed") > 0 ? "publishing" : "scheduled";
  else if (count("published") > 0) status = "partial";
  else status = "failed";
  const patch: Partial<Doc<"posts">> = { status, updatedAt: Date.now() };
  if ((status === "published" || status === "partial") && !post.publishedAt) patch.publishedAt = Date.now();
  await ctx.db.patch(postId, patch);
}
