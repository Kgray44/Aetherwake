# Released native Block Library bootstrap

`BackendCore` constructs `TemplateService` with `createCanonicalTemplateHost`, the existing canonical SQLite/kernel/graph transaction, and **the exact engine returned by `DesktopState.nativeBlockServices()`**. It creates no second engine, composition pipeline, resource store or provider executor. The released library owns workspace/template/block implementation; Core supplies actual local-owner grants and canonical resource factories/mappings.

The trusted local-owner policy admits active canonical resources/projects/workspaces whose owning project is active. The released adapter also enforces target-project/reference ownership and version fences. Non-resource subject policy validates the actual tagged project/collection/query reference, active source ownership, and target workspace project; it is passed to both the released adapter and the same engine's `allowSubjectAttachment`. No renderer-supplied grant or arbitrary callback registration is accepted.

## Typed public family

`command('library', {name,input})` has an explicit switch and a `LibraryRequest` union. There is no reflective method invocation. Inputs are the released `TemplateService` signatures:

| Name | Input |
|---|---|
| capabilities, preferences | `{}` |
| getTemplate, getBlockSettings | ID string |
| listTemplates | `{query?,includeArchived?}` |
| createBlock, attachBlock, findResources, configureBlock, setFavorite | Released typed input |
| saveTemplate, renameTemplate, archiveTemplate | Released typed input |
| previewTemplate, applyTemplate | `TemplateApplyInput` |
| previewWorkspaceFromResources, workspaceFromResources | `WorkspaceFromResourcesInput` |
| requestVelaTemplate | `VelaTemplateRequest`; unavailable until a typed real template planner is registered |

Every response is `{result,desktop?}`. `result` is the **exact released service DTO/receipt**. Mutations additionally return the canonical `DesktopSnapshot` after the full transaction and navigation commit; the renderer's port adapter unwraps `result` and applies `desktop` when present. Template preview/capture does not start inference or read/copy conversation content. Renderer-origin saved templates cannot claim `source:'vela'` or model provenance; that needs a future verified native template planning path.

Local conversation block creation uses the true canonical `local` conversation graph/resource mapping without a model or execution. Notes/research/tasks/groups/reference/stream resources use the current canonical resource factory and `desktop_resources` kind mapping; placement remains an independent released library operation. The actual parent `atomic` rolls back both SQLite and graph/resource mappings if any released operation fails.

## Vela released actions

Bootstrap registers `workspaceFromResources`, resource creation with a workspace, attachment and structured presets through the actual released library/DesktopState bridge. Vela's paired resource/project/workspace freshness tokens are checked first, then translated to real canonical entity/layout versions for the released operation. Reviewed input `projectId:null` is never silently rewritten.

`workspaceFromResources` calls the released `TemplateService.workspaceFromResources` directly with exact selected canonical resource IDs and raw canonical versions. Its complete returned receipt is retained unchanged in `block_library_receipts`; Vela's host receipt ID points to that exact command receipt and its created workspace ID. No transient fake template is saved. Repeating the Vela plan does not duplicate resources/placements. Source conversation IDs, message histories and note identities remain intact.

Quiet presence remains engine-owned and separate from templates. Tests verify the existing `system:vela` presence remains 208×260 at scale .65; this adapter adds no motion/visibility override.

## Verification boundary

Focused real-SQLite library + existing Vela backend regressions: **12/12 passed**, 3722.7372 ms reported duration. They cover actual released workspace creation and exact receipt, identity/history preservation, local conversation mapping, template capture, preferences/configuration/restart, cross-project/stale/archive denial and canonical graph rollback after a failed factory.

The combined backend typecheck reports the already identified Universal subject-arm issues in `desktop.mts:297` and `desktop.test.mts:169`; no new Core/contracts diagnostics were reported. The Universal/Desktop owner is supplying those tagged-union fixes. This commit does not edit those owned files or claim the combined typecheck passed.

No actual Codex/model turn, native application window or network request ran. Parent owns public IPC admissions/view mounting/native policy review and combined/live acceptance. Notes recovery and explicit Vela project-context enrichment are subsequent bounded integration steps.
