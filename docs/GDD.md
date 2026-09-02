# Fellowship Bastion: Guardian of the Eldree — GDD

A short design reference: what the game *is*, from a player's seat. For
implementation history and reasoning, see [PLAN.md](PLAN.md); for current
status and controls as shipped, see the [README](../README.md).

## Premise

The Eldree, the Sacred Tree, stands at the centre of a hex bastion. The
Shadow Army attacks from every direction, wave after wave. Between waves,
you draft and place Constructs to build a defence that can take the next
hit — and the one after that.

## Core loop

**Prep → Wave → Reward → Prep**, no scripted end:

1. **Prep.** The shop is docked at the bottom of the screen the whole time —
   never a modal, the board stays visible. Draft from 3 building cards,
   place what you can afford, reroll if the draw is wrong for you.
2. **Wave.** Tap **Begin Wave**. The board goes combat-only — Constructs
   fight, garrisons muster, you watch. No building mid-fight.
3. **Reward.** Clearing a wave grants gold and partially heals the Eldree.
   The shop reopens automatically for the next Prep.

Losing all the Eldree's HP ends the run; **Begin again** resets gold and the
board from scratch.

**Hard waves.** Every 5th wave (5, 10, 15, …) is a hard wave — the same fight
one notch harder: half again as many foes, arriving from one more direction
and closer together. It's flagged before it starts, on the Begin Wave button
and in the toast, so it's something to build toward rather than be ambushed
by. Holding one is what earns the next ring of board (and a bigger Eldree),
making the spike the run's pacing beat: build up, survive, expand, repeat.

Each hard wave also raises the floor for everything after it. The player's
strength grows in steps — a new ring is a third more room to build — so the
horde grows in steps to match: every era is roughly half again as large as
the one before, leans further toward Trolls and Wraiths, and fields foes that
are individually tougher, which raw volume cannot answer.

**Upgrading, not spreading, is the answer to that.** A tier's output beats
the sum of what merged into it, and higher tiers reach further and strike
faster on top of the raw numbers — so the same wave that needs 34 tiles of
tier-1 Constructs is held by 5 tiles of tier-3. Tiles are the scarce
resource, which makes "merge or spread" the central decision of a run rather
than a convenience.

## The board

- Hex grid, pointy-top, the Eldree fixed at the centre tile.
- Starts at 19 tiles (rings 0–2) and unlocks one ring outward every time a
  hard wave is held — 37 tiles after wave 5, 61 after 10, 91 after 15, and
  127 (full size) after 20. The Eldree itself visibly grows with each
  unlock, so a bigger board reads as a bigger tree.
- No inherent "front." `WaveDef.lanes` (1–6) spreads each wave's spawns
  across that many evenly-arced directions — a wave from one side is a very
  different problem than the same headcount surrounding you from six.

## The Shadow Army

| Enemy | Role | Notes |
|---|---|---|
| **Orc** | Cheap, common | Baseline threat, no armour or resist |
| **Troll** | Armoured bruiser, wall-breaker | Armour 110 halves physical damage, but it has no magic resistance at all — **a magic problem** (Rune line, Mages). Hits Constructs 4.5x harder than flesh, so an unanswered Troll eats your line |
| **Wraith** | Flier | Ignores the routing field and drifts straight at the Eldree, so a purely outward defence never touches it. Shrugs off 72% of magic but has no armour — **a physical problem** (Ballista line, Archers) |

Every enemy that reaches a Construct or the Eldree fights it in melee, and
hits buildings harder than it hits flesh (Orc 2.5x, Troll 4.5x, Wraith
1.5x) — Constructs are meant to be lost and replaced, not to stand forever.
Killing one grants gold. An enemy that fixates on a single Construct for too
long (5s) gives up and reroutes rather than grinding forever — so a wall
slows the horde, it never traps an attacker in place indefinitely either.

**The counter system is the whole reason to read that table.** Damage comes
in two kinds and each enemy is soft to exactly one of them:

| | physical | magic |
|---|---|---|
| Orc | 1.00 | 1.00 |
| Troll (armour 110) | 0.48 | **1.00** |
| Wraith (resist 0.72) | **1.00** | 0.28 |

Magic is ~2.1x better into Trolls, physical ~3.6x better into Wraiths, and
Orcs care about neither — they are the volume problem, answered by bodies.
A board of one damage type will always meet the wave it cannot hurt, which
is what makes the shop draft a decision rather than a shopping list.

