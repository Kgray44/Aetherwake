# Aerynth functional review

This Electron review integrates the Cinematic V3.5 environment with the existing SQLite resource kernel, Workspace Engine, Constellation navigation, connected-conversation history, and native Codex App Server bridge. It is an implementation milestone, not production or owner acceptance.

## Launch

Use Windows x64, Node 24.18 or newer, npm, and Visual Studio C++ Build Tools with a Windows SDK. Vite builds the native Windows system helper and bundles document extraction from Block Library dependencies. The desktop host requires the installed AeroStorageWatch ReserveGuard under `%LOCALAPPDATA%`. Budget the checkout, npm cache, temporary directories and private profile on their actual drives before starting.

From the repository root:

```powershell
npm --prefix prototypes/openai-provider ci --ignore-scripts --no-audit --no-fund
npm --prefix prototypes/block-library ci --ignore-scripts --no-audit --no-fund
npm --prefix prototypes/constellation ci --ignore-scripts --no-audit --no-fund
npm --prefix prototypes/visual-experience/cinematic-v3 ci --no-audit --no-fund
npm --prefix prototypes/visual-experience/cinematic-v3 start
```

Allow the app package install scripts to provision the Electron executable. After dependencies are installed, `Aerynth.cmd` also builds and opens the connected desktop. Final platform selection remains open.

## Use

- The workspace name beside the logo, or **Ctrl+K** from a working workspace, opens the temporary project/workspace manager. Projects are organizational contexts; workspaces have independent persistent layouts. An independent conversation needs no project or task.
- **Add** creates conversations, notes, research/document surfaces, local tasks, task groups, references, and Intelligence Stream viewers. Task groups reference existing canonical tasks through explicit membership relationships; their controls update those same tasks. Manual tasks have durable open/completed state. Scoped mission execution is a separate Vela flow with its own review.
- **Resources** attaches an existing canonical resource. Multiple blocks can reference the same object. Removing a block preserves its resource and other placements.
- Drag a block directly by its title or noninteractive card surface. **Alt+arrows** moves it with the keyboard; drag any edge or corner to resize. Contextual card settings provide supported shape, geometry, lock, grid-span and layer controls. **Workspace actions** (the ellipsis beside the layout modes) opens history, checkpoints, offscreen block access and **Locate Vela**.
- **Fluid** is the default. It previews nearby placements making room and commits one undoable layout. **Freeform** permits intentional overlap and leaves neighbors stationary. **Structured** uses aligned variable spans, order, configurable spacing and four initial arrangements. Mode changes and checkpoints retain recoverable geometry and configuration. Merely reopening a legacy workspace preserves its raw saved arrangement.
- Drag Vela directly, or focus her and use **Alt+arrows**. Her independent `system:vela` placement is persisted per workspace. Project and Universe overviews automatically move her to the upper right without changing that saved placement. **Bring All Into View** fits the camera without rewriting resource geometry; pan and zoom are also stored per workspace.
- Notes and documents save locally after editing. **Read** and **Document actions** provide reading, find and rename controls. Conversation cards open the same searchable history, organization and Connected Branches interface. Local messages and drafts persist. Eligible, connected and authorized ChatGPT plan Responses can use Aerynth local conversation history. ChatGPT account history and memory are not synchronized.
- Choose **Codex** while creating a conversation to use the installed App Server. **Send** previews the exact message in a native authorization dialog. This review requests a read-only sandbox and denies tool/file approval requests. Opening, moving, focusing or navigating a block never starts a turn.
- **Constellation** zooms from the current workspace through project and Universe views. Destinations are canonical backend objects. Search and direct workspace switching remain available without spatial navigation. Workspace archiving removes a destination while retaining recoverable layout/resource data; the manager can restore it.
- Scene controls retain graphics tiers, Quiet and reduced motion. Local work remains available when the provider or graphics connection fails.

## Data and recovery

Normal Windows launches store the SQLite database under `%APPDATA%\Aerynth\review`, outside the public source checkout. The application stores unencrypted SQLite files behind the operating system's user-profile boundary. The installed Codex provider manages its own credentials. Native account and API connection flows expose scoped status to the main application renderer.

The desktop extension and Workspace Engine use versioned transactions in the same SQLite database. Earlier review layout history/checkpoints are migrated and retained, without resetting canonical resources. Back up `aerynth.sqlite` while the application is closed. A schema/storage failure stops the service and reports an error; it does not replace the database.

The host admits bounded writes through the Windows ReserveGuard and rechecks every four minutes. It suspends new writes and turns if admission fails. The guard monitors admitted operations. Operating-system enforcement and unrelated writers are outside its coverage.

## Verification boundaries

The native application driver uses real UI controls and native mouse input against this desktop host. Source hashes and build-asset hashes bind its receipts to the running candidate. Synthetic verification profiles and recordings remain outside normal user data.

`npm run verify:application` builds the actual application, prepares finite synthetic canonical workspaces in a fresh external profile, runs the combined desktop journey, and verifies the same source/profile after restart. The launcher bounds the desktop stages, requires explicit passing receipts, and stops its own process tree on failure or focus loss. It opens a real desktop window and should be invoked only when desktop verification is wanted. Raw native verification flags require an explicit absolute `--profile=`. The host also has bounded `--integration-benchmark`, `--integration-constellation` and `--integration-organization` verification modes. Use fresh external `--profile=` directories for initial journeys and the same profile with `--verify-restore` for the corresponding restart check. Constellation and organization modes capture the exact application window without audio. A live provider journey requires a separately authorized send through the standard native review. The old `--integration-live` flag exits with `use_standard_conversation_review`. The offline runner issues zero provider calls.

At earlier source checkpoints, the combined application's two-project Constellation baseline has passed actual native movement/editing, exact return, dynamic workspace create/archive, reduced-motion navigation, real WebGL recovery, and a fresh-process persistence check. The three-mode native journey also passed real pointer and keyboard operations, live neighbor previews, Vela movement/resize, grid spans/reordering, checkpoints, cross-project return and fresh-process persistence. These journeys produced native screenshots and real window recordings. These historical journeys do not qualify every later source change. An earlier short visual smoke passed actual shader compilation, focused fresh-frame captures, unchanged canonical data and a 16px default note editor; broader spatial, custom-scale, motion and performance checks retain their separate acceptance status.

Renderer callback/draw intervals are not monitor-presented frame timing. Screenshots, functional assertions, fixture performance and owner artistic acceptance are separate evidence classes. Expanded three-project spatial organization, final visual review and performance qualification remain open until candidate-bound receipts demonstrate them.
