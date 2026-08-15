import { createSandbox, LuaError, type LuaValue } from "./index";

type JsonValue = LuaValue;
interface CreatorEntity { readonly components: Readonly<Record<string, unknown>>; readonly [key: string]: unknown }
interface CreatorState {
  readonly settings: Readonly<Record<string, boolean | number | string>>;
  readonly scriptState: unknown;
  readonly players: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly seats: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly entities: Readonly<Record<string, CreatorEntity>>;
}
export interface CreatorScriptBinding {
  readonly scriptId: string;
  readonly bindingId: string;
  readonly props: Readonly<Record<string, JsonValue>>;
  readonly entityId?: string;
}
export interface CreatorScriptInvocation {
  readonly state: CreatorState;
  readonly scriptState: JsonValue;
  readonly binding: CreatorScriptBinding;
  readonly functionName: string;
  readonly context: Readonly<Record<string, JsonValue>>;
  readonly readOnly: boolean;
  readonly bridge: {
    queue(action: { type: string; payload: JsonValue }): void;
    randomInt(min: number, max: number): number;
    randomFloat(): number;
    allocateTimerId(): string;
  };
}
export interface CreatorScriptInvocationResult {
  readonly ok: boolean;
  readonly handled?: boolean;
  readonly scriptState?: JsonValue;
  readonly allowed?: boolean;
  readonly reason?: string;
  readonly error?: { readonly kind: string; readonly message: string; readonly line?: number };
}

export const LUA_STDLIB_VERSION = 1 as const;

export interface CreatorScriptRuntimeOptions {
  readonly scripts: Readonly<Record<string, string>>;
  readonly refs?: Readonly<Record<string, string>>;
  readonly definitions?: Readonly<Record<string, JsonValue>>;
  readonly instructionBudget: number;
  readonly memoryBudgetBytes?: number;
}

export interface CreatorScriptRuntime {
  bindings(state: CreatorState): readonly CreatorScriptBinding[];
  invoke(request: CreatorScriptInvocation): Promise<CreatorScriptInvocationResult>;
  close(): void;
}

/** Every mutating proxy member and its one registered kernel action. */
export const PROXY_ACTIONS = Object.freeze({
  "Card.flip": "entity.flip",
  "Card.set_face_up": "entity.flip",
  "Deck.shuffle": "deck.shuffle",
  "Deck.draw_to": "deck.draw_to_container",
  "Hand.add": "container.move",
  "Hand.remove": "container.move",
  "Container.add": "container.move",
  "Container.remove": "container.move",
  "Container.move_to": "container.move",
  "Die.roll": "die.roll",
  "Counter.set": "counter.set",
  "Counter.add": "counter.add",
  "Counter.subtract": "counter.add",
  "Counter.reset": "counter.set",
  "SnapPoint.attach": "snap.attach",
  "Text.set": "text.set",
} as const);

