"use strict";
const { createHash } = require("node:crypto");

async function reviewMissionExecutive({ request, parent, call, reviewProvider, isCurrent, allowWrite }) {
  const guard = () => {
    if (!isCurrent()) throw Error("unauthorized_sender");
  };
  guard();
  const review = await call("missionExecutiveReview", request);
  guard();
  if (!request || !review?.request || review.request.id !== request.id || review.request.revision !== request.revision ||
    review.request.triggerSeq !== request.triggerSeq || !/^[a-f0-9]{64}$/.test(review.fingerprint))
    throw Error("mission_executive_review_changed");
  const prompt = JSON.stringify(review.packet, null, 2);
  const approved = await reviewProvider({
    parent, intent: review.packet.objective, expiresAt: new Date(Date.now() + 90_000).toISOString(),
    review: { providerId: "openai-api-vela", missionExecutive: true, missionObjectiveAssessment: Boolean(review.packet.completion), prompt,
      promptDigest: createHash("sha256").update(JSON.stringify(prompt)).digest("hex"),
      route: { kind: "conversational", depth: review.packet.completion ? "objective assessment" : "checkpoint review", model: review.model, effort: review.effort }, context: { included: [] },
    },
  });
  if (approved !== true) throw Error("mission_review_declined");
  guard();
  if (!(await allowWrite())) throw Error("storage_reserve_admission_denied");
  guard();
  return call("missionExecutiveReviewed", { ...review.request, fingerprint: review.fingerprint });
}

module.exports = { reviewMissionExecutive };
