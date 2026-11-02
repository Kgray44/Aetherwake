# Continuous glass face glare correction

The existing real-application restore image revealed a broad near-white reflection across the resting note's heading and title. Removing the former opaque inner title/content rectangles exposed the physical face correctly, but its clearcoat could still overwhelm light text. The expanded reading film alone does not cover this resting state.

The optical and composite face materials now apply a soft shoulder to completed physical lighting, including clearcoat, before the renderer's existing tone mapping. Linear radiance at or below 0.025 is unchanged. Higher peaks rise continuously toward 0.065 rather than whitening the entire face; uniform RGB scaling retains the reflection's hue and spatial variation. This is an artistic, display-conscious response for content-bearing faces, not a claim of physically exact optical transmission. The same continuous face remains behind all content, without title, header or body rectangles.

The seven pooled materials remain stable. Only the face has the shader hook; its live uniform disables the shoulder in the engineered comparison. The separate curved bevel, perimeter optics, glass clearcoat parameters, shared architectural key, background, Vela and DOM typography are unchanged. No new texture, render target, pass or animation scheduler is introduced.

Focused CPU checks exercise the hook against the installed Three.js physical shader, its position after clearcoat accumulation and before tone mapping, separate-material isolation, and uniform/cache identity through study, kind and expansion changes. Existing material, geometry, compositing and Fluid visibility checks are retained. These checks do not compile the GLSL on a GPU or establish rendered contrast, motion quality, performance, or owner acceptance.

The five focused material/geometry/compositing suites pass 32/32 tests. All 64 workspace-engine tests, including the three situation-dependent Fluid entry cases, pass. Strict TypeScript checking and scoped formatting pass. No build or native capture was run for this source change.

This is a source-only correction for the Application Integration owner to evaluate at its next safe native checkpoint. No native window, input, screenshot, recording or build is run by this lane while that owner holds the shared desktop/GPU slot. A source-bound still of the resting note at the previously problematic lighting angle, plus expanded and other-contour checks, remains required before visual acceptance. Earlier saved images remain unchanged.