const CREATOR_API_V1 = String.raw`
local host_queue = __queue
local host_random_int = __random_int
local host_random_float = __random_float
local host_timer_id = __timer_id
__queue, __random_int, __random_float, __timer_id = nil, nil, nil, nil

local function readonly(value, cache)
  if type(value) ~= "table" then return value end
  cache = cache or {}
  if cache[value] then return cache[value] end
  local proxy = {}
  cache[value] = proxy
  setmetatable(proxy, {
    __index = function(_, key) return readonly(value[key], cache) end,
    __newindex = function() error("read-only value", 2) end,
    __len = function() return #value end,
    __pairs = function()
      local key = nil
      return function()
        key = next(value, key)
        if key == nil then return nil end
        return key, readonly(value[key], cache)
      end
    end,
    __metatable = "locked",
  })
  return proxy
end

settings = readonly(settings)
props = readonly(props)
if __read_only then state = readonly(state) end

local proxy_cache = {}
local function entity_proxy(id)
  if id == nil or entities[id] == nil then return nil end
  if proxy_cache[id] then return proxy_cache[id] end
  local spec = entities[id]
  local proxy = { id = id }
  proxy_cache[id] = proxy

  if spec.card then
    proxy.is_face_up = spec.flippable and spec.flippable.flipped or spec.card.faceUp
    proxy.definition_id = spec.card.definitionId
    proxy.definition = definitions[spec.card.definitionId]
    proxy.flip = function() host_queue("entity.flip", { entityId = id }) end
    proxy.set_face_up = function(_, face_up)
      if type(face_up) ~= "boolean" then error("set_face_up expects a boolean", 2) end
      if face_up ~= proxy.is_face_up then host_queue("entity.flip", { entityId = id }) end
    end
  elseif spec.flippable then
    proxy.flip = function() host_queue("entity.flip", { entityId = id }) end
  end

  if spec.container then
    local function ordered_items()
      local result = {}
      for index, item_id in ipairs(spec.container.items) do result[index] = entity_proxy(item_id) end
      table.sort(result, function(a, b) return a.id < b.id end)
      return result
    end
    proxy.count = #spec.container.items
    proxy.list = function() return ordered_items() end
    proxy.contains = function(_, item) return item ~= nil and locations[item.id] == id end
    proxy.add = function(_, item, index)
      if item == nil then error("container:add expects an entity", 2) end
      host_queue("container.move", { entity = item.id, from = locations[item.id], to = id, index = index or #spec.container.items })
    end
    proxy.remove = function(_, item)
      if item == nil then error("container:remove expects an entity", 2) end
      host_queue("container.move", { entity = item.id, from = id, to = nil, index = 0 })
    end
    proxy.move_to = function(_, item, target, index)
      if item == nil or target == nil then error("container:move_to expects entity and target", 2) end
      local target_spec = entities[target.id]
      local target_count = target_spec and target_spec.container and #target_spec.container.items or 0
      host_queue("container.move", { entity = item.id, from = id, to = target.id, index = index or target_count })
    end
  end

  if spec.deck then
    proxy.shuffle = function() host_queue("deck.shuffle", { deckId = id }) end
    proxy.draw_to = function(_, target, count)
      if target == nil then error("deck:draw_to expects a container", 2) end
      host_queue("deck.draw_to_container", { deckId = id, target = target.id, count = count or 1 })
    end
  end
  if spec.die then
    proxy.value = spec.die.value
    proxy.faces = readonly(spec.die.faces)
    proxy.roll = function() host_queue("die.roll", { entityId = id }) end
  end
  if spec.counter then
    proxy.value = spec.counter.value
    proxy.set = function(_, value) host_queue("counter.set", { entityId = id, value = value }) end
    proxy.add = function(_, amount) host_queue("counter.add", { entityId = id, amount = amount }) end
    proxy.subtract = function(_, amount) host_queue("counter.add", { entityId = id, amount = -amount }) end
    proxy.reset = function() host_queue("counter.set", { entityId = id, value = spec.counter.default }) end
  end
  if spec.zone then
    local members = spec.zone.members or {}
    proxy.contains = function(_, item)
      if item == nil then return false end
      for _, member in ipairs(members) do if member == item.id then return true end end
      return false
    end
    proxy.entities = {}
    for index, member in ipairs(members) do proxy.entities[index] = entity_proxy(member) end
    table.sort(proxy.entities, function(a, b) return a.id < b.id end)
  end
  if spec.snap_point then
    local attached = spec.snap_point.attached or {}
    proxy.is_occupied = #attached >= spec.snap_point.capacity
    proxy.entities = {}
    for index, member in ipairs(attached) do proxy.entities[index] = entity_proxy(member) end
    table.sort(proxy.entities, function(a, b) return a.id < b.id end)
    proxy.attach = function(_, item)
      if item == nil then error("snap_point:attach expects an entity", 2) end
      host_queue("snap.attach", { snapPointId = id, entityId = item.id })
    end
  end
  if spec.button then proxy.is_enabled = spec.button.enabled end
  if spec.text then
    proxy.get = function() return spec.text.value end
    proxy.set = function(_, value) host_queue("text.set", { entityId = id, value = value }) end
  end
  return proxy
end

refs = {}
for name, id in pairs(ref_ids) do refs[name] = entity_proxy(id) end
refs = readonly(refs)
self = entity_proxy(self_id)

local player_cache = {}
local function player_proxy(spec)
  if player_cache[spec.id] then return player_cache[spec.id] end
  local proxy = { id = spec.id, name = spec.name, seat = spec.seat_id and readonly({ id = spec.seat_id }) or nil }
  player_cache[spec.id] = proxy
  if spec.hand_id then proxy.hand = entity_proxy(spec.hand_id) end
  return proxy
end
players = {
  list = function()
    local result = {}
    for index, spec in ipairs(player_specs) do result[index] = player_proxy(spec) end
    return result
  end,
  get = function(_, id)
    for _, spec in ipairs(player_specs) do if spec.id == id then return player_proxy(spec) end end
    return nil
  end,
  count = function() return #player_specs end,
  by_seat = function(_, seat_id)
    for _, spec in ipairs(player_specs) do if spec.seat_id == seat_id then return player_proxy(spec) end end
    return nil
  end,
}

scene = {
  get = function(_, id) return entity_proxy(id) end,
  find = function(_, name)
    for _, id in ipairs(entity_ids) do if entities[id].name == name then return entity_proxy(id) end end
    return nil
  end,
  query = function(_, query)
    local result = {}
    for _, id in ipairs(entity_ids) do
      local include = true
      if query and query.tags then
        local values = entities[id].tags and entities[id].tags.values or {}
        for _, wanted in ipairs(query.tags) do
          local found = false
          for _, actual in ipairs(values) do if wanted == actual then found = true end end
          if not found then include = false end
        end
      end
      if include then table.insert(result, entity_proxy(id)) end
    end
    return result
  end,
}

random = {
  int = function(_, min, max) return host_random_int(min, max) end,
  float = function() return host_random_float() end,
  choice = function(_, list) if #list == 0 then return nil end return list[host_random_int(1, #list)] end,
  shuffle = function(_, list)
    local result = {}
    for index, value in ipairs(list) do result[index] = value end
    for index = #result, 2, -1 do
      local target = host_random_int(1, index)
      result[index], result[target] = result[target], result[index]
    end
    return result
  end,
}

timer = {
  after = function(_, delay, callback_name)
    if type(callback_name) ~= "string" then error("timer callback must be a name", 2) end
    local timer_id = host_timer_id()
    local payload = { timerId = timer_id, delay = delay, callback = callback_name, scriptId = binding_script_id, bindingId = binding_id }
    if self_id then payload.entityId = self_id end
    host_queue("timer.register", payload)
    return timer_id
  end,
  cancel = function(_, timer_id) host_queue("timer.cancel", { timerId = timer_id }) end,
}

local function create_prompt(kind, player, schema)
  if player == nil or schema == nil then error("prompt expects a player and schema", 3) end
  local payload = { id = schema.id, kind = kind, playerId = player.id, title = schema.title or "" }
  if kind == "choice" then payload.choices = schema.choices end
  if kind == "number" then payload.min, payload.max, payload.step = schema.min, schema.max, schema.step or 1 end
  if schema.default ~= nil then payload.default = schema.default end
  host_queue("prompt.create", payload)
  return schema.id
end
ui = {
  prompt = function(_, player, schema) return create_prompt("choice", player, schema) end,
  confirm = function(_, player, schema) return create_prompt("confirm", player, schema) end,
  number_prompt = function(_, player, schema) return create_prompt("number", player, schema) end,
}
game, data = {}, {}

ctx = readonly(context)
if context.actor and context.actor.type == "player" then ctx_player_id = context.actor.playerId end
local mutable_ctx = { player = ctx_player_id and players:get(ctx_player_id) or nil }
for key, value in pairs(context) do mutable_ctx[key] = value end
local object_id = context.entity or context.entityId
if object_id then mutable_ctx.object = entity_proxy(object_id) end
ctx = readonly(mutable_ctx)
`;

