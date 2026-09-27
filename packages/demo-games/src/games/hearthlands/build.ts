import { canonicalStringify } from "digipology-canonical-json";
import type { FaceIconName, FaceSpec } from "digipology-faces";
import {
  canonicalizeTransform,
  createInitialState,
  type CanonicalGameState,
  type EntityComponents,
  type EntityRecord,
  type ScriptBindingComponent,
  type TransformComponent,
} from "digipology-kernel";
import {
  hexTopology,
  ringLayout,
  type BuiltinReleaseBuilder,
  type BuiltinReleaseSource,
  type HexTopology,
} from "../../authoring";

const RELEASE_ID = "builtin_hearthlands_1";
const SCRIPT_ID = "scripts/game.lua";
const SIZE = 1.48;
const RESOURCES = ["timber", "clay", "grain", "fleece", "stone"] as const;
type Resource = typeof RESOURCES[number];

const CORE_COORDS: Array<readonly [number, number]> = [];
for (let r = -2; r <= 2; r += 1) {
  for (let q = Math.max(-2, -r - 2); q <= Math.min(2, -r + 2); q += 1) CORE_COORDS.push([q, r]);
}
const EXPANDED_COORDS: Array<readonly [number, number]> = [];
const rowLengths = [3, 4, 5, 6, 5, 4, 3];
for (let row = 0; row < rowLengths.length; row += 1) {
  const r = row - 3;
  const length = rowLengths[row]!;
  const start = -Math.floor(length / 2) - Math.floor(r / 2);
  for (let offset = 0; offset < length; offset += 1) EXPANDED_COORDS.push([start + offset, r]);
}

function transform(x: number, y: number, z: number, scale = { x: 1, y: 1, z: 1 }, rotationY = 0): TransformComponent {
  return canonicalizeTransform({
    position: { x, y, z },
    rotation: { x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) },
    scale,
  });
}

function entity(id: string, components: EntityComponents): EntityRecord { return { id, components }; }

function script(bindingId: string, props: Record<string, string | number | boolean>, scope: "entity" | "game" = "entity"): ScriptBindingComponent {
  return { scriptId: SCRIPT_ID, bindingId, props, scope };
}

function iconFace(label: string, icon: FaceIconName, color: `#${string}`, accent: `#${string}`): FaceSpec {
  return {
    background: { type: "linear-gradient", x1: 0, y1: 0, x2: 1000, y2: 1000, stops: [{ offset: 0, color }, { offset: 1, color: accent }] },
    elements: [
      { type: "circle", cx: 500, cy: 430, r: 285, fill: "#fff7df", opacity: 0.88 },
      { type: "icon", name: icon, x: 500, y: 430, size: 430, fill: color, stroke: "#30251c", strokeWidth: 18 },
      { type: "text", x: 500, y: 850, text: label, font: "serif", size: 104, weight: 800, align: "center", fill: "#fffaf0" },
    ],
  };
}

function numberFace(value: number): FaceSpec {
  const red = value === 6 || value === 8;
  const pips = 6 - Math.abs(7 - value);
  const elements: FaceSpec["elements"] = [
    { type: "circle", cx: 500, cy: 500, r: 440, fill: "#f6e8bd", stroke: red ? "#b3262e" : "#3f3326", strokeWidth: 34 },
    { type: "text", x: 500, y: 485, text: String(value), font: "serif", size: 330, weight: 800, align: "center", fill: red ? "#b3262e" : "#30251c" },
  ];
  const start = 500 - (pips - 1) * 43;
  for (let index = 0; index < pips; index += 1) elements.push({ type: "circle", cx: start + index * 86, cy: 715, r: 25, fill: red ? "#b3262e" : "#30251c" });
  return { background: "#f6e8bd", elements };
}

