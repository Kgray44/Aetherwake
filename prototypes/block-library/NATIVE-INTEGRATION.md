# Universal block library integration

This increment extends the existing module and canonical adapter. It does not replace the workspace engine, conversation service, native authorization boundary, material renderer, or Motion Coordinator.

## Native port release

Forward the following `TemplateService` methods through the existing validated native command boundary:

| Method | Input | Result |
| --- | --- | --- |
| `findResources` | `ResourceDiscoveryInput` | `ResourceDiscoveryPage` |
| `attachBlock` | `AttachBlockInput` | `CreatedBlock` |
| `preferences` | none | `LibraryPreferences` |
| `setFavorite` | kind, favorite, expectedVersion | `LibraryPreferences` |
| `getBlockSettings` | placementId | `BlockInstanceSettings` |
| `configureBlock` | placementId, expectedVersion, configuration | `BlockInstanceSettings` |
| `previewWorkspaceFromResources` | `WorkspaceFromResourcesInput` | `WorkspaceConstructionPreview` |
| `workspaceFromResources` | `WorkspaceFromResourcesInput` | `ConstructedWorkspace` |

`createCanonicalTemplateHost` supplies discovery and placement authorization through its existing effective-grant callback. Search uses bounded keyset pages and returns only active resources of the selected kind owned by the target project or unassigned. Attachment rechecks resource and layout versions and grants in the canonical transaction, creates only a placement, and records a persistent command receipt. A disconnected execution provider does not prohibit reading or attaching an otherwise available conversation.

`createBlock` additionally accepts optional `configuration`. Existing callers remain valid. Template placement roles accept optional validated `configuration`; old schema-1 templates remain valid. Capture can take a third argument containing configurations keyed by placement ID. Supply `currentConfigurations` to the template mount to capture these preferences.

Schema 2 adds a singleton preference row and placement metadata in the same injected SQLite database, preserving schema-1 data. Settings are bounded to 16,384 historical placement IDs and contain only text scale and content presentation. They deliberately have no cascading placement foreign key: engine undo reconstructs placements by deleting/reinserting stable IDs. Detached settings remain recoverable for undo; they do not expose content or prevent canonical resource deletion. Access requires a currently authorized canonical placement and subject. Unsupported manifest versions remain stored and report an unavailable configuration state.

## Renderer integration

Mount `mountBlockLibrary` in the existing contextual Add surface and `mountWorkspaceTemplates` in New Workspace. Connect all released optional methods to expose attachment, favorites/recent use, and configuration. Older hosts show explicit unavailable states. Search includes names, categories, descriptions, resource kinds and controls. Previews are inert synthetic examples and never call a provider or read canonical resources.

In the existing block inspector mount `mountBlockConfiguration`. Apply saved/current preferences with `applyBlockConfiguration(article, configuration)` after decorating the existing article. It changes DOM presentation in place and retains textarea identity, selection and scroll. Import the module CSS once. Geometry continues through the workspace engine. The configuration module owns no animation timer or GPU context.

Template management includes duplicate, metadata/category editing, shape/geometry and organization editing, versioned update from the current workspace with explicit resource bindings, and archival removal. Editing/deleting a template does not rewrite an existing workspace. Preview and apply keep their existing access/version checks and canonical atomic behavior.

## Acceptance boundary

The native `workspaceFromResources` action accepts `{commandId,title,projectId,expectedProjectVersion?,resources:[{resourceId,expectedVersion}],organization?}`. The parent binds versions from the reviewed canonical plan; model text cannot supply effective grants. `previewWorkspaceFromResources` performs no writes. Execution revalidates inside the existing canonical transaction and invokes the same private placement pipeline as template application, with no transient fake template row. It returns `{createdWorkspaceId,resourceIds,placementIds,receipt:{commandId,operation,workspaceId}}`. Repeating an identical command returns that receipt; altered input conflicts. Resource IDs stay unchanged and no provider turn or task completion is inferred.

Template body schema 2 additionally supports explicit subject placements: `{subjectBinding:{mode:'reference',subject}}` or `{subjectBinding:{mode:'project-context',view:'project'|'resource-query',query?,kinds?}}`. Schema-1 resource-role templates remain supported. Capture requires an explicit subject-binding choice for each such placement. Context roles bind to the target project; a project overview requires a non-null project. The adapter's optional `authorizeSubject(subject,workspaceId?)` plus the engine's `allowSubjectAttachment` are required effective host grants. New library metadata schema 3 retains subject presentation settings by placement ID through undo/restart, with the same bounded retention as resource placement settings. Subject views create no resource row.

The focused suite covers the actual SQLite/kernel/engine/DesktopState adapter, attachment scope and identity, independent settings, undo/redo, schema upgrade and restart, and capability honesty. Type checking covers browser and native modules. These checks do not establish that the native host has wired the ports, that the visual design has owner acceptance, or that an actual Vela model interpreted a construction request. Combined desktop journeys, graphics recovery and renderer performance require the integrated host.