## Constructs

Two categories, eight families, each three tiers deep (tier 1 → 2 by
merging, 2 → 3 the same way — see **Merging**). Only tiers 1–2 appear in
the shop draft; tier 3 is merge-only, the top of a family you earn rather
than buy outright.

**Spawners** — muster a standing garrison of units that fight for you:

| Family | Unit | Role |
|---|---|---|
| Barracks → War Lodge → Warhost Bastion | Warrior | Melee frontline |
| Archery Range → Bowspire → Stormwatch Spire | Archer | Single-target ranged |
| Knight's Hall → Bastion Keep → Highguard Citadel | Knight | Taunts, absorbs the charge |
| Mage Spire → Arcane Obelisk → Eldree Sanctum | Mage | Splash damage, magic |

**Defensive structures** — fight or support directly from their own tile:

| Family | Role |
|---|---|
| Palisade → Reinforced Palisade → Stoneguard Wall | Cheap bulk; raises path cost, slows the horde without ever sealing the board |
| Ballista Turret → Heavy Ballista → Siege Ballista | Heavy physical bolts, longest reach — the **Wraith** answer |
| Rune Ward → Rune Pillar → Rune Nexus | Magic splash that ignores armour — the **Troll** answer |
| Healing Shrine → Blessed Shrine → Eternal Wellspring | Mends every friendly unit in a radius, continuously — the only Construct that keeps a garrison alive rather than adding damage |

Roster size and spawn speed both improve with tier (a Barracks musters 3
Warriors on a 4.9s cadence; a Warhost Bastion musters 7 on 2.9s). Garrisons
reset to zero at the end of every wave and only muster once the next wave
is actually running — Prep is a building phase, not a free mustering phase,
which makes muster speed dead time at the front of every fight.

## Controls

- **Pan** — one-finger drag. **Zoom** — pinch (touch) or wheel (desktop).
- **Tap** a Construct — read-only info card (name, blurb, live HP mid-fight).
  No action buttons; every action below is drag-driven.
- **Place** — drag a shop card onto an empty tile, or tap the card then tap
  a tile. Cost is spent on commit, so backing out costs nothing.
- **Move / Merge / Sell — one gesture.** Press and hold a Construct on the
  board (~180ms) to pick it up, then drop it:
  - on an **empty tile** → moves it, free;
  - on a **matching Construct** → merges into its next tier, free, garrison
    carried across (capped to the new roster size — the rest are released);
  - on the **recycle icon** (appears over the shop dock mid-drag) → sells
    it for 60% of its cost back.
  A quick drag from the same tile still pans the camera as normal — only a
  press that holds still past the delay counts as a pickup.
- **Buy straight into an upgrade** — drag a shop card and drop it directly
  onto a matching Construct already on the board. Costs exactly the card's
  price; the existing Construct was already paid for.

**Merge affordances.** Whatever is being held — a shop card or a lifted
Construct — every Construct on the board it could merge into blinks violet
as soon as it's armed. Over a specific match, the ghost switches to
the upgrade's silhouette (what you'd get, not what you're carrying), and a
board-to-board drag also draws a violet beam to the one target it would
pair with.

All of the above is disabled during a wave — the board is look-but-not-touch
while combat runs.

## Economy

- Gold from wave-clear bonuses and per-kill rewards.
- Shop reroll costs gold and rises each use within a Prep period, resetting
  next Prep.
- Selling refunds 60% of a Construct's cost.
- Merging (either path) costs nothing beyond what was already spent raising
  the Constructs involved.

## Design pillars (why it plays this way)

- **No inherent front.** Centring the Eldree with omnidirectional waves
  makes perimeter shape a real decision, not a formality.
- **A wall slows, never seals.** Constructs raise path cost instead of
  blocking outright, so there is always a "just enough" answer rather than
  a wall-off exploit.
- **Every enemy type demands a different building.** Orcs reward volume,
  Trolls reward armour-piercing single-target damage, Wraiths reward splash
  that reaches fliers — a board that beats one loses to another.
- **Merging rewards commitment over hoarding.** Two of a kind, dragged
  together, free — the payoff for buying into a family instead of spreading
  thin across all eight.
- **Every action is a drag.** No menus, no confirm dialogs — the drop
  target *is* the decision (empty tile, a match, or the recycle icon).