const STDLIB_V1 = String.raw`
state.__stdlib = state.__stdlib or {}
state.__stdlib.turns = state.__stdlib.turns or { active = false, order = {}, index = 0 }
state.__stdlib.scores = state.__stdlib.scores or {}

turns = {
  start = function(_, first)
    local ordered = players:list()
    state.__stdlib.turns.order = {}
    for index, player in ipairs(ordered) do state.__stdlib.turns.order[index] = player.id end
    state.__stdlib.turns.index = 1
    if first then
      for index, id in ipairs(state.__stdlib.turns.order) do if id == first.id or id == first then state.__stdlib.turns.index = index end end
    end
    state.__stdlib.turns.active = #state.__stdlib.turns.order > 0
    return turns:current()
  end,
  current = function()
    if not state.__stdlib.turns.active then return nil end
    return players:get(state.__stdlib.turns.order[state.__stdlib.turns.index])
  end,
  next = function()
    if not state.__stdlib.turns.active or #state.__stdlib.turns.order == 0 then return nil end
    state.__stdlib.turns.index = (state.__stdlib.turns.index % #state.__stdlib.turns.order) + 1
    return turns:current()
  end,
  index = function() return state.__stdlib.turns.index end,
  is_current = function(_, player)
    local current = turns:current()
    return current ~= nil and player ~= nil and current.id == (player.id or player)
  end,
  stop = function() state.__stdlib.turns.active = false end,
}

local function score_id(subject) return type(subject) == "table" and subject.id or subject end
scores = {
  set = function(_, subject, value) state.__stdlib.scores[score_id(subject)] = value return value end,
  add = function(_, subject, amount)
    local id = score_id(subject)
    local value = (state.__stdlib.scores[id] or 0) + amount
    state.__stdlib.scores[id] = value
    return value
  end,
  get = function(_, subject) return state.__stdlib.scores[score_id(subject)] or 0 end,
  leader = function()
    local leader, best = nil, nil
    for _, player in ipairs(players:list()) do
      local value = scores:get(player)
      if best == nil or value > best then leader, best = player, value end
    end
    return leader
  end,
}
`;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function componentRecord(state: CreatorState, entityId: string): Record<string, unknown> {
  const components = state.entities[entityId]?.components ?? {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(components)) {
    if (key === "snap-point") result.snap_point = value;
    else if (key !== "script") result[key] = value;
  }
  const die = asRecord(result.die);
  if (die?.definitionId === "standard_d6" && die.faces === undefined) {
    result.die = { ...die, faces: [1, 2, 3, 4, 5, 6] };
  }
  const entity = state.entities[entityId] as unknown as Record<string, unknown> | undefined;
  if (typeof entity?.name === "string") result.name = entity.name;
  return result;
}

