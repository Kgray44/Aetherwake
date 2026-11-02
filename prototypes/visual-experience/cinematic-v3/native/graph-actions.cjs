const { randomUUID } = require("node:crypto");
/** Validated local object actions. This API never starts a provider turn. */
async function graphAction(action, call) {
  if (!action || typeof action.type !== "string")
    throw new Error("invalid_graph_action");
  let command;
  switch (action.type) {
    case "createProject":
      command = { type: "createProject", title: action.title };
      break;
    case "createWorkspace":
      command = {
        type: "createWorkspace",
        title: action.title,
        projectId: action.projectId,
      };
      break;
    case "createResource":
      command = {
        type: "createResource",
        title: action.title,
        kind: action.kind,
        workspaceId: action.workspaceId,
        provider: action.provider,
      };
      break;
    case "detach":
      command = {
        type: "detach",
        blockId: action.blockId,
        expectedVersion: action.expectedVersion,
      };
      break;
    case "attach":
      command = {
        type: "attach",
        workspaceId: action.workspaceId,
        resourceId: action.resourceId,
      };
      break;
    case "archive":
      if (!["project", "workspace", "resource"].includes(action.kind))
        throw new Error("invalid_archive_subject");
      command =
        action.kind === "workspace"
          ? {
              type: "archiveWorkspace",
              workspaceId: action.id,
              expectedVersion: action.expectedVersion,
              archived: true,
            }
          : {
              type: "archiveSubject",
              kind: action.kind,
              id: action.id,
              expectedVersion: action.expectedVersion,
              archived: true,
            };
      break;
    case "relate":
      command = {
        type: "relate",
        sourceId: action.sourceId,
        targetId: action.targetId,
        kind: action.kind,
      };
      break;
    case "unrelate":
      command = { type: "unrelate", relationshipId: action.relationshipId };
      break;
    case "branch": {
      if (action.providerId !== "local")
        throw new Error("provider_branch_handoff_unavailable");
      if (
        typeof action.title !== "string" ||
        !action.title.trim() ||
        action.title.length > 200
      )
        throw new Error("invalid_title");
      const snapshot = await call("desktop", { type: "snapshot" });
      const source = snapshot.resources.find(
        (r) =>
          r.id === action.resourceId &&
          r.kind === "conversation" &&
          r.available !== false,
      );
      if (!source) throw new Error("source_unavailable");
      if (
        action.workspaceId &&
        !snapshot.workspaces.some((w) => w.id === action.workspaceId)
      )
        throw new Error("workspace_unavailable");
      await call("branch", {
        resourceId: action.resourceId,
        messageId: action.messageId,
        includeMessageIds: action.includeMessageIds,
        title: action.title,
        providerId: "local",
        tokenBudget: action.tokenBudget,
        commandId: randomUUID(),
        ...(action.workspaceId ? { workspaceId: action.workspaceId } : {}),
        ...(action.bounds ? { bounds: action.bounds } : {}),
      });
      return call("desktop", { type: "snapshot" });
    }
    default:
      throw new Error("unsupported_graph_action");
  }
  return call("desktop", {
    ...command,
    ...(action.bounds ? { bounds: action.bounds } : {}),
  });
}
module.exports = { graphAction };