function luaValue(value: unknown): string {
  if (value === null) return "nil";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `{${value.map(luaValue).join(",")}}`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, child]) => `[${JSON.stringify(key)}]=${luaValue(child)}`).join(",")}}`;
}

function topologyRuntime(topology: HexTopology) {
  const coreKeys = new Set(CORE_COORDS.map(([q, r]) => `${q},${r}`));
  const coreTileIds = topology.tiles.filter((tile) => coreKeys.has(`${tile.q},${tile.r}`)).map((tile) => tile.id);
  const activeSets = (tileIds: readonly string[]) => {
    const tileSet = new Set(tileIds);
    return {
      tileIds,
      vertexIds: topology.vertices.filter((vertex) => vertex.tileIds.some((id) => tileSet.has(id))).map((vertex) => vertex.id),
      edgeIds: topology.edges.filter((edge) => edge.tileIds.some((id) => tileSet.has(id))).map((edge) => edge.id),
    };
  };
  return {
    core: activeSets(coreTileIds),
    expanded: activeSets(topology.tiles.map((tile) => tile.id)),
    tiles: Object.fromEntries(topology.tiles.map((tile) => [tile.id, {
      position: tile.position, vertexIds: tile.vertexIds, edgeIds: tile.edgeIds,
      neighborIds: topology.edges.filter((edge) => edge.tileIds.includes(tile.id) && edge.tileIds.length === 2)
        .flatMap((edge) => edge.tileIds.filter((id) => id !== tile.id)).sort(),
    }])),
    vertices: Object.fromEntries(topology.vertices.map((vertex) => [vertex.id, {
      position: vertex.position, tileIds: vertex.tileIds, edgeIds: vertex.edgeIds, neighborIds: vertex.neighborIds,
    }])),
    edges: Object.fromEntries(topology.edges.map((edge) => [edge.id, {
      position: edge.position, tileIds: edge.tileIds, vertexIds: edge.vertexIds,
    }])),
  };
}

const CORE_TERRAINS = [
  ...Array(4).fill("forest"), ...Array(3).fill("clay"), ...Array(4).fill("fields"),
  ...Array(4).fill("pastures"), ...Array(3).fill("highlands"), "wasteland",
] as string[];
const EXTRA_TERRAINS = ["forest", "forest", "clay", "clay", "clay", "fields", "fields", "pastures", "pastures", "highlands", "highlands"];
const CORE_NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const EXTRA_NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 5];

function buildLua(runtime: ReturnType<typeof topologyRuntime>, harbors: Array<{ vertices: readonly string[]; resource: string }>): string {
  const rulesRuntime = {
    core: runtime.core,
    expanded: runtime.expanded,
    tiles: Object.fromEntries(Object.entries(runtime.tiles).map(([id, tile]) => [id, { position: tile.position, vertexIds: tile.vertexIds, neighborIds: tile.neighborIds }])),
    vertices: Object.fromEntries(Object.entries(runtime.vertices).map(([id, vertex]) => [id, { tileIds: vertex.tileIds, edgeIds: vertex.edgeIds, neighborIds: vertex.neighborIds }])),
    edges: Object.fromEntries(Object.entries(runtime.edges).map(([id, edge]) => [id, { vertexIds: edge.vertexIds }])),
  };
  return `-- Hearthlands release ${RELEASE_ID}\n-- Original rules implementation organized as deterministic board, bank, trade, chronicle, and scoring modules.\nlocal R=${luaValue(rulesRuntime)}\nlocal HARBORS=${luaValue(harbors)}\nlocal RESOURCES={"timber","clay","grain","fleece","stone"}\nlocal TERRAIN_RESOURCE={forest="timber",clay="clay",fields="grain",pastures="fleece",highlands="stone"}\nlocal COST={trail={timber=1,clay=1},homestead={timber=1,clay=1,grain=1,fleece=1},township={grain=2,stone=3},chronicle={grain=1,fleece=1,stone=1}}\nlocal CORE_TILES=${luaValue(CORE_TERRAINS.map((_, index) => `terrain_${String(index + 1).padStart(2, "0")}`))}\nlocal EXTRA_TILES=${luaValue(EXTRA_TERRAINS.map((_, index) => `terrain_${String(CORE_TERRAINS.length + index + 1).padStart(2, "0")}`))}\nlocal CORE_NUMBERS=${luaValue(CORE_NUMBERS.map((_, index) => `number_${String(index + 1).padStart(2, "0")}`))}\nlocal EXTRA_NUMBERS=${luaValue(EXTRA_NUMBERS.map((_, index) => `number_${String(CORE_NUMBERS.length + index + 1).padStart(2, "0")}`))}\n\nlocal function copy(a) local b={} for i,v in ipairs(a) do b[i]=v end return b end\nlocal function contains(a,v) for _,x in ipairs(a or {}) do if x==v then return true end end return false end\nlocal function piece_kind(id) for _,kind in ipairs({"trail","homestead","township"}) do if string.sub(id,1,string.len(kind)+1)==kind.."_" then return kind end end return nil end\nlocal function player_for_seat(seat) return players:by_seat(seat) end\nlocal function seat_of(player) return player and player.seat and player.seat.id or nil end\nlocal function next_prompt(kind) state.prompt_serial=(state.prompt_serial or 0)+1 local id=kind.."_"..state.prompt_serial state.prompt_kind[id]=kind return id end\nlocal function prompt_choice(player,kind,title,choices) local id=next_prompt(kind) ui:prompt(player,{id=id,title=title,choices=choices}) return id end\nlocal function status(message) refs.status:set(message) state.status=message end\nlocal function hand_of(player_id) local p=players:get(player_id) return p and p.hand or nil end\nlocal function resource_of(card) if card and string.sub(card.definition_id or "",1,9)=="resource_" then return string.sub(card.definition_id,10) end return nil end\nlocal function cards_of(hand,resource) local out={} if not hand then return out end for _,card in ipairs(hand:list()) do if resource_of(card)==resource then out[#out+1]=card end end return out end\nlocal function resource_count(player_id) local total=0 local hand=hand_of(player_id) if hand then for _,card in ipairs(hand:list()) do if resource_of(card) then total=total+1 end end end return total end\n\nlocal Bank={}\nfunction Bank.take(resource,player_id,count)\n  local bank=scene:get("bank_"..resource) local hand=hand_of(player_id) if not bank or not hand or bank.count<count then return false end\n  local list=bank:list() local moved=0 for _,card in ipairs(list) do if resource_of(card)==resource and moved<count then bank:move_to(card,hand) moved=moved+1 end end\n  scene:get("bank_count_"..resource):subtract(count) return moved==count\nend\nfunction Bank.return_cards(player_id,resource,count)\n  local hand=hand_of(player_id) local bank=scene:get("bank_"..resource) local list=cards_of(hand,resource) if #list<count then return false end\n  for i=1,count do hand:move_to(list[i],bank) end scene:get("bank_count_"..resource):add(count) return true\nend\nfunction Bank.can_pay(player_id,cost) for resource,count in pairs(cost) do if #cards_of(hand_of(player_id),resource)<count then return false end end return true end\nfunction Bank.pay(player_id,cost) if not Bank.can_pay(player_id,cost) then return false end for _,resource in ipairs(RESOURCES) do if cost[resource] then Bank.return_cards(player_id,resource,cost[resource]) end end return true end\n\nlocal Board={}\nfunction Board.snap_holding(ids,piece) for _,id in ipairs(ids) do local snap=scene:get(id) for _,held in ipairs(snap.entities or {}) do if held.id==piece.id then return id end end end return nil end\nfunction Board.reject(piece,reason) local home=state.home[piece.id] if home then piece:move_to(home) end status(reason) end\nfunction Board.distance_clear(vertex) for _,neighbor in ipairs(R.vertices[vertex].neighborIds) do if state.vertex_owner[neighbor] then return false end end return true end\nfunction Board.connected_vertex(seat,vertex) if state.vertex_owner[vertex]==seat then return true end for _,edge in ipairs(R.vertices[vertex].edgeIds) do if state.edge_owner[edge]==seat then return true end end return false end\nfunction Board.connected_edge(seat,edge) for _,vertex in ipairs(R.edges[edge].vertexIds) do if state.vertex_owner[vertex]==seat then return true end for _,other in ipairs(R.vertices[vertex].edgeIds) do if other~=edge and state.edge_owner[other]==seat then return true end end end return false end\nfunction Board.setup_resource(player_id,vertex) for _,tile in ipairs(R.vertices[vertex].tileIds) do local resource=TERRAIN_RESOURCE[state.terrain[tile]] if resource then Bank.take(resource,player_id,1) end end end\n\nlocal Score={}\nfunction Score.visible(player_id)\n  local seat=seat_of(players:get(player_id)) local value=0\n  for vertex,owner in pairs(state.vertex_owner) do if owner==seat then value=value+(state.vertex_kind[vertex]=="township" and 2 or 1) end end\n  if state.longest_holder==player_id then value=value+2 end if state.watch_holder==player_id then value=value+2 end return value\nend\nfunction Score.refresh(player_id) local p=players:get(player_id) if not p then return end local value=Score.visible(player_id) scores:set(p,value) scene:get("score_"..p.seat.id):set(value) end\nfunction Score.check(player_id) local p=players:get(player_id) if not p then return end Score.refresh(player_id) local total=Score.visible(player_id)+(state.monuments[player_id] or 0) if turns:is_current(p) and total>=10 then state.winner_id=player_id state.phase="game_over" turns:stop() status(p.name.." settles Hearthlands with "..total.." victory points!") end end\nlocal function trail_length(seat)\n  local best=0 local used={}\n  local function walk(vertex,length) if length>best then best=length end if state.vertex_owner[vertex] and state.vertex_owner[vertex]~=seat and length>0 then return end for _,edge in ipairs(R.vertices[vertex].edgeIds) do if state.edge_owner[edge]==seat and not used[edge] then used[edge]=true local ends=R.edges[edge].vertexIds local other=ends[1]==vertex and ends[2] or ends[1] walk(other,length+1) used[edge]=nil end end end\n  for edge,owner in pairs(state.edge_owner) do if owner==seat then for _,vertex in ipairs(R.edges[edge].vertexIds) do walk(vertex,0) end end end return best\nend\nfunction Score.longest()\n  local holder=nil local best=4 for _,p in ipairs(players:list()) do local length=trail_length(p.seat.id) state.trail_lengths[p.id]=length if length>best then best=length holder=p.id elseif length==best and state.longest_holder==p.id then holder=p.id end end\n  local old=state.longest_holder state.longest_holder=holder refs.longest:set(holder and (players:get(holder).name.." — "..best) or "Longest Trail — unclaimed") if old then Score.refresh(old) end if holder then Score.refresh(holder) end\nend\nfunction Score.watch()\n  local holder=nil local best=2 for _,p in ipairs(players:list()) do local count=state.wardens[p.id] or 0 if count>best then best=count holder=p.id elseif count==best and state.watch_holder==p.id then holder=p.id end end\n  local old=state.watch_holder state.watch_holder=holder refs.watch:set(holder and (players:get(holder).name.." — "..best) or "Largest Watch — unclaimed") if old then Score.refresh(old) end if holder then Score.refresh(holder) end\nend\n\nlocal function active_player() return turns:current() end\nlocal function setup_advance()\n  local order=state.player_ids if state.setup_expect=="homestead" then state.setup_expect="trail" status(players:get(order[state.setup_index]).name.." places a trail beside the new homestead") return end\n  if state.setup_round==1 then if state.setup_index<#order then state.setup_index=state.setup_index+1 else state.setup_round=2 end else if state.setup_index>1 then state.setup_index=state.setup_index-1 else state.phase="roll" turns:start(players:get(order[1])) status(turns:current().name.." rolls to begin") return end end\n  state.setup_expect="homestead" status(players:get(order[state.setup_index]).name.." places a homestead")\nend\nlocal function setup_player_id() return state.player_ids[state.setup_index] end\n\nlocal function place_piece(piece,kind,seat)\n  local player=player_for_seat(seat) if not player then return Board.reject(piece,"That seat is empty") end\n  if state.phase=="setup" and player.id~=setup_player_id() then return Board.reject(piece,"Wait for your setup placement") end\n  if state.phase~="setup" and (state.phase~="build" or not turns:is_current(player)) then return Board.reject(piece,"Build only during your own trade/build phase") end\n  if kind=="trail" then\n    local edge=Board.snap_holding(state.edge_ids,piece) if not edge or state.edge_owner[edge] then return Board.reject(piece,"Choose an empty active trail edge") end\n    if state.phase=="setup" then local vertex=state.last_setup_vertex[player.id] if state.setup_expect~="trail" or not contains(R.edges[edge].vertexIds,vertex) then return Board.reject(piece,"Your setup trail must touch the homestead just placed") end else if not Board.connected_edge(seat,edge) then return Board.reject(piece,"A trail must connect to your network") end if (state.free_trails[player.id] or 0)>0 then state.free_trails[player.id]=state.free_trails[player.id]-1 elseif not Bank.pay(player.id,COST.trail) then return Board.reject(piece,"A trail costs 1 Timber and 1 Clay") end end\n    state.edge_owner[edge]=seat state.edge_piece[edge]=piece.id if state.phase=="setup" then setup_advance() end Score.longest() Score.check(player.id) return\n  end\n  local vertex=Board.snap_holding(state.vertex_ids,piece) if not vertex then return Board.reject(piece,"Choose an active settlement vertex") end\n  if kind=="homestead" then\n    if state.vertex_owner[vertex] or not Board.distance_clear(vertex) then return Board.reject(piece,"Homesteads must use an empty vertex with one clear vertex on every side") end\n    if state.phase=="setup" then if state.setup_expect~="homestead" then return Board.reject(piece,"Place the requested trail first") end else if not Board.connected_vertex(seat,vertex) then return Board.reject(piece,"A homestead must connect to one of your trails") elseif not Bank.pay(player.id,COST.homestead) then return Board.reject(piece,"A homestead costs Timber, Clay, Grain, and Fleece") end end\n    state.vertex_owner[vertex]=seat state.vertex_kind[vertex]="homestead" state.vertex_piece[vertex]=piece.id\n    if state.phase=="setup" then state.last_setup_vertex[player.id]=vertex if state.setup_round==2 then Board.setup_resource(player.id,vertex) end setup_advance() end Score.refresh(player.id) Score.check(player.id) return\n  end\n  if kind=="township" then\n    if state.vertex_owner[vertex]~=seat or state.vertex_kind[vertex]~="homestead" then return Board.reject(piece,"A township upgrades your own homestead") end\n    if not Bank.pay(player.id,COST.township) then return Board.reject(piece,"A township costs 2 Grain and 3 Stone") end\n    local old=scene:get(state.vertex_piece[vertex]) local home=state.home[old.id] old:move_to(home) state.vertex_kind[vertex]="township" state.vertex_piece[vertex]=piece.id Score.refresh(player.id) Score.check(player.id)\n  end\nend\n\nlocal function adjacent_players(tile,exclude) local out={} local seen={} for _,vertex in ipairs(R.tiles[tile].vertexIds) do local seat=state.vertex_owner[vertex] local p=seat and player_for_seat(seat) if p and p.id~=exclude and not seen[p.id] then out[#out+1]=p.id seen[p.id]=true end end table.sort(out) return out end\nlocal function begin_bandit(player_id) local choices={} for _,tile in ipairs(state.tile_ids) do if tile~=state.bandit_tile then choices[#choices+1]=tile end end state.bandit_player=player_id prompt_choice(players:get(player_id),"bandit_hex","Move the Bandit",choices) end\nlocal function move_bandit(player_id,tile) local bandit=refs.bandit local pos=R.tiles[tile].position bandit:move_to(pos.x,0.72,pos.z) state.bandit_tile=tile local victims=adjacent_players(tile,player_id) if #victims>0 then prompt_choice(players:get(player_id),"bandit_victim","Choose a neighboring player",victims) else state.phase="build" status(players:get(player_id).name.." may trade and build") end end\nlocal function steal(thief_id,victim_id) local cards=hand_of(victim_id):list() local resources={} for _,card in ipairs(cards) do if resource_of(card) then resources[#resources+1]=card end end if #resources>0 then hand_of(victim_id):move_to(random:choice(resources),hand_of(thief_id)) end state.phase="build" status(players:get(thief_id).name.." may trade and build") end\n\nlocal function production(total)\n  local claims={} for _,resource in ipairs(RESOURCES) do claims[resource]={} end\n  for _,tile in ipairs(state.tile_ids) do if state.numbers[tile]==total and tile~=state.bandit_tile then local resource=TERRAIN_RESOURCE[state.terrain[tile]] if resource then for _,vertex in ipairs(R.tiles[tile].vertexIds) do local seat=state.vertex_owner[vertex] local p=seat and player_for_seat(seat) if p then local amount=state.vertex_kind[vertex]=="township" and 2 or 1 claims[resource][p.id]=(claims[resource][p.id] or 0)+amount end end end end end\n  for _,resource in ipairs(RESOURCES) do local needed=0 for _,p in ipairs(players:list()) do needed=needed+(claims[resource][p.id] or 0) end if scene:get("bank_"..resource).count>=needed then for _,p in ipairs(players:list()) do local amount=claims[resource][p.id] or 0 if amount>0 then Bank.take(resource,p.id,amount) end end end end\nend\nlocal function next_discard() while #state.discard_queue>0 and state.discard_remaining[state.discard_queue[1]]==0 do table.remove(state.discard_queue,1) end if #state.discard_queue==0 then begin_bandit(active_player().id) return end local id=state.discard_queue[1] local choices={} for _,resource in ipairs(RESOURCES) do if #cards_of(hand_of(id),resource)>0 then choices[#choices+1]=resource end end prompt_choice(players:get(id),"discard","Discard "..state.discard_remaining[id].." more card(s)",choices) end\nlocal function rolled(total) if total==7 then state.phase="bandit" state.discard_queue={} state.discard_remaining={} for _,p in ipairs(players:list()) do local count=resource_count(p.id) if count>7 then state.discard_queue[#state.discard_queue+1]=p.id state.discard_remaining[p.id]=math.floor(count/2) end end next_discard() else production(total) state.phase="build" status(active_player().name.." rolled "..total.." and may trade and build") end end\n\nlocal Trade={}\nfunction Trade.ratio(player_id,resource) local seat=seat_of(players:get(player_id)) local ratio=4 for _,harbor in ipairs(HARBORS) do if harbor.resource=="any" or harbor.resource==resource then for _,vertex in ipairs(harbor.vertices) do if state.vertex_owner[vertex]==seat then ratio=math.min(ratio,harbor.resource=="any" and 3 or 2) end end end end return ratio end\nfunction Trade.start_maritime(player) prompt_choice(player,"sea_give","Choose a resource to send",RESOURCES) end\nfunction Trade.start_offer(player) local targets={} for _,p in ipairs(players:list()) do if p.id~=player.id then targets[#targets+1]=p.id end end if #targets>0 then prompt_choice(player,"trade_target","Choose a trading partner",targets) end end\n\nlocal Chronicle={}\nfunction Chronicle.buy(player) if not Bank.can_pay(player.id,COST.chronicle) or refs.chronicle.count<1 then return status("A Chronicle costs Grain, Fleece, and Stone") end Bank.pay(player.id,COST.chronicle) refs.chronicle:draw_to(player.hand,1) status(player.name.." bought a face-down Chronicle") end\nfunction Chronicle.play_choices(player) local choices={} local seen={} for _,card in ipairs(player.hand:list()) do local kind=string.match(card.definition_id or "","^chronicle_(.+)$") if kind and kind~="monument" and not seen[kind] then choices[#choices+1]=kind seen[kind]=true end end table.sort(choices) if #choices>0 then prompt_choice(player,"chronicle_play","Choose a Chronicle",choices) else status("You have no playable Chronicle") end end\nfunction Chronicle.discard_kind(player,kind) for _,card in ipairs(player.hand:list()) do if card.definition_id=="chronicle_"..kind then player.hand:move_to(card,refs.chronicle_discard) return true end end return false end\nfunction Chronicle.play(player,kind)\n  if not Chronicle.discard_kind(player,kind) then return end\n  if kind=="warden" then state.wardens[player.id]=(state.wardens[player.id] or 0)+1 Score.watch() begin_bandit(player.id)\n  elseif kind=="road_crew" then state.free_trails[player.id]=(state.free_trails[player.id] or 0)+2 status(player.name.." may place two free trails")\n  elseif kind=="harvest_boon" then state.boon_player=player.id prompt_choice(player,"boon_one","Choose the first resource",RESOURCES)\n  elseif kind=="guild_decree" then state.guild_player=player.id prompt_choice(player,"guild_resource","Name a resource guild",RESOURCES) end\n  Score.check(player.id)\nend\n\nfunction can_grab(ctx) local kind=piece_kind(ctx.object.id) local seat=kind and string.match(ctx.object.id,"_(seat_%d+)_") if seat and (not ctx.player or seat_of(ctx.player)~=seat) then return false,"Only that seat may move this piece" end if state.phase=="game_over" then return false,"The game is over" end return true end\nfunction can_drop(ctx) return can_grab(ctx) end\nfunction can_press(ctx) if not ctx.player then return false,"A player must press this button" end if state.phase=="game_over" then return false,"The game is over" end if not turns:is_current(ctx.player) then return false,"It is not your turn" end return true end\n\nfunction on_start(ctx)\n  local count=players:count() if count<3 or count>6 then error("Hearthlands needs 3 to 6 seated players") end\n  state.prompt_serial=0 state.prompt_kind={} state.phase="setup" state.home={} state.player_ids={} state.vertex_owner={} state.vertex_kind={} state.vertex_piece={} state.edge_owner={} state.edge_piece={} state.terrain={} state.numbers={} state.trail_lengths={} state.wardens={} state.monuments={} state.free_trails={} state.last_setup_vertex={} state.discard_remaining={}\n  for _,p in ipairs(players:list()) do state.player_ids[#state.player_ids+1]=p.id scores:set(p,0) end turns:start(players:get(state.player_ids[1]))\n  local layout=count>=5 and R.expanded or R.core state.tile_ids=copy(layout.tileIds) state.vertex_ids=copy(layout.vertexIds) state.edge_ids=copy(layout.edgeIds)\n  local tiles=copy(CORE_TILES) if count>=5 then for _,id in ipairs(EXTRA_TILES) do tiles[#tiles+1]=id end end tiles=random:shuffle(tiles)\n  local non_waste={} for index,tile_id in ipairs(state.tile_ids) do local piece=scene:get(tiles[index]) local terrain=string.match(piece.definition_id,"^terrain_(.+)$") state.terrain[tile_id]=terrain local pos=R.tiles[tile_id].position piece:move_to(pos.x,0.28,pos.z) if terrain~="wasteland" then non_waste[#non_waste+1]=tile_id else state.bandit_tile=tile_id end end\n  local numbers=copy(CORE_NUMBERS) if count>=5 then for _,id in ipairs(EXTRA_NUMBERS) do numbers[#numbers+1]=id end end\n  local valid=false while not valid do numbers=random:shuffle(numbers) valid=true local assigned={} for index,tile in ipairs(non_waste) do local value=tonumber(string.match(scene:get(numbers[index]).definition_id,"(%d+)$")) assigned[tile]=value end for _,tile in ipairs(non_waste) do if assigned[tile]==6 or assigned[tile]==8 then for _,neighbor in ipairs(R.tiles[tile].neighborIds) do if assigned[neighbor]==6 or assigned[neighbor]==8 then valid=false end end end end if valid then for index,tile in ipairs(non_waste) do local disc=scene:get(numbers[index]) local pos=R.tiles[tile].position disc:move_to(pos.x,0.48,pos.z) state.numbers[tile]=assigned[tile] end end end\n  local waste=R.tiles[state.bandit_tile].position refs.bandit:move_to(waste.x,0.72,waste.z)\n  state.setup_round=1 state.setup_index=1 state.setup_expect="homestead" status(players:get(state.player_ids[1]).name.." places a homestead")\nend\nfunction on_game_resumed(ctx) status(state.status or "Hearthlands resumed") end\nfunction on_player_join(ctx) if state.phase then status(ctx.player.name.." joined; saved turn order is preserved") end end\nfunction on_grab(ctx) local kind=piece_kind(ctx.object.id) if kind and state.home[ctx.object.id]==nil then state.home[ctx.object.id]={x=ctx.object.position.x,y=ctx.object.position.y,z=ctx.object.position.z} end end\nfunction on_drop(ctx) local kind=piece_kind(ctx.object.id) local seat=kind and string.match(ctx.object.id,"_(seat_%d+)_") if kind then place_piece(ctx.object,kind,seat) end end\nfunction on_roll(ctx) if (ctx.object.id~="die_one" and ctx.object.id~="die_two") or not state.roll_pending then return end state.roll_pending=state.roll_pending-1 if state.roll_pending==0 then rolled(refs.die_one.value+refs.die_two.value) end end\nfunction on_container_add(ctx) if not ctx.object then return end local target=ctx.to or ctx.target local seat=target and string.match(target,"^hand_(seat_%d+)$") local player=seat and player_for_seat(seat) if player and ctx.object.definition_id=="chronicle_monument" then state.monuments[player.id]=(state.monuments[player.id] or 0)+1 Score.check(player.id) end end\nfunction on_press(ctx)\n  local player=ctx.player local actions={roll_button="roll",trade_button="trade",sea_button="maritime",buy_button="buy",play_button="play",end_button="end"} local action=actions[ctx.object.id] if action=="roll" then if state.phase~="roll" then return status("Roll only at the start of your turn") end state.roll_pending=2 refs.die_one:roll() refs.die_two:roll()\n  elseif action=="end" then if state.phase~="build" then return status("Resolve the roll and Bandit before ending the turn") end local next=turns:next() state.phase="roll" status(next.name.." rolls")\n  elseif action=="maritime" and state.phase=="build" then Trade.start_maritime(player)\n  elseif action=="trade" and state.phase=="build" then Trade.start_offer(player)\n  elseif action=="buy" and state.phase=="build" then Chronicle.buy(player)\n  elseif action=="play" and state.phase=="build" then Chronicle.play_choices(player) end\nend\nfunction on_prompt(ctx)\n  local kind=state.prompt_kind[ctx.promptId] if not kind then return end state.prompt_kind[ctx.promptId]=nil\n  if kind=="discard" then Bank.return_cards(ctx.playerId,ctx.response,1) state.discard_remaining[ctx.playerId]=state.discard_remaining[ctx.playerId]-1 next_discard()\n  elseif kind=="bandit_hex" then move_bandit(ctx.playerId,ctx.response) elseif kind=="bandit_victim" then steal(state.bandit_player,ctx.response)\n  elseif kind=="sea_give" then state.sea={player=ctx.playerId,give=ctx.response} local ratio=Trade.ratio(ctx.playerId,ctx.response) if #cards_of(hand_of(ctx.playerId),ctx.response)<ratio then state.sea=nil status("You do not have enough cards for that harbor rate") else prompt_choice(ctx.player,"sea_receive","Choose the resource to receive",RESOURCES) end\n  elseif kind=="sea_receive" then local t=state.sea local ratio=Trade.ratio(t.player,t.give) if Bank.return_cards(t.player,t.give,ratio) and Bank.take(ctx.response,t.player,1) then status(ctx.player.name.." completed a maritime trade") end state.sea=nil\n  elseif kind=="trade_target" then state.trade={from=ctx.playerId,target=ctx.response} prompt_choice(ctx.player,"trade_give","Choose what you offer",RESOURCES)\n  elseif kind=="trade_give" then state.trade.give=ctx.response ui:number_prompt(ctx.player,{id=next_prompt("trade_give_count"),title="How many to offer?",min=1,max=math.max(1,#cards_of(ctx.player.hand,ctx.response)),step=1,default=1})\n  elseif kind=="trade_give_count" then state.trade.give_count=ctx.response prompt_choice(ctx.player,"trade_receive","Choose what you request",RESOURCES)\n  elseif kind=="trade_receive" then state.trade.receive=ctx.response ui:number_prompt(ctx.player,{id=next_prompt("trade_receive_count"),title="How many requested?",min=1,max=20,step=1,default=1})\n  elseif kind=="trade_receive_count" then state.trade.receive_count=ctx.response local target=players:get(state.trade.target) ui:confirm(target,{id=next_prompt("trade_confirm"),title=ctx.player.name.." offers "..state.trade.give_count.." "..state.trade.give.." for "..state.trade.receive_count.." "..state.trade.receive,default=false})\n  elseif kind=="trade_confirm" then local t=state.trade if ctx.response and #cards_of(hand_of(t.from),t.give)>=t.give_count and #cards_of(hand_of(t.target),t.receive)>=t.receive_count then local a=hand_of(t.from) local b=hand_of(t.target) local give=cards_of(a,t.give) local receive=cards_of(b,t.receive) for i=1,t.give_count do a:move_to(give[i],b) end for i=1,t.receive_count do b:move_to(receive[i],a) end status("Trade accepted") else status("Trade declined or no longer affordable") end state.trade=nil\n  elseif kind=="chronicle_play" then Chronicle.play(ctx.player,ctx.response)\n  elseif kind=="boon_one" then state.boon_one=ctx.response prompt_choice(ctx.player,"boon_two","Choose the second resource",RESOURCES)\n  elseif kind=="boon_two" then Bank.take(state.boon_one,state.boon_player,1) Bank.take(ctx.response,state.boon_player,1) status(ctx.player.name.." received a Harvest Boon")\n  elseif kind=="guild_resource" then local owner=state.guild_player local total=0 for _,p in ipairs(players:list()) do if p.id~=owner then local cards=cards_of(p.hand,ctx.response) for _,card in ipairs(cards) do p.hand:move_to(card,hand_of(owner)) total=total+1 end end end status(players:get(owner).name.." gathered "..total.." "..ctx.response.." from the guilds") end\nend\nreturn {}\n`;
}

