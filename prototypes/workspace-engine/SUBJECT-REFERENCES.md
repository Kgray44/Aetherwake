# Typed block subjects

Blocks retain one canonical geometry/layout/history owner. A resource-backed block still references its original resource ID. Project Overview, Collection Browser and Resource Browser placements instead use explicit subject references; they do not create notes or duplicate projects to satisfy a resource foreign key.

`workspace-kernel/subjects.ts` is browser safe and owns `BlockSubjectRef`: resource, project, collection, or resource-query (project scope, search text, optional kinds and collection). The validator rejects unknown fields, malformed IDs and unbounded queries. A query describes a view, not a permission grant.

## Schema and recovery

Kernel schema 3 adds retained binding metadata and changes `blocks` to require exactly one resource or subject-binding foreign key. Existing placement/resource IDs, geometry and versions copy unchanged. All extension tables remain in the same database. The rebuild disables FK enforcement outside the startup transaction, never renames the original `blocks` table, and validates all foreign keys before committing. Enforcement is restored even on failure. This avoids SQLite cascading away engine/desktop extension rows or rewriting their FK targets. SQLite journaling provides atomic crash recovery.

Binding metadata remains after detach because undo/checkpoints may reference it. New bindings are bounded to 32,768 retained IDs; capacity failure preserves all prior data. Its project/collection FKs prevent deleting a still-retained subject; forgetting recovery references is a separate explicit retention operation. Resource deletion rules and engine recovery archives remain intact.

Resource history continues using its original `resourceId` encoding so historical fingerprints remain valid. New non-resource history stores the tagged subject plus an internal binding ID. The binding ID is not renderer state. Normalization reads legacy resource snapshots and late imports; checkpoints and receipt retention are unchanged. Undo may restore an archived subject as an archived presentation without changing that subject.

## Trusted command

`WorkspaceEngine.execute({type:'attachSubject', subject, ...normal command envelope})` uses the existing geometry validation, layout policy, receipt, event and undo pipeline. New attachment and duplication require `EngineOptions.allowSubjectAttachment(subject, workspaceId) === true`; the native host owns the effective authorization decision. The kernel checks active canonical subject existence. No provider request occurs.

Fluid, Freeform, Structured, collision solving, viewport mapping and `system:vela` retain their existing algorithms and identity. All geometry operations address placement IDs and work for either subject arm.

## Renderer and navigation contract

`BlockProjection` has resourceId for resource subjects; its non-resource union arm has no resourceId. Both carry a tagged subject in newly generated projections, along with subjectState. The old resourceState field remains as a compatible status alias. Older resource receipts may omit the tag.

`application-contract.Block` mirrors this with `resource_id` only in the resource arm. Before looking up a resource, consumers must check `typeof block.resource_id === 'string'`. Non-resource views use the tagged subject and trusted read ports. `navigationBlocks` carries the same union. Project views link to existing project anchors in Constellation; they do not create canonical resource nodes or imply project ownership.

The subsequent library schema-2 template increment supports explicit reference or target-project-context subject bindings. Old schema-1 resource templates remain readable. Native shell and Constellation adaptations remain integration work, not proof supplied by the migration tests.

## Verification

The combined kernel/engine/library suite passes 98 tests. Five new tests cover legacy engine/extension FK rows and raw histories/checkpoints/receipts; atomic failed rebuild; a real interrupted DROP/rebuild and hot-journal recovery; new subject duplicate/detach/undo/checkpoint/restart; fail-closed authorization, malformed bindings and archived-subject recovery. Strict source TypeScript checking passes for the kernel, engine and library modules. No native visual or performance qualification is claimed by these source tests.
