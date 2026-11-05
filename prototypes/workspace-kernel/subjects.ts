/** Browser-safe canonical subject references. View metadata never creates another project or resource. */
export type ResourceSubjectRef = { kind: "resource"; resourceId: string };
export type NonResourceSubjectRef =
  | { kind: "project"; projectId: string }
  | { kind: "collection"; collectionId: string }
  | {
      kind: "resource-query";
      projectId: string | null;
      query: string;
      kinds?: string[];
      collectionId?: string;
    };
export type BlockSubjectRef = ResourceSubjectRef | NonResourceSubjectRef;
export type SubjectState = "active" | "archived" | "unavailable";

export function validateSubjectRef(value: unknown): BlockSubjectRef {
  const input = value as BlockSubjectRef;
  const fail = () => {
    throw Object.assign(new Error("invalid_block_subject"), {
      code: "invalid_block_subject",
    });
  };
  const id = (value: unknown): value is string =>
    typeof value === "string" && !!value.trim() && value.length <= 200;
  if (!input || typeof input !== "object" || Array.isArray(input))
    return fail();
  const keys =
    input.kind === "resource"
      ? ["kind", "resourceId"]
      : input.kind === "project"
        ? ["kind", "projectId"]
        : input.kind === "collection"
          ? ["kind", "collectionId"]
          : input.kind === "resource-query"
            ? ["kind", "projectId", "query", "kinds", "collectionId"]
            : [];
  if (!keys.length || Object.keys(input).some((key) => !keys.includes(key)))
    return fail();
  if (input.kind === "resource") {
    if (!id(input.resourceId)) return fail();
    return { kind: "resource", resourceId: input.resourceId };
  }
  if (input.kind === "project") {
    if (!id(input.projectId)) return fail();
    return { kind: "project", projectId: input.projectId };
  }
  if (input.kind === "collection") {
    if (!id(input.collectionId)) return fail();
    return { kind: "collection", collectionId: input.collectionId };
  }
  if (
    (input.projectId !== null && !id(input.projectId)) ||
    typeof input.query !== "string" ||
    input.query.length > 500 ||
    (input.collectionId !== undefined && !id(input.collectionId)) ||
    (input.kinds !== undefined &&
      (!Array.isArray(input.kinds) ||
        input.kinds.length > 32 ||
        input.kinds.some(
          (kind) =>
            typeof kind !== "string" ||
            !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/.test(kind),
        )))
  )
    return fail();
  return {
    kind: "resource-query",
    projectId: input.projectId,
    query: input.query,
    ...(input.kinds ? { kinds: [...new Set(input.kinds)] } : {}),
    ...(input.collectionId ? { collectionId: input.collectionId } : {}),
  };
}
