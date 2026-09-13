# BuyrWorld Visual Acceptance Checklist

Use this checklist before declaring any visual phase complete.

## Safety

- [ ] Root `CLAUDE.md` rules were followed.
- [ ] Existing routes still work.
- [ ] Existing onclick handlers / DOM IDs required by application logic still work.
- [ ] No calculation logic was moved into presentation code.
- [ ] No AI-generated commercial figures were introduced.
- [ ] No fake production data was presented as real.
- [ ] Existing security protections remain intact.
- [ ] Existing tests pass.
- [ ] HTML / JS verification passes.
- [ ] Div balance / structure checks pass where applicable.

## Design system

- [ ] New work uses shared tokens rather than isolated hard-coded styling where practical.
- [ ] Typography hierarchy is consistent.
- [ ] Panel radius, borders and spacing are consistent.
- [ ] Primary, secondary and text actions are visually distinct.
- [ ] Status chips use a shared system.
- [ ] Lime is used selectively.
- [ ] Red/amber/green semantics are consistent.
- [ ] No status relies on colour alone.

## Layout

- [ ] The primary action is obvious.
- [ ] Important commercial figures are visually prioritised.
- [ ] Information density is high but readable.
- [ ] No large marketing-style dead space exists inside the workspace.
- [ ] Cards align to a clear grid.
- [ ] Tables remain usable at realistic widths.
- [ ] Empty states are intentional rather than broken-looking.

## Product integrity

- [ ] Every new dashboard card maps to a real capability, fixture or clearly labelled demo.
- [ ] No fake enterprise control has been added purely for appearance.
- [ ] User-facing terms are procurement-relevant.
- [ ] Arbitrary AI scores are not introduced where meaningful commercial measures exist.
- [ ] Evidence / assumption / provenance states remain visible where relevant.

## Responsiveness

- [ ] Desktop works at common laptop widths.
- [ ] Tablet layout is usable.
- [ ] Mobile does not merely shrink the desktop UI.
- [ ] Sidebar/navigation has a usable smaller-screen behaviour.
- [ ] Data-heavy content can scroll or reflow safely.

## Accessibility

- [ ] Keyboard focus is visible.
- [ ] Contrast is adequate.
- [ ] Buttons remain semantic buttons.
- [ ] Text is readable without zoom.
- [ ] Motion remains restrained and reduced-motion behaviour is respected.

## Visual quality

- [ ] The result feels like procurement software, not a marketing site.
- [ ] It feels achievable and coherent rather than concept-art-like.
- [ ] The target reference informed hierarchy and density without being copied literally.
- [ ] The visual result is consistent with BuyrWorld's dark + lime brand.
- [ ] A procurement leader could plausibly use the interface in a real commercial meeting.

## Before commit

Claude should provide:

1. Files changed.
2. What visually changed.
3. What functionality was deliberately not changed.
4. Tests/verification run.
5. Known limitations.
6. Screens/areas that should be manually checked in a browser.
