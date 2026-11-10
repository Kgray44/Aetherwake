# A2.1 Windows native verification ledger

The native journeys ran on November 9, 2026 on Windows x64 with Node 24.18.0, lockfile Electron, the Windows native addon and an interactive desktop. The tested runtime revision was [`1c2b18b1dde9a6ca5b707dd6be7c224b692fa066`](https://github.com/Kgray44/Aetherwake/commit/1c2b18b1dde9a6ca5b707dd6be7c224b692fa066). Subsequent changes to this candidate are tests and documentation. The checkout, caches, temporary files, disposable profiles and receipts used the work drive. All application data was synthetic.

## Commands and results

| Command | Result | Private receipt identifier |
|---|---|---|
| `npm --prefix prototypes/integrated-backend run typecheck` | Passed | Shell result |
| `npm --prefix prototypes/visual-experience/cinematic-v3 run build` | Passed, including the Windows native system addon. Vite reported its chunk-size advisory. | Shell result |
| `npm --prefix prototypes/visual-experience/cinematic-v3 run verify:application` | First attempt passed typecheck, build and preparation. The journey aborted on `native_owner_window_inactive`, so restore did not run. | `review-expanded-application-1794281243556.runner-logs/runner.json` |
| `npm --prefix prototypes/visual-experience/cinematic-v3 run verify:application` | Fresh-profile retry passed all five stages. Initial journey had 12 checks over 23 steps. Same-profile restore had one check over two steps. Both renderer error counts were zero. | `review-expanded-application-1794281414642.runner-logs/runner.json` |
| `node --experimental-strip-types scripts/verify-living-instruments-native.mjs` | Passed 9 of 9 checks, including canonical planning edit/undo, Stream, timer and exact Timeline state on restart. Zero renderer errors. | `review-living-instruments-1794281282453/living-instruments-evidence/journey.json` |
| `node --experimental-strip-types scripts/verify-living-instruments-native.mjs --mission-only` | Passed 6 of 6 checks, including native Stream branches, dependency evidence, Timeline, and restored mission evidence and graph binding. Zero renderer errors. | `review-living-instruments-1794281512332/living-instruments-evidence/journey.json` |
| `node --experimental-strip-types scripts/verify-living-instruments-native.mjs --family-only` | Passed 5 of 5 checks, including authorized Note and Manual Task edits and exact canonical restart. Zero renderer errors. | `review-living-instruments-1794281523288/living-instruments-evidence/journey.json` |

The passing expanded journey opened the connected Electron renderer, prepared three projects, six workspaces and 39 typed resources, created a reviewed conversation branch with actual ancestry, saved an editor change, and verified exact original workspace geometry and identities. The same-profile restore retained pinned views, canonical branch and relationship. The source and renderer asset hashes matched across launch and restore. The observed runner exits were zero. A follow-up query found zero Electron or Node processes with the owned checkout executable or disposable profile paths.

The host reserve initially denied writes because the system drive was below 30 GiB. Hosted synthetic work proceeded during that denial. Once both drives were above the floor, the installed guard admitted bounded work before the clone, dependency installation, build and native runs. The application runner also checked each stage. The guard governs owned work on the host. It is not an OS quota and cannot stop unrelated applications, cloud tasks or writers that have not loaded the rule.

Live provider access, physical input, monitor presentation and artistic acceptance were outside these offline journeys. Raw profiles, captures, logs and machine paths stay in private evidence custody. The [application guide](../../prototypes/visual-experience/cinematic-v3/APPLICATION.md) documents the verification launchers.