function buildState(topology: HexTopology, runtime: ReturnType<typeof topologyRuntime>) {
  const entities: CanonicalGameState["entities"] = {};
  const refs: Record<string, string> = {
    status: "status", bandit: "bandit", die_one: "die_one", die_two: "die_two",
    chronicle: "chronicle_deck", chronicle_discard: "chronicle_discard", longest: "longest_text", watch: "watch_text",
  };
  entities.sea_frame = entity("sea_frame", { transform: transform(0, 0, 0, { x: 16, y: 0.16, z: 14 }), lockable: { locked: true }, appearance: { definitionId: "sea_frame" } });
  entities.rules = entity("rules", { script: script("hearthlands_game", { role: "game" }, "game") });
  entities.status = entity("status", { transform: transform(0, 0.3, -10.2, { x: 9, y: 0.15, z: 0.6 }), text: { value: "Waiting for 3–6 players" }, appearance: { definitionId: "status_plaque" } });
  entities.rules_panel = entity("rules_panel", { transform: transform(10.8, 0.2, -2.2, { x: 5.2, y: 0.12, z: 7.2 }), text: { value: "HEARTHLANDS\nRoll • Produce • Trade • Build\nHomestead: Timber + Clay + Grain + Fleece\nTrail: Timber + Clay\nTownship: 2 Grain + 3 Stone\nChronicle: Grain + Fleece + Stone\nFirst to 10 points on their own turn wins.\nFull guide: docs/games/hearthlands.md" }, appearance: { definitionId: "rules_board" } });
  entities.longest_text = entity("longest_text", { transform: transform(9.7, 0.3, 3.4), text: { value: "Longest Trail — unclaimed" }, appearance: { definitionId: "award_longest" } });
  entities.watch_text = entity("watch_text", { transform: transform(11.8, 0.3, 3.4), text: { value: "Largest Watch — unclaimed" }, appearance: { definitionId: "award_watch" } });

  for (const vertex of topology.vertices) entities[vertex.id] = entity(vertex.id, {
    transform: transform(vertex.position.x, 0.57, vertex.position.z),
    "snap-point": { radius: 0.44, capacity: 2, tags: ["settlement", "township"], alignment: null, attached: [] },
  });
  for (const edge of topology.edges) entities[edge.id] = entity(edge.id, {
    transform: transform(edge.position.x, 0.5, edge.position.z, { x: 1, y: 1, z: 1 }, edge.rotationY),
    "snap-point": { radius: 0.42, capacity: 1, tags: ["trail"], alignment: null, attached: [] },
  });
  const terrainTypes = [...CORE_TERRAINS, ...EXTRA_TERRAINS];
  const terrainIds: string[] = [];
  for (let index = 0; index < terrainTypes.length; index += 1) {
    const id = `terrain_${String(index + 1).padStart(2, "0")}`;
    terrainIds.push(id);
    entities[id] = entity(id, { transform: transform(-11, 0.3, 7), tags: { values: ["terrain"] }, card: { definitionId: `terrain_${terrainTypes[index]}`, faceUp: true }, appearance: { definitionId: `terrain_${terrainTypes[index]}` } });
  }
  entities.terrain_pool = entity("terrain_pool", { transform: transform(-11, 0.2, 7), container: { items: terrainIds, capacity: 30, ordering: "canonical", visibility: "public" } });
  const numberValues = [...CORE_NUMBERS, ...EXTRA_NUMBERS];
  const numberIds: string[] = [];
  for (let index = 0; index < numberValues.length; index += 1) {
    const id = `number_${String(index + 1).padStart(2, "0")}`;
    numberIds.push(id);
    entities[id] = entity(id, { transform: transform(-11, 0.45, 5.8), tags: { values: ["number"] }, card: { definitionId: `number_${numberValues[index]}`, faceUp: true }, appearance: { definitionId: `number_${numberValues[index]}` } });
  }
  entities.number_pool = entity("number_pool", { transform: transform(-11, 0.2, 5.8), container: { items: numberIds, capacity: 29, ordering: "canonical", visibility: "public" } });
  entities.bandit = entity("bandit", { transform: transform(-11, 0.72, 4.5), grabbable: { enabled: false, heldBy: null }, tags: { values: ["bandit"] }, appearance: { definitionId: "bandit" } });

  for (let seat = 1; seat <= 6; seat += 1) {
    const seatId = `seat_${seat}`;
    const center = ringLayout(6, 13.2, 0)[seat - 1]!;
    const handId = `hand_${seatId}`;
    entities[handId] = entity(handId, { container: { items: [], capacity: null, ordering: "canonical", visibility: `owner:${seatId}` }, hand: { owner: seatId, canonicalOrder: true } });
    entities[`score_${seatId}`] = entity(`score_${seatId}`, { transform: transform(center.x, 0.3, center.z), counter: { value: 0, default: 0, min: 0, max: 20 }, appearance: { definitionId: "score_counter", seat: seatId } });
    const kinds = [["trail", 15], ["homestead", 5], ["township", 4]] as const;
    let offset = 0;
    for (const [kind, count] of kinds) for (let index = 1; index <= count; index += 1) {
      const id = `${kind}_${seatId}_${String(index).padStart(2, "0")}`;
      const x = center.x + ((offset % 8) - 3.5) * 0.48;
      const z = center.z + 0.9 + Math.floor(offset / 8) * 0.52;
      const y = kind === "trail" ? 0.28 : 0.36;
      entities[id] = entity(id, {
        transform: transform(x, y, z), grabbable: { enabled: true, heldBy: null },
        tags: { values: [kind === "trail" ? "trail" : kind === "township" ? "township" : "settlement"] },
        appearance: { definitionId: kind, seat: seatId },
      });
      offset += 1;
    }
  }
  for (const resource of RESOURCES) {
    const ids: string[] = [];
    for (let index = 1; index <= 19; index += 1) {
      const id = `${resource}_${String(index).padStart(2, "0")}`;
      ids.push(id);
      entities[id] = entity(id, { transform: transform(0, 0, 0), card: { definitionId: `resource_${resource}`, faceUp: true }, appearance: { definitionId: `resource_${resource}` } });
    }
    const bankId = `bank_${resource}`;
    refs[bankId] = bankId;
    entities[bankId] = entity(bankId, { transform: transform(-11 + RESOURCES.indexOf(resource) * 1.1, 0.2, -6.8), container: { items: ids, capacity: 19, ordering: "canonical", visibility: "public" } });
    entities[`bank_count_${resource}`] = entity(`bank_count_${resource}`, { transform: transform(-11 + RESOURCES.indexOf(resource) * 1.1, 0.3, -8), counter: { value: 19, default: 19, min: 0, max: 19 }, appearance: { definitionId: `resource_${resource}` } });
  }
  const chronicleKinds = [...Array(14).fill("warden"), ...Array(5).fill("monument"), ...Array(2).fill("road_crew"), ...Array(2).fill("harvest_boon"), ...Array(2).fill("guild_decree")];
  const chronicleIds: string[] = [];
  for (let index = 0; index < chronicleKinds.length; index += 1) {
    const id = `chronicle_${String(index + 1).padStart(2, "0")}`;
    chronicleIds.push(id);
    entities[id] = entity(id, { transform: transform(0, 0, 0), card: { definitionId: `chronicle_${chronicleKinds[index]}`, faceUp: false }, flippable: { flipped: false }, appearance: { definitionId: `chronicle_${chronicleKinds[index]}` } });
  }
  entities.chronicle_deck = entity("chronicle_deck", { transform: transform(9.8, 0.35, 6), container: { items: chronicleIds, capacity: 25, ordering: "top", visibility: "hidden" }, deck: { enabled: true }, appearance: { definitionId: "chronicle_back" } });
  entities.chronicle_discard = entity("chronicle_discard", { transform: transform(11.2, 0.35, 6), container: { items: [], capacity: 25, ordering: "canonical", visibility: "public" }, appearance: { definitionId: "chronicle_back" } });
  for (const [id, action, x] of [["roll_button", "roll", 8.8], ["trade_button", "trade", 10], ["sea_button", "maritime", 11.2], ["buy_button", "buy", 8.8], ["play_button", "play", 10], ["end_button", "end", 11.2]] as const) {
    const row = id === "roll_button" || id === "trade_button" || id === "sea_button" ? 8 : 9;
    entities[id] = entity(id, { transform: transform(x, 0.3, row), button: { enabled: true, label: action }, appearance: { definitionId: `button_${action}` } });
  }
  entities.die_one = entity("die_one", { transform: transform(7.8, 0.45, 8.4), die: { definitionId: "standard_d6", value: 1, faces: [1, 2, 3, 4, 5, 6] }, appearance: { definitionId: "die" } });
  entities.die_two = entity("die_two", { transform: transform(7.8, 0.45, 9.1), die: { definitionId: "standard_d6", value: 1, faces: [1, 2, 3, 4, 5, 6] }, appearance: { definitionId: "die" } });

  const coast = topology.edges.filter((edge) => edge.tileIds.length === 1).sort((a, b) => Math.atan2(a.position.z, a.position.x) - Math.atan2(b.position.z, b.position.x));
  const harborTypes = ["any", "timber", "any", "clay", "any", "grain", "any", "fleece", "stone"];
  const harbors: Array<{ vertices: readonly string[]; resource: string }> = [];
  for (let index = 0; index < harborTypes.length; index += 1) {
    const edge = coast[Math.floor(index * coast.length / harborTypes.length)]!;
    const resource = harborTypes[index]!;
    harbors.push({ vertices: edge.vertexIds, resource });
    const length = Math.hypot(edge.position.x, edge.position.z);
    const x = edge.position.x * (1 + 0.7 / length), z = edge.position.z * (1 + 0.7 / length);
    entities[`harbor_${index + 1}`] = entity(`harbor_${index + 1}`, { transform: transform(x, 0.24, z), lockable: { locked: true }, appearance: { definitionId: `harbor_${resource}` } });
  }
  const state = createInitialState({
    releaseId: RELEASE_ID,
    rng: { algorithm: "sfc32-v1", state: [1974011321, 382716405, 2981447711, 933114287], draws: 0 },
    settings: { targetScore: 10, expandedAtPlayers: 5 },
    seats: Object.fromEntries(Array.from({ length: 6 }, (_, index) => {
      const id = `seat_${index + 1}`;
      return [id, { id, playerId: null, handId: `hand_${id}`, scoreId: `score_${id}` }];
    })),
    entities,
  });
  return { state, harbors, refs };
}

