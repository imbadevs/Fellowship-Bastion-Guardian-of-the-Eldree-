# Fellowship Bastion: Guardian of the Eldree

## Inspiration

Merge games and tower defense both ask the same question — *what do you do with
limited space?* — but almost nobody makes the merge **load-bearing**. It's
usually bolted onto an idle loop. We wanted the opposite: a defense game with no
upgrade menu and no research tree, where the only way to get a stronger tower is
to drag two towers together.

Portrait mobile, one thumb, was the other constraint. It ruled out the usual
build panels and context menus, and forced a better answer: every action is the
same gesture, and the *drop target* is the decision.

## What it does

A sacred tree — the Eldree — stands at the centre of a hex bastion, and the
Shadow Army attacks from every direction at once. You draft three building cards
between waves and place them on a board that is deliberately too small.

- **Press and hold a Construct, then drop it.** Empty tile moves it, matching
  Construct merges it, recycle icon sells it. That's the whole interface.
- **Every fifth wave is a hard wave.** Hold it and the bastion unlocks another
  ring — 19 tiles to 127 across a run — and the Eldree grows with it.
- **The horde forces variety.** Trolls are armoured and only magic answers them;
  Wraiths shrug off magic and fly straight past your perimeter.
- **Spreading thin loses.** Wave 25 takes 45 cheap towers — or 8 merged ones.

## How we built it

three.js + TypeScript + Vite. No engine, no art pipeline; every mesh is
procedural.

The decision that paid off repeatedly: **`src/sim/` never imports three.js.** The
simulation is headless and fixed-step, so we could drive thousands of seeded
waves from the console with no renderer attached — which is how nearly all the
balance work got done.

Everything repeated is instanced: the 127-tile board is one mesh, and a full
board mid-wave renders in single-digit draw calls against a 60-call budget. The
radial cooldown ring is a small custom shader, since a per-instance arc can't be
geometry — which made it cheaper than the bar it replaced.

## Challenges we ran into

**A wave that could never end.** A spawn tally sat on the wrong side of a
"pool full" guard, so an exhausted entity pool left the wave counter stuck above
zero forever — no enemies left, no way to finish. Unwinnable and unloseable.

**An anti-frustration fix that deleted a mechanic.** Enemies used to grind on a
wall for 86 seconds, so we time-boxed them to 5. Combined with building armour,
that meant one Orc's entire attack removed 4% of a tower. Buildings became
indestructible and nobody noticed for weeks.

**Upgrading was a downgrade.** A tier-3 turret put out 53.8 DPS where the four
towers merged into it put out 75.6 — the core mechanic of the game was
mathematically the wrong play.

**The counter system said the opposite of what it did.** Tooltips promised the
Ballista punished armoured Trolls and the Rune Ward caught Wraiths; the maths
said both were each tower's *worst* matchup. Underneath sat a real bug — the
magic damage type was assigned by checking a tier-1 id, so merging silently
turned the game's only magic line physical.

**Packaging to the rules.** The build had to be one zip with all our own code
readable inside `index.html`, libraries in `vendor/`, and no network access —
close to the opposite of what a normal bundler emits. three.js ships ESM-only,
so we bundle it into a classic script: that keeps it out of `index.html` as
required, and it also means the game runs when opened straight off disk.

## Accomplishments that we're proud of

**We stopped guessing at balance.** A headless harness answers one question —
*what is the fewest tiles needed to hold this wave?* — which turned every
balance argument into a number. Wave 25 needs 45 tier-1 towers, 16 tier-2, or 8
tier-3.

**The counters actually bite.** Same 20 tiles at wave 15: a board with both
damage types held 128/128, physical-only lost at 104, magic-only at 72.
Coverage beats size.

**One gesture, three outcomes.** Move, merge and sell collapsed into a single
press-and-hold drag — and a quick drag from the same tile still pans the camera.

**We closed our own loose end.** The Shrine line had shipped for weeks as three
tiers of building whose promise — mending the garrison — nothing in the code
read. It heals for real now: 8, 18 and 38 hp/s across an aura, units only.

## What we learned

- **Flavour text and mechanics drift apart silently, and players believe the
  text.** Nothing errors; the game just teaches the wrong strategy.
- **Fixing frustration can amputate a mechanic.** A fix that changes a *rate*
  needs whatever it throttles re-measured afterward.
- **"Is this balanced?" is unanswerable; "how many tiles does this wave need?"
  is not.** Make the question measurable and the argument dissolves.

## What's next for Fellowship Bastion: Guardian of the Eldree

**Roguelike buff drafting — pick 1 of 3 on level up.** The biggest one. Right
now every run of the game plays the same way, and the only choices are which
towers to buy and where to merge them. Levelling up into a choice of three buff
cards makes each run diverge: take the card that boosts magic damage and you
have committed to answering Trolls, take the one that widens shrine auras and
you are building a sustain board. It turns a fixed difficulty ladder into a
series of decisions with consequences that compound.

The architecture is already waiting for it: every unit's effective stats resolve
in exactly one place, so a buff is a modifier applied at that single choke point
rather than a change threaded through the combat code. The card draft itself can
reuse the shop's existing weighted-rarity draw.

**Social play, and asynchronous PvP.** The seeded, fixed-step simulation is
what makes this cheap rather than a rewrite: a run reproduces exactly from its
seed plus the player's placements, so a friend's defence can be replayed rather
than streamed live, and nothing needs an authoritative server to agree on what
happened. That opens a shared daily seed with a leaderboard — everyone facing an
identical horde, so the comparison is about decisions rather than draw luck —
and asynchronous PvP, where you send a wave of your own composing at someone
else's bastion and watch it break, or not, against the board they built.

- **An authored late-game arc.** Waves 1–10 are hand-tuned; past that is a
  scaling formula. It works, but a designed climax beats a curve.
- **Repair.** Now that towers actually die, patching a wall would make position
  worth defending.
- **Audio.** The one obvious sense the game does not use yet.
