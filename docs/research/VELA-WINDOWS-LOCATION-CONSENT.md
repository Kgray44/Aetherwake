# Windows location and weather consent repair

Source review: 2026-11-04. Implementation qualification remains separate from actual user consent on the installed Windows host.

The earlier `local-weather.mts` used `GeoCoordinateWatcher.TryStart(true, fiveSeconds)`. Its `true` argument suppressed the permission prompt, it ran under PowerShell rather than Aerynth, and it accepted fixes up to fifteen minutes old. Every ordinary weather request was represented as a new reviewed plan. These behaviors did not satisfy remembered permission or question-time location.

Microsoft documents `Geolocator.RequestAccessAsync` as the genuine OS consent operation: call it from the foreground application's UI thread, before requesting location. Windows decides whether consent UI is needed; its decision is remembered and cannot be overridden by application consent. The current WinUI 3 guidance explicitly states that unpackaged applications do not need a location manifest capability, although they still need this access request. The Windows desktop API compatibility guidance cautions that some Request-pattern APIs depend on CoreWindow. Consequently this implementation does not promise an OS dialog on every host/build or require MSIX identity without evidence. It calls the supported API in the actual native host and reports failures honestly.

The fixed source-bound Node-API adapter runs `RequestAccessAsync` on Electron's main STA/UI thread only after verifying that its native HWND belongs to the current process and thread and is the foreground window. It neither starts a helper permission process nor imitates a Windows permission prompt. It then requests `GetGeopositionAsync` with zero maximum cache age and a twelve-second timeout. Actual coordinate timestamps must be at or after the user's question. Default/unknown and IP-address positions are rejected. The host never calls `AllowFallbackToConsentlessPositions`, scans Wi-Fi, or calls an IP geolocation service.

A separate, explicitly labeled Aerynth purpose permission covers sharing an approximate point with the US National Weather Service. SQLite stores only its unknown/allow/deny decision, version and change time. Grant and denial survive restart. A current versioned grant is checked before location and each network request; revocation aborts pending network work. Each question obtains a fresh position. Coordinates are transient; the canonical answer retains only the observation timestamp, NWS provenance and shared precision. The point sent to NWS is rounded to two decimal places. No location is sent to an inference provider. Routine weather produces a direct canonical answer or a brief truthful inability, without a plan.

Permission controls offer the fixed Windows Settings URI `ms-settings:privacy-location` as an explicit user action. Windows policy remains authoritative. An unavailable fresh position is never silently replaced with a saved location, a default city or IP geolocation. A city-based forecast, if later implemented, requires explicit user input and clear labeling.

Battery status uses `GetSystemPowerStatus` in the same native addon. Sentinel values (255 percentage/status; 0xffffffff lifetime), an absent battery and unknown charging state stay unknown; no remaining duration is invented. Battery reads extend the existing `readLocalFact` schema rather than adding another tool.

Primary references:

- [Geolocator.RequestAccessAsync](https://learn.microsoft.com/en-us/uwp/api/windows.devices.geolocation.geolocator.requestaccessasync?view=winrt-26100)
- [Get the user's location, Windows App SDK](https://learn.microsoft.com/en-us/windows/apps/develop/maps-and-location/get-location)
- [Changes to API behavior for Wi-Fi access and location](https://learn.microsoft.com/en-us/windows/win32/nativewifi/wi-fi-access-location-changes)
- [Windows Runtime APIs unsupported in desktop apps](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/desktop-to-uwp-supported-api)
- [Windows location service and privacy](https://support.microsoft.com/en-us/windows/privacy/windows-location-service-and-privacy)
- [GetGeopositionAsync maximumAge/timeout](https://learn.microsoft.com/en-us/uwp/api/windows.devices.geolocation.geolocator.getgeopositionasync)
- [SYSTEM_POWER_STATUS](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-system_power_status)
- [Electron systemPreferences](https://www.electronjs.org/docs/latest/api/system-preferences) documents media permission APIs, not a Windows geolocation consent API; no renderer geolocation substitution is used.

Evidence to date: actual MSVC compilation; addon load in Node and Electron's Node mode; invalid HWND rejection before OS access; real offline power-status read; synthetic native broker/protocol and actual Core/SQLite restart tests for A→B fresh positions, stale-fix rejection, remembered denial, and revocation before egress. Actual Windows consent UI and real-location/NWS qualification have not been run. The open user review app was not manipulated.