function runtimeBindings(state: CreatorState, scripts: Readonly<Record<string, string>>): CreatorScriptBinding[] {
  const result: CreatorScriptBinding[] = [];
  for (const entityId of Object.keys(state.entities).sort()) {
    const candidate = asRecord(state.entities[entityId]?.components.script);
    if (candidate === undefined || typeof candidate.scriptId !== "string" ||
      typeof candidate.bindingId !== "string" || scripts[candidate.scriptId] === undefined) continue;
    result.push({
      scriptId: candidate.scriptId,
      bindingId: candidate.bindingId,
      props: (asRecord(candidate.props) ?? {}) as { [key: string]: JsonValue },
      entityId,
    });
  }
  return result.sort((left, right) => left.bindingId < right.bindingId ? -1 : left.bindingId > right.bindingId ? 1 : 0);
}

function playerSpecs(state: CreatorState): Array<Record<string, JsonValue>> {
  const seated: Array<{ seatId: string; playerId: string }> = [];
  const assigned = new Set<string>();
  for (const seatId of Object.keys(state.seats).sort()) {
    const playerId = state.seats[seatId]?.playerId;
    if (typeof playerId === "string" && state.players[playerId] !== undefined && !assigned.has(playerId)) {
      seated.push({ seatId, playerId });
      assigned.add(playerId);
    }
  }
  const seatedIds = new Set(seated.map(({ playerId }) => playerId));
  const order = [...seated, ...Object.keys(state.players).sort().filter((id) => !seatedIds.has(id)).map(
    (playerId) => ({ seatId: "", playerId }),
  )];
  return order.map(({ playerId, seatId }) => {
    const player = state.players[playerId];
    let handId: string | undefined;
    for (const entityId of Object.keys(state.entities).sort()) {
      const hand = asRecord(state.entities[entityId]?.components.hand);
      if (hand?.owner === playerId || (seatId !== "" && hand?.owner === seatId)) { handId = entityId; break; }
    }
    return {
      id: playerId,
      name: typeof player?.name === "string" ? player.name : playerId,
      ...(seatId === "" ? {} : { seat_id: seatId }),
      ...(handId === undefined ? {} : { hand_id: handId }),
    };
  });
}

