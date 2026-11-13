import { buildCableSchedule as buildRows } from "./cableScheduleCore.js";
import { breakoutList, breakoutProjectRoot } from "./qsfpBreakoutModel.js";
import { activeQsfpBreakoutLinks, resolveQsfpBreakoutPorts, validateQsfpBreakoutProject } from "./qsfpBreakoutValidation.js";

export * from "./cableScheduleCore.js";

export function buildCableSchedule(project, options = {}) {
  const root = breakoutProjectRoot(project);
  if (!breakoutList(root.breakoutAssemblies).length) return buildRows(project, options);
  const resolve = resolveQsfpBreakoutPorts(root);
  const getBreakoutConnector = (deviceId, connectorId) => options.getConnector?.(deviceId, connectorId)
    || resolve({ deviceId, connectorId })?.connector;
  const breakoutValidation = options.breakoutValidation || validateQsfpBreakoutProject(root);
  return buildRows(project, { ...options, getBreakoutConnector, breakoutValidation,
    breakoutLinks: options.breakoutLinks || activeQsfpBreakoutLinks(project, breakoutValidation) });
}
