# Aerynth functional review

This Electron review integrates the Cinematic V3.5 environment with the existing SQLite resource kernel, Workspace Engine, Constellation navigation, connected-conversation history, and native Codex App Server bridge. It is an implementation milestone, not production or owner acceptance.

## Launch

Use Node 24.18 or newer. From this directory:

```powershell
npm ci
npm start
```

On this prepared checkout, `Aerynth.cmd` at the repository root builds and opens the application. The shell selection remains experimental; this milestone does not ratify Electron as the final platform.

## Use

- **Workspaces** or **Ctrl+K** opens the temporary project/workspace manager. Projects are organizational contexts; workspaces have independent persistent layouts. An independent conversation needs no project or task.
- **Add** creates conversations, notes, research/document surfaces, local tasks, references, and Intelligence Stream viewers. Local tasks have durable open/completed state; automated execution is unavailable.
- **Resources** attaches an existing canonical resource. Multiple blocks can reference the same object. Removing a block preserves its resource and other placements.
- Drag a block by its grip. **Alt+arrows** moves it with the keyboard. The resize handle and **Properties** provide geometry, shape and layer controls. **Layout** exposes undo, checkpoints, restore and a list for locating offscreen blocks.
- Notes and documents save locally after editing. Conversations save user messages locally; ordinary model responses and ChatGPT account-history access are unavailable in this build.
- Choose **Codex** while creating a conversation to use the installed App Server. **Send** previews the exact message in a native authorization dialog. This review requests a read-only sandbox and denies tool/file approval requests. Opening, moving, focusing or navigating a block never starts a turn.
- **Constellation** zooms from the current workspace through project and Universe views. Destinations are canonical backend objects. Search and direct workspace switching remain available without spatial navigation. Workspace archiving removes a destination while retaining recoverable layout/resource data; the manager can restore it.
- Scene controls retain graphics tiers, Quiet and reduced motion. Local work remains available when the provider or graphics connection fails.

## Data and recovery

Normal Windows launches store the SQLite database under `%APPDATA%\Aerynth\review`, outside the public source checkout. This uses the operating system's user-profile storage boundary; it is not a claim of application-level encryption. Credentials remain managed by the installed Codex provider and are never sent to the renderer.

The desktop extension and Workspace Engine use versioned transactions in the same SQLite database. Earlier review layout history/checkpoints are migrated and retained, without resetting canonical resources. Back up `aerynth.sqlite` while the application is closed. A schema/storage failure stops the service and reports an error; it does not replace the database.

The host admits bounded writes through the Windows ReserveGuard and rechecks every four minutes. It suspends new writes/turns if admission fails. This is an instruction/monitoring guard, not an OS quota; unrelated applications and writers that have not loaded the rule remain outside its coverage.

## Verification boundaries

The native application driver uses real UI controls and native mouse input against this desktop host. Source hashes and build-asset hashes bind its receipts to the running candidate. Synthetic verification profiles and recordings remain outside normal user data.

`npm run verify:application` runs the offline functional journey. The host also has bounded `--integration-live` and `--integration-benchmark` verification modes. Live mode authorizes only its exact synthetic no-tools prompt; ordinary launches always use the native authorization dialog. Routine tests do not spend inference.

Renderer callback/draw intervals are not monitor-presented frame timing. Screenshots, functional assertions, fixture performance and owner artistic acceptance are separate evidence classes. The active material-continuity, movable-Vela and complete cross-project native acceptance work must be verified in the combined application before final acceptance.
