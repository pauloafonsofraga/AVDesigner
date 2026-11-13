import { qsfpBreakoutLinkId } from "./qsfpBreakoutModel.js";
import { wirePlaybackDurationMs } from "./wirePlayback.js";

export function qsfpBreakoutPlaybackStep(plans, links, assemblyId, branchId) {
  if (!branchId) return null;
  const link = links.find(item => item.assemblyId === assemblyId && item.branchId === branchId);
  const plan = plans.find(item => item.id === assemblyId);
  const branch = plan?.branches.find(item => item.id === branchId && item.channelId === link?.channelId);
  if (!link || !branch?.target || !plan.trunk.length || !branch.points.length || branch.state !== "connected") return null;
  const points = [...plan.trunk, ...branch.points.slice(1)];
  return { type: "qsfp-breakout-channel", id: qsfpBreakoutLinkId(assemblyId, branchId), assemblyId, branchId,
    channelId: link.channelId, points, color: branch.color, durationMs: wirePlaybackDurationMs(points),
    breakoutEndpoints: [plan.origin, branch.target] };
}
