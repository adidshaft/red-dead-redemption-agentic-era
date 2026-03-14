# Claude Cross-Check Prompts

These prompts are designed so Claude can critique the game in focused passes instead of responding with vague design praise.

## Prompt 1: Gameplay Readability

```text
You are reviewing a live web game repo called "Red Dead Redemption: Agentic Era".

I do NOT want generic praise. I want a critique focused on gameplay readability and player comprehension.

Please review the game as if you are a principal game designer and UX lead.

Focus only on:
1. whether a new player understands where they are,
2. whether they can identify their own rider instantly,
3. whether they understand what to do during a match,
4. whether the arena feedback is visual enough instead of text-heavy,
5. where confusion still exists in the current HUD and live loop.

Output format:
- Top 10 clarity issues ordered by severity
- For each issue:
  - why it harms the match
  - what exact UX/game fix you would make
  - whether it is a small patch or a structural redesign
- End with a “minimum high-impact patch set” containing the best next 5 changes

Do not drift into backend or blockchain architecture unless it directly affects player clarity.
```

## Prompt 2: Combat Feel

```text
Review this game like a combat designer.

I want a harsh, honest assessment of whether the current fighting feels satisfying enough.

Focus on:
1. shot feel
2. dodge feel
3. reload tension
4. hit confirmation
5. elimination payoff
6. pressure states
7. pacing of quiet vs intense moments

Assume the game is a lightweight browser game, so recommendations should be practical for a Next.js + Phaser stack.

Output:
- 8 biggest combat-feel weaknesses
- 8 concrete changes that would make the game feel more premium and addictive
- A recommended order of implementation from easiest/highest impact to hardest/highest payoff
```

## Prompt 3: Agentic Fantasy

```text
Review this game specifically through the lens of “agent fantasy”.

The goal is for the player to feel like they own frontier agents that can think, fight, improve, and compound their own story.

Focus on:
1. whether Autopilot feels alive or merely automated
2. whether rider doctrines are distinct enough
3. whether agent progression feels personal
4. whether the x402 premium lane feels meaningful
5. how to make riders feel like characters with identity, not just loadouts

Output:
- biggest gaps in the current agent fantasy
- 10 ways to make autonomous riders feel more alive
- 5 UI changes
- 5 gameplay/system changes
- 5 progression/narrative changes

Keep suggestions practical for the current codebase.
```

## Prompt 4: Map / World Direction

```text
Review the current Dust Circuit map and propose the best evolution path.

I want you to decide whether the game should:
1. stay 2D/2.5D and become much more polished,
2. move toward faux-3D / isometric depth,
3. or eventually pursue light 3D.

Important:
- Be realistic about implementation cost and browser performance.
- Prioritize making the game actually better to play, not just visually impressive in screenshots.

Output:
- recommendation: 2.5D polish vs faux-3D vs real 3D
- why
- tradeoffs
- best visual direction for the next 3 iterations
- 3 new map concepts that fit the frontier + agentic + onchain theme
- what should change in landmarks, cover lanes, and objective routing per map
```

## Prompt 5: Addictive Loop / Retention Pressure

```text
Review this game as if your only goal is to make players want “one more run”.

Do not suggest manipulative dark patterns. Focus on strong game loops, anticipation, progression, and meaningful payoff.

Focus on:
1. match-to-match progression
2. streaks
3. payout anticipation
4. post-match reward framing
5. rider identity growth
6. reasons to try another run immediately

Output:
- current retention weaknesses
- best 12 ideas to increase “one more run” pressure
- split them into:
  - immediate UI hooks
  - mid-term system hooks
  - bigger feature hooks
- identify the top 3 that would most improve this specific game
```

## How To Use These

Recommended order:
1. Prompt 1
2. Prompt 2
3. Prompt 3
4. Prompt 4
5. Prompt 5

Best workflow:
- Run one prompt at a time.
- Ask Claude to be critical and concrete.
- Paste the response back into this repo thread.
- Then merge the strongest ideas into implementation instead of trying to follow every suggestion blindly.
