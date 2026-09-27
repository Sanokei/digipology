---
title: Hearthlands
description: Rules for settling, trading, building, and winning the builtin Hearthlands game.
---

# Hearthlands

Hearthlands is a game of settlement and exchange for three to six players. Your
families arrive at an unsettled island where forests, fields, uplands, pastures,
and clay country meet. Build a connected homeland, bargain when the land gives
you the wrong goods, and be the first player to reach 10 victory points on your
own turn.

## The island

With three or four players, use the 19-hex island. With five or six, the game
automatically opens the 30-hex island. Terrain and number discs are shuffled
from the room's deterministic random stream. Sixes and eights are never placed
beside another six or eight.

Each productive terrain supplies one resource:

- Forest supplies Timber.
- Clay Pits supply Clay.
- Fields supply Grain.
- Pastures supply Fleece.
- Highlands supply Stone.
- The Wasteland produces nothing and begins with the Bandit.

## Founding the settlements

Starting with the first seat, each player places one homestead and then one
touching trail. After the last seat finishes, placement reverses back toward
the first seat. Your second homestead grants one resource for each productive
hex beside it. Homesteads may not be placed next to another homestead or
township.

## A turn

Press **Roll** once. The two dice are rolled by the game. Every hex whose number
matches the total produces for adjacent buildings: one card for a homestead and
two for a township. A resource is not paid if the bank cannot satisfy every
claim for that resource.

After production, you may trade, buy or play a Chronicle, and build in any
order. Drag your own physical pieces to highlighted vertex or edge snap points;
the rules script pays the cost after a legal placement and returns an illegal
piece to its supply. Press **End** when finished.

Building costs are:

- Trail: 1 Timber and 1 Clay.
- Homestead: 1 Timber, 1 Clay, 1 Grain, and 1 Fleece.
- Township: 2 Grain and 3 Stone; it replaces one of your homesteads.
- Chronicle: 1 Grain, 1 Fleece, and 1 Stone.

A new trail must touch your network. A new homestead must touch one of your
trails and obey the one-vertex distance rule. An opposing building interrupts
trail continuity through its vertex.

## A roll of seven

No terrain produces. Every player holding more than seven resource cards
privately discards half, rounded down, one resource choice at a time. The active
player then moves the Bandit to a different hex and steals one random resource
from a chosen opponent with a building beside that hex. A hex occupied by the
Bandit does not produce.

## Trade and harbors

Use **Trade** to make a specific offer to one player. The recipient privately
accepts or declines. Use **Maritime** to return four matching cards for one card
of your choice. A homestead or township on a harbor lowers that rate: a generic
harbor is 3:1, and a resource harbor is 2:1 for its named resource.

## Chronicles

Chronicles remain private in your hand. A Monument is worth one hidden victory
point. Other cards are played with **Play Chronicle**:

- **Warden** moves the Bandit and counts toward Largest Watch.
- **Road Crews** pays for your next two trails.
- **Harvest Boon** takes any two available resources from the bank.
- **Guild Decree** names a resource; every opponent gives you all cards of that
  resource.

## Awards and victory

The first uninterrupted trail of length five claims **Longest Trail**, worth two
points. A longer trail takes it away; a tie leaves the current holder in place.
The first player to play three Wardens claims **Largest Watch**, also worth two
points, and a larger watch can take it away.

Homesteads are worth one visible point and townships two. Awards add two visible
points. Monuments stay hidden. As soon as your visible and hidden total reaches
10 during your own turn, you win and the table enters its game-over state.

Resource and Chronicle hands are hidden by the official client. As with all
friendly tabletop rooms, this is interface privacy rather than protection from
a deliberately modified client.
