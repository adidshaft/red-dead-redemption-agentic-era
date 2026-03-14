# Claude Cross-Check Results

Date: March 15, 2026 IST

These notes summarize four focused Claude CLI review passes run against the current direction of the game.

## What Claude Agreed With

- The game should stay **polished 2.5D** for now.
- The current highest-value work is **moment-to-moment readability and combat feel**, not a jump to full 3D.
- The player still needs stronger help understanding:
  - what the ring does
  - what a bounty means
  - why the stagecoach matters
  - where cover is
  - which riders are autonomous
- The autonomous/agentic fantasy is strong in concept, but it needs more **personality, live expression, and consequence**.

## Cross-Check 1: Gameplay Readability

Claude’s main criticisms:
- Ring danger is not loud enough when it becomes lethal.
- Bounty targeting still risks feeling like an arbitrary highlight.
- Stagecoach arrival needs a stronger spawn signal.
- Cover needs to read more clearly as cover instead of just scenery.
- Score and payout should be visually separated more clearly.
- Autonomous riders need clearer identity markers.

Best fixes:
- Add a stronger first-time ring warning with a visible countdown cue.
- Give bounty a more explicit icon/treatment than color alone.
- Add a stagecoach horn/banner/minimap ping on spawn.
- Improve cover affordance with clearer local feedback.
- Split ranking score from economy/payout visually.
- Make autonomous riders more visibly distinct in-match.

## Cross-Check 2: Combat Feel

Claude’s strongest recommendations:
- Add stronger shot punch on fire.
- Add clearer hit confirmation.
- Make dodge invulnerability/readability more obvious.
- Add a visible reload progress cue.
- Make eliminations feel more consequential.
- Increase ring pressure through audio and environmental feedback.

Best fixes for the current stack:
- Small camera shake and flash on firing.
- Target flash plus floating damage numbers on hit.
- Stronger dodge flash/i-frame readability.
- Radial reload ring around the rider.
- Bigger elimination beat with dust burst and brief time slowdown.
- Low-frequency storm pressure cue as the ring tightens.

## Cross-Check 3: Agentic Fantasy

Claude’s most useful ideas:
- Riders need more visible emotional/personality signatures.
- Autopilot should feel like “someone with intent,” not just automation.
- Progression should create identity, not only better stats.

Best ideas to adapt:
- Give riders short live intent lines rather than long planner copy.
- Let doctrines drift or specialize more visibly through play.
- Add rival memory or simple feud behavior.
- Give riders earned narrative tags like `Drop Hunter` or `Ring Survivor`.
- Turn campaign history into something the player feels, not only reads.

## Cross-Check 4: World Direction

Claude’s recommendation:
- Stay with **polished 2.5D**.

Why:
- Phaser is strongest there.
- It preserves readability for ring, cover, and objective fights.
- It keeps web performance headroom for particles, HUD, and live systems.
- It lets the project grow by adding maps and visual polish instead of re-platforming.

Map concepts Claude proposed:
- `Deadrock Gulch`
- `Perdition Flats`
- `Ironveil Pass`

## Merged Direction

The strongest shared conclusion between the current audit and Claude’s reviews is:

1. Do **not** chase real 3D yet.
2. Make Dust Circuit feel premium first.
3. Prioritize:
   - objective signaling
   - combat impact
   - cover readability
   - rider identity in live play
   - autonomous personality
4. Add new maps only after the current loop feels strong enough to deserve them.

## Recommended Next Sprint

1. Ring / bounty / stagecoach signal pass
- stronger banners, icons, and first-time comprehension cues

2. Combat impact pass
- hit markers, damage numbers, reload ring, elimination payoff, ring pressure audio

3. Agent personality pass
- live doctrine flavor, short intent calls, clearer autonomous rider identity

4. Cover readability pass
- stronger cover affordance and local tactical feedback

5. Map expansion prep
- keep Dust Circuit as the benchmark, then add `Deadrock Gulch` as the next map
