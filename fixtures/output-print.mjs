import { outputViewerParityFixture } from "./output-viewer.mjs";

// Extend the common HTML/live parity fixture with installed-card relationships.
export function outputPrintFixture() {
  const project = outputViewerParityFixture();
  const chassis = project.devices.find(d=>d.instanceId==="chassis").templateOverride;
  chassis.cardTypes.find(c=>c.id==="input-card").connectorRelationships = [
    { id:"card-bus",type:"exclusive",members:["in-0","in-1"] }
  ];
  chassis.cardTypes.find(c=>c.id==="io-card").connectorRelationships = [
    { id:"card-through",type:"through",sourceConnectorId:"in-0",targetConnectorId:"out-0" }
  ];
  return project;
}
