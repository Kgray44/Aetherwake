const { randomUUID } = require("node:crypto");

const fileFilters = [
  { name: "Documents and media", extensions: ["pdf", "docx", "txt", "md", "csv", "png", "jpg", "jpeg", "gif", "webp", "mp4", "mov", "webm", "ogv"] },
  { name: "All files", extensions: ["*"] },
];

exports.createMediaBroker = ({ win, dialog, shell, call }) => {
  let choosing = false;
  const ownerAlive = () => !win.isDestroyed() && !win.webContents.isDestroyed();
  return async (request) => {
    if (!ownerAlive() || !request || Array.isArray(request) ||
        Object.keys(request).length !== 2 || !request.input || typeof request.input !== "object")
      throw Error("invalid_media_request");
    const { name, input } = request;
    switch (name) {
      case "chooseMediaForAdd": {
        const { kind, variant, workspaceId, expectedLayoutVersion, projectId, bounds, url } = input;
        if (!["file", "link"].includes(kind) ||
            Object.keys(input).some(key => !["kind", "variant", "workspaceId", "expectedLayoutVersion", "projectId", "bounds", "url"].includes(key)) ||
            (kind === "link" ? typeof url !== "string" || url.length > 8192 || variant !== undefined
              : url !== undefined || (variant !== undefined && !["any", "pdf", "document", "video"].includes(variant))))
          throw Error("invalid_media_request");
        let selection;
        if (kind === "file") {
          if (choosing) throw Error("media_picker_busy");
          choosing = true;
          try {
            const result = await dialog.showOpenDialog(win, {
              title: "Choose a file for Aerynth",
              properties: ["openFile", "dontAddToRecent"],
              filters: fileFilters,
            });
            if (result.canceled) return null;
            if (!ownerAlive() || result.filePaths.length !== 1)
              throw Error("media_picker_unavailable");
            selection = { kind, path: result.filePaths[0] };
          } finally { choosing = false; }
        } else selection = { kind, url };
        return call("mediaImportTrusted", {
          kind, variant, workspaceId, expectedLayoutVersion, projectId, bounds,
          commandId: randomUUID(), selection,
        });
      }
      case "describe":
        if (Object.keys(input).length !== 1 || typeof input.resourceId !== "string")
          throw Error("invalid_media_request");
        return call("mediaDescribe", { resourceId: input.resourceId });
      case "readBytes": {
        const { resourceId, expectedVersion, sourceRevision, offset, length } = input;
        if (Object.keys(input).length !== 5 || typeof resourceId !== "string" ||
            !Number.isSafeInteger(expectedVersion) || typeof sourceRevision !== "string" ||
            !Number.isSafeInteger(offset) || offset < 0 ||
            !Number.isSafeInteger(length) || length < 1 || length > 1024 * 1024)
          throw Error("invalid_media_request");
        const { base64 } = await call("mediaReadChunk", { resourceId, expectedVersion, sourceRevision, offset, length });
        if (!ownerAlive() || typeof base64 !== "string" || base64.length !== 4 * Math.ceil(length / 3))
          throw Error("media_source_unavailable");
        const bytes = Buffer.from(base64, "base64");
        if (bytes.byteLength !== length) throw Error("source_changed");
        return new Uint8Array(bytes);
      }
      case "openExternal": {
        if (Object.keys(input).length !== 2 || typeof input.resourceId !== "string" ||
            !Number.isSafeInteger(input.expectedVersion))
          throw Error("invalid_media_request");
        const target = await call("mediaExternalTarget", { resourceId: input.resourceId, expectedVersion: input.expectedVersion });
        if (!ownerAlive()) throw Error("media_source_unavailable");
        if (target.kind === "file") {
          if (await shell.openPath(target.path)) throw Error("media_open_failed");
        } else if (target.kind === "link") {
          const url = new URL(target.url);
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
            throw Error("invalid_media_link");
          await shell.openExternal(url.href);
        } else throw Error("invalid_media_request");
        return null;
      }
      default:
        throw Error("unsupported_media_operation");
    }
  };
};