function invocationEnvironment(
  request: CreatorScriptInvocation,
  refs: Readonly<Record<string, string>>,
  definitions: Readonly<Record<string, JsonValue>>,
): Record<string, unknown> {
  const entityIds = Object.keys(request.state.entities).sort();
  const entities: Record<string, unknown> = {};
  const locations: Record<string, string | null> = {};
  for (const id of entityIds) entities[id] = componentRecord(request.state, id);
  for (const containerId of entityIds) {
    const container = asRecord(request.state.entities[containerId]?.components.container);
    if (!Array.isArray(container?.items)) continue;
    for (const itemId of container.items) if (typeof itemId === "string") locations[itemId] = containerId;
  }
  return {
    state: request.scriptState,
    settings: request.state.settings,
    props: request.binding.props,
    context: request.context,
    entities,
    locations,
    entity_ids: entityIds,
    player_specs: playerSpecs(request.state),
    ref_ids: refs,
    definitions,
    self_id: request.binding.entityId ?? null,
    binding_script_id: request.binding.scriptId,
    binding_id: request.binding.bindingId,
    __read_only: request.readOnly,
    __queue: (type: LuaValue, payload: LuaValue) => {
      if (request.readOnly) throw new Error("guards cannot queue canonical mutations");
      if (typeof type !== "string") throw new TypeError("action type must be a string");
      let canonicalPayload = payload as JsonValue;
      if (type === "container.move" && typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
        canonicalPayload = {
          ...payload,
          from: Object.prototype.hasOwnProperty.call(payload, "from") ? (payload.from ?? null) : null,
          to: Object.prototype.hasOwnProperty.call(payload, "to") ? (payload.to ?? null) : null,
        };
      }
      request.bridge.queue({ type, payload: canonicalPayload });
      return null;
    },
    __random_int: (min: LuaValue, max: LuaValue) => {
      if (typeof min !== "number" || typeof max !== "number") throw new TypeError("random:int expects numbers");
      return request.bridge.randomInt(min, max);
    },
    __random_float: () => request.bridge.randomFloat(),
    __timer_id: () => request.bridge.allocateTimerId(),
  };
}

export async function createCreatorScriptRuntime(options: CreatorScriptRuntimeOptions): Promise<CreatorScriptRuntime> {
  const sandbox = await createSandbox({
    instructionBudget: options.instructionBudget,
    ...(options.memoryBudgetBytes === undefined ? {} : { memoryBudgetBytes: options.memoryBudgetBytes }),
  });
  const scripts = Object.freeze({ ...options.scripts });
  const refs = Object.freeze({ ...(options.refs ?? {}) });
  const definitions = Object.freeze({ ...(options.definitions ?? {}) });
  return {
    bindings(state) { return runtimeBindings(state, scripts); },
    async invoke(request): Promise<CreatorScriptInvocationResult> {
      const source = scripts[request.binding.scriptId];
      if (source === undefined) return {
        ok: false,
        error: { kind: "runtime", message: `Unknown script: ${request.binding.scriptId}` },
      };
      const loadPrefix = `${CREATOR_API_V1}\n${request.readOnly ? "" : STDLIB_V1}\nlocal function __load_script()\n`;
      const wrapper = `${loadPrefix}${source}\nend\n__load_script()\nlocal __fn = _G[__function_name]\nif __fn == nil then return { handled = false, state = state } end\nlocal __first, __second = __fn(ctx)\nreturn { handled = true, state = state, allowed = __first, reason = __second }`;
      try {
        const value = await sandbox.run(wrapper, {
          ...invocationEnvironment(request, refs, definitions),
          __function_name: request.functionName,
        });
        const record = asRecord(value);
        if (record === undefined) throw new TypeError("Creator callback returned an invalid runtime envelope");
        return {
          ok: true,
          handled: record.handled === true,
          ...(request.readOnly ? {} : { scriptState: record.state as JsonValue }),
          ...(record.allowed === false || record.allowed === true ? { allowed: record.allowed } : {}),
          ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
        };
      } catch (error) {
        if (error instanceof LuaError) {
          const sourceLine = error.line === undefined ? undefined : error.line - loadPrefix.split("\n").length + 1;
          return {
            ok: false,
            error: {
              kind: error.kind,
              message: error.message,
              ...(sourceLine !== undefined && sourceLine > 0 ? { line: sourceLine } : {}),
            },
          };
        }
        return { ok: false, error: { kind: "runtime", message: error instanceof Error ? error.message : String(error) } };
      }
    },
    close() { sandbox.close(); },
  };
}

export function scriptsFromReleaseFiles(
  files: readonly { path: string; content: string }[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of [...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)) {
    if (file.path.startsWith("scripts/") && file.path.endsWith(".lua")) result[file.path] = file.content;
  }
  return result;
}
