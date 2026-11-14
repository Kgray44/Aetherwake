"use strict";

const { performance } = require("node:perf_hooks");

exports.resourcePolicyInspection = function resourcePolicyInspection({
  trusted, hasGesture, inspect, reviewMode, reviewRollback,
}) {
  let pending, lastRead = -Infinity, snapshot;
  async function read() {
    if (pending) return pending;
    if (performance.now() - lastRead < 350) return snapshot;
    pending = Promise.resolve().then(inspect);
    try {
      snapshot = await pending;
      lastRead = performance.now();
      return snapshot;
    } finally {
      pending = undefined;
    }
  }
  return async (event, action) => {
    if (!trusted(event)) throw Error("unauthorized_resource_inspection");
    if (action === "inspect") {
      const result = await read();
      if (!trusted(event)) throw Error("unauthorized_resource_inspection");
      return result;
    }
    if (action !== "mode" && action !== "rollback") throw Error("invalid_resource_inspection_action");
    if (!await hasGesture(event) || !trusted(event)) throw Error("resource_policy_user_gesture_required");
    try {
      await (action === "mode" ? reviewMode : reviewRollback)(() => trusted(event));
    } finally {
      lastRead = -Infinity;
    }
  };
};
