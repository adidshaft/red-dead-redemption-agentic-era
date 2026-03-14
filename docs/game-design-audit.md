# Game Design Audit

Date: March 15, 2026 IST

This is the current product audit for `Red Dead Redemption: Agentic Era` after the latest queue, camera, autopilot, and live-objective passes.

## 1. First-Run Clarity

What is working:
- Wallet connect, sign-in, rider selection, and queue entry are much clearer than before.
- The arena now shows a live directive, queue progress, and a clearer right-now panel.
- The rider-follow camera and cyan `YOU` marker make the selected rider easier to find.

What still feels weak:
- A first-time player still has to infer too much about why they should chase one objective over another.
- The HUD explains the current situation, but it does not yet teach the deeper flow in a satisfying way.
- The game still depends on text more than a premium action game should.

Best next moves:
- Add a tiny first-run “mission strip” that only appears for the first 1-2 completed matches.
- Convert more instruction into motion, pings, highlight paths, and short in-world labels.
- Add an explicit “why this matters” chip for objective rewards and ring danger.

## 2. Combat Feel

What is working:
- Matches now have ring pressure, supply drops, bounty targets, stagecoach runs, cover, minimap, and event callouts.
- The selected rider is much easier to track than before.

What still feels weak:
- Shooting still needs more visceral feedback.
- Hit confirmation, misses, reload windows, and near-death moments can feel too soft.
- The current arena is readable, but it still does not feel “premium action game” enough.

Best next moves:
- Add richer muzzle flash, louder shot cadence, hit markers, and stronger elimination beats.
- Make reload and empty-chamber states far more dramatic.
- Add subtle camera impulse / chromatic shake / dust kick when the selected rider is under pressure.

## 3. Map Fantasy

What is working:
- The Dust Circuit has strong western theming and better frontier landmarks than earlier builds.
- Saloon, hotel, wash, stable, and corral already create readable lanes.

What still feels weak:
- It still reads like one arena rather than a believable frontier location with multiple destination-quality spaces.
- The current map is strong for a prototype, but not yet “I want to live here” strong.

Best next moves:
- Add at least 2 more map identities over time:
  - `Main Street Showdown`
  - `Canyon Rail Yard`
  - `Floodwash Gulch`
- Keep the current gameplay rules but swap the landmark graph, cover lanes, and color story.
- If 3D is pursued, do it carefully and only if it preserves combat readability.

Recommendation:
- Short term: make the current 2.5D arena excellent before chasing full 3D.
- Medium term: add multiple handcrafted maps with distinct lane logic and landmark identities.

## 4. Agentic Fantasy

What is working:
- Riders already feel more agentic than a normal PvP prototype because they carry doctrine, campaign ledger, premium lane, and autonomous decisioning.
- The Autopilot tab is now much easier to read.

What still feels weak:
- The player still doesn’t always feel the rider has a “personality” in the match.
- The economy loop is real, but the fantasy of “this agent has a life of its own” can go further.

Best next moves:
- Give each doctrine stronger live signatures:
  - Duelist: more aggressive duel callouts and challenge behavior
  - Scout: side-lane, flank, and supply-first behavior
  - Survivor: late-ring, cover-heavy endurance play
- Give riders short signature lines in the UI:
  - “Pushing the drop.”
  - “Rotating to cover.”
  - “Holding the bounty lane.”
- Let riders earn small narrative tags based on history:
  - `Drop Hunter`
  - `Ring Survivor`
  - `Ledger Climber`

## 5. One-More-Run Pressure

What is working:
- Campaign tiers, streaks, payout summaries, and replay CTAs are already in place.
- The game has the beginnings of a compounding loop.

What still feels weak:
- The current meta loop is informative, but not yet irresistible.
- The player should feel more tension around almost-winning, streak-saving, and unlocking the next version of their rider.

Best next moves:
- Add near-term hooks:
  - win streak bonus pressure
  - next-tier progress bar
  - “one more run unlocks X” beats
- Add cosmetic/map unlock bait:
  - alternate rider card frame
  - doctrine badge
  - map variant eligibility
- Add stronger result framing:
  - what the rider gained
  - what is now within reach
  - what the next run could unlock

## Direction Call

If we want the best return over the next few passes:

1. Make the current Dust Circuit feel premium before building a new engine direction.
2. Deepen combat feel and in-world feedback before adding much more text/system surface.
3. Add one more map only after the current match loop feels undeniably good.
4. Push the agent fantasy harder with doctrine personality, live intent, and progression identity.
5. Build “one more run” pressure into every result screen.
