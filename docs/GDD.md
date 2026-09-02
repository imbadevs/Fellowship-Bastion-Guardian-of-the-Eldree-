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

## The board

- Hex grid, pointy-top, the Eldree fixed at the centre tile.
- Starts at 19 tiles (rings 0–2) and unlocks outward to 61 tiles as waves
  progress (ring 3 at wave 4, ring 4 at wave 8) — the Eldree itself visibly
  grows a little with each unlock, so a bigger board reads as a bigger tree.
- No inherent "front." `WaveDef.lanes` (1–6) spreads each wave's spawns
  across that many evenly-arced directions — a wave from one side is a very
  different problem than the same headcount surrounding you from six.

## The Shadow Army

| Enemy | Role | Notes |
|---|---|---|
| **Orc** | Cheap, common | Baseline threat, no armour or resist |
| **Troll** | Armoured bruiser | Heavy physical mitigation — a Ballista problem |
| **Wraith** | Flier | Ignores the routing field, drifts straight at the Eldree, high magic resist — a Rune Ward problem |

Every enemy that reaches a Construct or the Eldree fights it in melee.
Killing one grants gold. An enemy that fixates on a single Construct for too
long (5s) gives up and reroutes rather than grinding forever — so a wall
slows the horde, it never traps an attacker in place indefinitely either.

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
| Ballista Turret → Heavy Ballista → Siege Ballista | Heavy single-target bolts — the Troll answer |
| Rune Ward → Rune Pillar → Rune Nexus | Splash pulse that reaches fliers — the Wraith answer |
| Healing Shrine → Blessed Shrine → Eternal Wellspring | *Blurb promises mending the garrison; not implemented yet — currently an HP-only Construct* |

Roster size and spawn speed both improve with tier (e.g. Barracks musters 3
Warriors on a 6s cadence; a Warhost Bastion musters 7 on 3.5s). Garrisons
reset to zero at the end of every wave and only muster once the next wave
is actually running — Prep is a building phase, not a free mustering phase.

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
