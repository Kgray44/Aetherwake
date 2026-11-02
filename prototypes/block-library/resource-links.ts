import type {
  DesktopSnapshot,
  Resource,
} from "../application-contract/contracts.ts";

export const USER_LINK_KINDS = [
  "references",
  "depends_on",
  "related_to",
] as const;
export type UserLinkKind = (typeof USER_LINK_KINDS)[number];
export type ResourceLinksSnapshot = Pick<
  DesktopSnapshot,
  "resources" | "relationships"
>;
export type ResourceLinkAction =
  | { type: "relate"; sourceId: string; targetId: string; kind: UserLinkKind }
  | { type: "unrelate"; relationshipId: string };
export interface ResourceLinksPort {
  /** Fresh authorized canonical metadata, never another store or transcript. */
  read(): Promise<ResourceLinksSnapshot>;
  /** The host supplies the existing trusted graphAction broker and applies its snapshot. */
  change?(action: ResourceLinkAction): Promise<ResourceLinksSnapshot>;
  capabilities: { relate: boolean; unrelate: boolean };
  openResource?(resourceId: string): void;
}
type Metadata = Pick<
  Resource,
  "id" | "title" | "kind" | "version" | "project_id"
>;
const visible = (resource: Resource) =>
  resource.available !== false &&
  resource.visible !== false &&
  resource.state !== "archived";
const metadata = (resource: Resource): Metadata => ({
  id: resource.id,
  title: resource.title,
  kind: resource.kind,
  version: resource.version,
  ...(resource.project_id === undefined
    ? {}
    : { project_id: resource.project_id }),
});
export const removableResourceLink = (
  edge: ResourceLinksSnapshot["relationships"][number],
) =>
  edge.provenance === "user" &&
  USER_LINK_KINDS.includes(edge.kind as UserLinkKind);

/** A returned snapshot must show the requested effect with both endpoints still
 * accessible. A filtered-out edge alone is not proof that a link was removed. */
export function confirmsResourceLinkChange(
  before: ResourceLinksSnapshot,
  after: ResourceLinksSnapshot,
  action: ResourceLinkAction,
) {
  const visibleIds = new Set(
    after.resources.filter(visible).map((resource) => resource.id),
  );
  if (action.type === "relate")
    return (
      visibleIds.has(action.sourceId) &&
      visibleIds.has(action.targetId) &&
      after.relationships.some(
        (edge) =>
          edge.source_id === action.sourceId &&
          edge.target_id === action.targetId &&
          edge.kind === action.kind &&
          edge.provenance === "user",
      )
    );
  const edge = before.relationships.find(
    (edge) => edge.id === action.relationshipId,
  );
  return (
    !!edge &&
    visibleIds.has(edge.source_id) &&
    visibleIds.has(edge.target_id) &&
    !after.relationships.some((edge) => edge.id === action.relationshipId)
  );
}

/** Metadata projection only. Access to a link never exposes an unavailable endpoint
 * or its content. Membership, ancestry and system links remain read-only here. */
export function resourceLinks(
  snapshot: ResourceLinksSnapshot,
  resourceId: string,
  query = "",
) {
  const resources = new Map(
    snapshot.resources
      .filter(visible)
      .map((resource) => [resource.id, metadata(resource)]),
  );
  const source = resources.get(resourceId) ?? null;
  if (!source)
    return {
      source,
      links: [],
      candidates: [],
      moreLinks: false,
      moreCandidates: false,
    };
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),
    matches = (value: string) =>
      terms.every((term) => value.toLocaleLowerCase().includes(term));
  const links = snapshot.relationships.flatMap((edge) => {
    if (edge.source_id !== resourceId && edge.target_id !== resourceId)
      return [];
    const other = resources.get(
      edge.source_id === resourceId ? edge.target_id : edge.source_id,
    );
    if (
      !other ||
      !resources.has(edge.source_id) ||
      !resources.has(edge.target_id) ||
      !matches(other.title + " " + other.id + " " + edge.kind)
    )
      return [];
    return [
      {
        id: edge.id,
        resource: other,
        kind: edge.kind,
        provenance: edge.provenance,
        direction:
          edge.source_id === resourceId
            ? ("outgoing" as const)
            : ("incoming" as const),
        removable: removableResourceLink(edge),
      },
    ];
  });
  const candidates = [...resources.values()]
    .filter(
      (resource) =>
        resource.id !== resourceId &&
        matches(resource.title + " " + resource.kind + " " + resource.id),
    )
    .sort(
      (left, right) =>
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id),
    );
  return {
    source,
    links: links.slice(0, 100),
    candidates: candidates.slice(0, 60),
    moreLinks: links.length > 100,
    moreCandidates: candidates.length > 60,
  };
}
