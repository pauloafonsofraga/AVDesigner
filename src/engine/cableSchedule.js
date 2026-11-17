import { buildCableSchedule as buildRows } from "./cableScheduleCore.js";
import { breakoutList, breakoutProjectRoot } from "./qsfpBreakoutModel.js";
import { activeQsfpBreakoutLinks, resolveQsfpBreakoutPorts, validateQsfpBreakoutProject } from "./qsfpBreakoutValidation.js";
import { normalizeAvDesignerProject } from "./projectAdapter.js";
import { SceneGraph } from "./sceneGraph.js";
import { collectSavedTransceiverStatuses } from "./savedCableStatus.js";

export * from "./cableScheduleCore.js";

export function buildCableSchedule(project, options = {}) {
  const root = breakoutProjectRoot(project);
  const hasBreakouts = breakoutList(root.breakoutAssemblies).length > 0;
  const breakoutValidation = options.breakoutValidation || (hasBreakouts ? validateQsfpBreakoutProject(root) : null);
  let wireStatuses = options.wireStatuses;
  if (!wireStatuses && root.connections?.length) {
    const scene = new SceneGraph();
    scene.setData(normalizeAvDesignerProject(root));
    wireStatuses = collectSavedTransceiverStatuses(root, scene, breakoutValidation);
  }
  if (!hasBreakouts) return buildRows(project, { ...options, wireStatuses });
  const resolve = resolveQsfpBreakoutPorts(root);
  const getBreakoutConnector = (deviceId, connectorId) => options.getConnector?.(deviceId, connectorId)
    || resolve({ deviceId, connectorId })?.connector;
  return buildRows(project, { ...options, getBreakoutConnector, breakoutValidation, wireStatuses,
    breakoutLinks: options.breakoutLinks || activeQsfpBreakoutLinks(project, breakoutValidation) });
}