function definitions(): NonNullable<BuiltinReleaseSource["definitions"]> {
  const result: Record<string, NonNullable<BuiltinReleaseSource["definitions"]>[string]> = {
    sea_frame: { shape: "board", size: { w: 16, d: 14, h: 0.16 }, color: "#1f6f86", label: "Hearthlands sea frame", face: { background: "#247d91", elements: [{ type: "circle", cx: 500, cy: 500, r: 360, fill: "#3e9aad", opacity: 0.55 }, { type: "text", x: 500, y: 105, text: "HEARTHLANDS", font: "serif", size: 100, weight: 800, align: "center", fill: "#eff8df" }] } },
    status_plaque: { shape: "board", size: { w: 9, d: 0.6, h: 0.15 }, color: "#25372b" }, rules_board: { shape: "board", size: { w: 5.2, d: 7.2, h: 0.12 }, color: "#efe0b6" },
    trail: { shape: "box", size: { w: 0.22, d: 1.05, h: 0.18 }, color: "#d8c08f", seatTint: true, label: "Trail" },
    homestead: { shape: "meeple", size: { w: 0.52, d: 0.52, h: 0.72 }, color: "#d8c08f", seatTint: true, label: "Homestead" },
    township: { shape: "meeple", size: { w: 0.72, d: 0.62, h: 0.9 }, color: "#d8c08f", seatTint: true, label: "Township" },
    bandit: { shape: "pawn", size: { w: 0.55, d: 0.55, h: 1.05 }, color: "#252329", label: "Bandit" },
    die: { shape: "cube", size: { w: 0.58, d: 0.58, h: 0.58 }, color: "#f1e8cd", label: "Production die" },
    score_counter: { shape: "disc", size: { w: 0.7, d: 0.7, h: 0.15 }, color: "#f2d675", seatTint: true, label: "Victory points" },
    award_longest: { shape: "token", size: { w: 1.8, d: 1.2, h: 0.12 }, color: "#c8923c", label: "Longest Trail", face: iconFace("LONGEST TRAIL", "road", "#7a4c20", "#c8923c") },
    award_watch: { shape: "token", size: { w: 1.8, d: 1.2, h: 0.12 }, color: "#526c78", label: "Largest Watch", face: iconFace("LARGEST WATCH", "shield", "#314b58", "#7894a0") },
    chronicle_back: { shape: "card", size: { w: 0.72, d: 1.02, h: 0.04 }, color: "#4a315a", backColor: "#251a31", label: "Chronicle", face: iconFace("CHRONICLE", "scroll", "#5b376e", "#b07bb5") },
  };
  const terrain: Record<string, [string, FaceIconName, `#${string}`, `#${string}`]> = {
    forest: ["Forest", "lumber", "#2f6a43", "#5c8c55"], clay: ["Clay Pits", "brick", "#9b4c32", "#ca7650"],
    fields: ["Fields", "wheat", "#c6922e", "#e5c75d"], pastures: ["Pastures", "wool", "#69a653", "#a9cc75"],
    highlands: ["Highlands", "ore", "#66717a", "#9ba4aa"], wasteland: ["Wasteland", "desert", "#b4935f", "#d7bd82"],
  };
  for (const [key, [label, icon, color, accent]] of Object.entries(terrain)) result[`terrain_${key}`] = { shape: "hex", size: { w: 2.56, d: 2.96, h: 0.16 }, color, label, face: iconFace(label, icon, color, accent) };
  for (let value = 2; value <= 12; value += 1) if (value !== 7) result[`number_${value}`] = { shape: "disc", size: { w: 0.62, d: 0.62, h: 0.08 }, color: value === 6 || value === 8 ? "#b3262e" : "#f6e8bd", label: String(value), face: numberFace(value) };
  const resourceArt: Record<Resource, [string, FaceIconName, `#${string}`, `#${string}`]> = {
    timber: ["Timber", "lumber", "#315f3f", "#6f955a"], clay: ["Clay", "brick", "#98472f", "#cc7250"], grain: ["Grain", "wheat", "#b88724", "#e2c354"], fleece: ["Fleece", "wool", "#7da965", "#b8d098"], stone: ["Stone", "ore", "#586975", "#899aa3"],
  };
  for (const [key, [label, icon, color, accent]] of Object.entries(resourceArt)) result[`resource_${key}`] = { shape: "card", size: { w: 0.7, d: 1, h: 0.04 }, color, backColor: "#263a32", label, face: iconFace(label, icon, color, accent), back: iconFace("HEARTHLANDS", "hand", "#263a32", "#486052") };
  const chronicles: Record<string, [string, FaceIconName]> = { warden: ["Warden", "shield"], monument: ["Monument", "tower"], road_crew: ["Road Crews", "road"], harvest_boon: ["Harvest Boon", "wheat"], guild_decree: ["Guild Decree", "gavel"] };
  for (const [key, [label, icon]] of Object.entries(chronicles)) result[`chronicle_${key}`] = { shape: "card", size: { w: 0.72, d: 1.02, h: 0.04 }, color: "#6a4778", backColor: "#251a31", label, face: iconFace(label.toUpperCase(), icon, "#644070", "#b07bb5"), back: iconFace("CHRONICLE", "scroll", "#251a31", "#5b376e") };
  for (const resource of ["any", ...RESOURCES]) result[`harbor_${resource}`] = { shape: "token", size: { w: 0.92, d: 0.62, h: 0.1 }, color: "#efe0b6", label: resource === "any" ? "3:1 Harbor" : `2:1 ${resource} Harbor`, face: iconFace(resource === "any" ? "3:1" : "2:1", "anchor", "#315d69", "#65a0a9") };
  for (const action of ["roll", "trade", "maritime", "buy", "play", "end"]) result[`button_${action}`] = { shape: "token", size: { w: 1, d: 0.6, h: 0.15 }, color: action === "end" ? "#a34a3e" : "#3f6d55", label: action.replace("_", " ") };
  return result;
}

export function buildHearthlandsRelease(): BuiltinReleaseSource {
  const topology = hexTopology(EXPANDED_COORDS, SIZE, 0.18);
  const runtime = topologyRuntime(topology);
  const { state, harbors, refs } = buildState(topology, runtime);
  const runtimeFile = canonicalStringify({ formatVersion: 1, releaseId: RELEASE_ID, ...runtime, harbors, rulesUrl: "docs/games/hearthlands.md" });
  return {
    formatVersion: 1, gameId: "builtin_hearthlands", releaseId: RELEASE_ID, releaseNumber: 1,
    kernelVersion: 1, luaApiVersion: 1, luaStdlibVersion: 1, networkProtocolVersion: 1,
    interactionMode: "scripted", minPlayers: 3, maxPlayers: 6,
    files: [{ path: "runtime/game.json", content: runtimeFile }, { path: SCRIPT_ID, content: buildLua(runtime, harbors) }],
    definitions: definitions(), refs, initialState: state,
  };
}

export const BUILTIN_RELEASE_BUILDER = { slug: "hearthlands", releaseNumber: 1, build: buildHearthlandsRelease } satisfies BuiltinReleaseBuilder;
