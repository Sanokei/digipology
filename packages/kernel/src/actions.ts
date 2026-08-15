import { canonicalStringify } from "digipology-canonical-json";
import {
  canonicalizeTransform,
  canonicalUtf8ByteLength,
  cloneCanonical,
  TEXT_MAX_UTF8_BYTES,
  transformProblem,
} from "./canonical";
import type {
  ActionDefinition,
  ActionInstance,
  ApplyContext,
  ButtonComponent,
  CanonicalGameState,
  ContainerComponent,
  CounterComponent,
  DieComponent,
  EntityId,
  EntityRecord,
  FlippableComponent,
  GrabbableComponent,
  JsonValue,
  LockableComponent,
  PlayerRecord,
  PromptKind,
  PromptRecord,
  Reject,
  Settings,
  SnapPointComponent,
  StackId,
  StackRecord,
  StackableComponent,
  TagsComponent,
  TextComponent,
  TimerRecord,
  TransformComponent,
  ValidationResult,
  ZoneComponent,
} from "./types";

const OK: Readonly<{ ok: true }> = Object.freeze({ ok: true });
const hasOwn = Object.prototype.hasOwnProperty;

function reject(reason: string): Reject {
  return { reason };
}

function guardResult(
  decision: boolean | { allowed: boolean; reason?: string },
  fallback: string,
): ValidationResult {
  if (decision === true || (typeof decision === "object" && decision.allowed)) return OK;
  return reject(
    typeof decision === "object" && typeof decision.reason === "string"
      ? decision.reason
      : fallback,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedEntityIds(state: Readonly<CanonicalGameState>): string[] {
  return Object.keys(state.entities).sort(compareIds);
}

function hasEntityComponent(
  state: Readonly<CanonicalGameState>,
  componentType: string,
): boolean {
  // This is only a presence fast-path; iteration order cannot affect the result.
  for (const entityId of Object.keys(state.entities)) {
    if (state.entities[entityId]?.components[componentType] !== undefined) return true;
  }
  return false;
}

function entityPayload(action: ActionInstance<unknown>):
  | { entityId: EntityId }
  | Reject {
  if (
    !isRecord(action.payload) ||
    !onlyKeys(action.payload, ["entityId"]) ||
    typeof action.payload.entityId !== "string"
  ) {
    return reject("Payload must contain only a string entityId");
  }
  return { entityId: action.payload.entityId };
}

function getEntity(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
): EntityRecord | undefined {
  return hasOwn.call(state.entities, entityId) ? state.entities[entityId] : undefined;
}

function requireComponent<T>(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
  componentType: string,
): T | Reject {
  const entity = getEntity(state, entityId);
  if (entity === undefined) return reject(`Unknown entity: ${entityId}`);
  const component = entity.components[componentType];
  if (component === undefined) {
    return reject(`Entity ${entityId} lacks ${componentType}`);
  }
  return component as T;
}

function isReject(value: unknown): value is Reject {
  return isRecord(value) && typeof value.reason === "string";
}

interface ContainerTransfer {
  entity: EntityId;
  from: EntityId | null;
  to: EntityId | null;
  index: number;
}

interface PlacementLocation {
  id: string;
  index: number;
}

function containerContaining(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
): PlacementLocation | undefined {
  if (!hasEntityComponent(state, "container")) return undefined;
  for (const containerId of sortedEntityIds(state)) {
    const container = state.entities[containerId]?.components.container as
      | ContainerComponent
      | undefined;
    const index = container?.items.indexOf(entityId) ?? -1;
    if (index >= 0) return { id: containerId, index };
  }
  return undefined;
}

function stackContaining(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
): PlacementLocation | undefined {
  if (state.stacks === undefined) return undefined;
  const stackIds = Object.keys(state.stacks ?? {}).sort(compareIds);
  for (const stackId of stackIds) {
    const index = state.stacks?.[stackId]?.items.indexOf(entityId) ?? -1;
    if (index >= 0) return { id: stackId, index };
  }
  return undefined;
}

function snapContaining(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
): PlacementLocation | undefined {
  if (!hasEntityComponent(state, "snap-point")) return undefined;
  for (const snapPointId of sortedEntityIds(state)) {
    const snapPoint = state.entities[snapPointId]?.components["snap-point"] as
      | SnapPointComponent
      | undefined;
    const index = snapPoint?.attached?.indexOf(entityId) ?? -1;
    if (index >= 0) return { id: snapPointId, index };
  }
  return undefined;
}

function exclusivePlacement(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
): { type: "container" | "stack" | "snap"; location: PlacementLocation } | undefined {
  const container = containerContaining(state, entityId);
  if (container !== undefined) return { type: "container", location: container };
  const stack = stackContaining(state, entityId);
  if (stack !== undefined) return { type: "stack", location: stack };
  const snap = snapContaining(state, entityId);
  return snap === undefined ? undefined : { type: "snap", location: snap };
}

function validateContainerTransfer(
  state: Readonly<CanonicalGameState>,
  transfer: ContainerTransfer,
): ValidationResult {
  if (getEntity(state, transfer.entity) === undefined) {
    return reject(`Unknown entity: ${transfer.entity}`);
  }
  if (transfer.from === transfer.to) return reject("Source and target must differ");
  if (!Number.isSafeInteger(transfer.index) || transfer.index < 0) {
    return reject("index must be a non-negative safe integer");
  }
  const current = exclusivePlacement(state, transfer.entity);
  if (transfer.from === null) {
    if (current !== undefined) {
      return reject(`Entity ${transfer.entity} is not in the world`);
    }
  } else {
    const source = requireComponent<ContainerComponent>(state, transfer.from, "container");
    if (isReject(source)) return source;
    if (
      current?.type !== "container" ||
      current.location.id !== transfer.from
    ) {
      return reject(`Entity ${transfer.entity} is not in source container ${transfer.from}`);
    }
  }
  if (transfer.to === null) {
    return transfer.index === 0 ? OK : reject("World transfer index must equal 0");
  }
  const target = requireComponent<ContainerComponent>(state, transfer.to, "container");
  if (isReject(target)) return target;
  if (target.capacity !== null && target.items.length >= target.capacity) {
    return reject("Target container has insufficient capacity");
  }
  if (transfer.index > target.items.length) {
    return reject("index exceeds target container length");
  }
  return OK;
}

function applyContainerTransfer(
  draft: CanonicalGameState,
  transfer: ContainerTransfer,
): { fromIndex: number | null; toIndex: number | null } {
  let fromIndex: number | null = null;
  if (transfer.from !== null) {
    const source = draft.entities[transfer.from]?.components.container as
      | ContainerComponent
      | undefined;
    if (source === undefined) throw new Error("Validated source container disappeared");
    fromIndex = source.items.indexOf(transfer.entity);
    if (fromIndex < 0) throw new Error("Validated source membership disappeared");
    source.items.splice(fromIndex, 1);
  }
  let toIndex: number | null = null;
  if (transfer.to !== null) {
    const target = draft.entities[transfer.to]?.components.container as
      | ContainerComponent
      | undefined;
    if (target === undefined) throw new Error("Validated target container disappeared");
    toIndex = transfer.index;
    target.items.splice(transfer.index, 0, transfer.entity);
  }
  return { fromIndex, toIndex };
}

function tagsForEntity(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
): readonly string[] {
  const tags = state.entities[entityId]?.components.tags as TagsComponent | undefined;
  return tags?.values ?? [];
}

function tagsCompatible(required: readonly string[], actual: readonly string[]): boolean {
  return required.length === 0 || required.some((tag) => actual.includes(tag));
}

function inverseRotatePosition(
  position: TransformComponent["position"],
  center: TransformComponent["position"],
  rotation: TransformComponent["rotation"],
): TransformComponent["position"] {
  const magnitude = Math.sqrt(
    rotation.x * rotation.x +
      rotation.y * rotation.y +
      rotation.z * rotation.z +
      rotation.w * rotation.w,
  );
  const qx = -rotation.x / magnitude;
  const qy = -rotation.y / magnitude;
  const qz = -rotation.z / magnitude;
  const qw = rotation.w / magnitude;
  const x = position.x - center.x;
  const y = position.y - center.y;
  const z = position.z - center.z;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return {
    x: x + qw * tx + (qy * tz - qz * ty),
    y: y + qw * ty + (qz * tx - qx * tz),
    z: z + qw * tz + (qx * ty - qy * tx),
  };
}

function entityIsInsideZone(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
  zoneId: EntityId,
): boolean {
  if (entityId === zoneId || containerContaining(state, entityId) !== undefined) {
    return false;
  }
  const entityTransform = state.entities[entityId]?.components.transform as
    | TransformComponent
    | undefined;
  const zoneEntity = state.entities[zoneId];
  const zone = zoneEntity?.components.zone as ZoneComponent | undefined;
  const zoneTransform = zoneEntity?.components.transform as TransformComponent | undefined;
  if (entityTransform === undefined || zone === undefined || zoneTransform === undefined) {
    return false;
  }
  if (!tagsCompatible(zone.acceptedTags, tagsForEntity(state, entityId))) {
    return false;
  }
  const local = inverseRotatePosition(
    entityTransform.position,
    zoneTransform.position,
    zoneTransform.rotation,
  );
  if (zone.shape === "box") {
    return (
      Math.abs(local.x) <= zoneTransform.scale.x / 2 &&
      Math.abs(local.y) <= zoneTransform.scale.y / 2 &&
      Math.abs(local.z) <= zoneTransform.scale.z / 2
    );
  }
  const radius = Math.max(
    zoneTransform.scale.x,
    zoneTransform.scale.y,
    zoneTransform.scale.z,
  ) / 2;
  return local.x * local.x + local.y * local.y + local.z * local.z <= radius * radius;
}

/**
 * Recompute semantic zone membership in zone-ID then entity-ID order. Rendering
 * frames never call this; only canonical placement transitions do.
 */
export function recomputeZoneMembership(
  draft: CanonicalGameState,
  entityIds: readonly EntityId[],
  ctx: Pick<ApplyContext, "emit">,
): void {
  if (!hasEntityComponent(draft, "zone")) return;
  const affected = [...new Set(entityIds)].sort(compareIds);
  const zoneIds = sortedEntityIds(draft).filter(
    (entityId) => draft.entities[entityId]?.components.zone !== undefined,
  );
  for (const zoneId of zoneIds) {
    const zone = draft.entities[zoneId]?.components.zone as ZoneComponent | undefined;
    if (zone === undefined) continue;
    const members = new Set(zone.members ?? []);
    let changed = false;
    for (const entityId of affected) {
      const wasMember = members.has(entityId);
      const isMember = entityIsInsideZone(draft, entityId, zoneId);
      if (wasMember === isMember) continue;
      changed = true;
      if (isMember) {
        members.add(entityId);
        ctx.emit("zone.entered", { zoneId, entityId });
      } else {
        members.delete(entityId);
        ctx.emit("zone.left", { zoneId, entityId });
      }
    }
    if (changed || zone.members !== undefined) {
      zone.members = [...members].sort(compareIds);
    }
  }
}

function squaredDistance(
  left: TransformComponent["position"],
  right: TransformComponent["position"],
): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  const z = left.z - right.z;
  return x * x + y * y + z * z;
}

function snapAcceptsEntity(
  state: Readonly<CanonicalGameState>,
  snapPointId: EntityId,
  entityId: EntityId,
): boolean {
  const snapPoint = state.entities[snapPointId]?.components["snap-point"] as
    | SnapPointComponent
    | undefined;
  if (snapPoint === undefined) return false;
  const attached = snapPoint.attached ?? [];
  const occupiesPoint = attached.includes(entityId);
  return (
    (occupiesPoint || attached.length < snapPoint.capacity) &&
    tagsCompatible(snapPoint.tags, tagsForEntity(state, entityId))
  );
}

function nearestSnapPoint(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
): EntityId | undefined {
  if (!hasEntityComponent(state, "snap-point")) return undefined;
  const transform = state.entities[entityId]?.components.transform as
    | TransformComponent
    | undefined;
  if (transform === undefined) return undefined;
  let selected: { id: EntityId; distance: number } | undefined;
  for (const candidateId of sortedEntityIds(state)) {
    if (candidateId === entityId) continue;
    if (!snapAcceptsEntity(state, candidateId, entityId)) continue;
    const candidate = state.entities[candidateId];
    const snapPoint = candidate?.components["snap-point"] as
      | SnapPointComponent
      | undefined;
    const candidateTransform = candidate?.components.transform as
      | TransformComponent
      | undefined;
    if (snapPoint === undefined || candidateTransform === undefined) continue;
    const distance = squaredDistance(transform.position, candidateTransform.position);
    if (distance > snapPoint.radius * snapPoint.radius) continue;
    if (
      selected === undefined ||
      distance < selected.distance ||
      (distance === selected.distance && compareIds(candidateId, selected.id) < 0)
    ) {
      selected = { id: candidateId, distance };
    }
  }
  return selected?.id;
}

function detachSnap(
  draft: CanonicalGameState,
  entityId: EntityId,
  ctx: Pick<ApplyContext, "emit">,
): boolean {
  const location = snapContaining(draft, entityId);
  if (location === undefined) return false;
  const snapPoint = draft.entities[location.id]?.components["snap-point"] as
    | SnapPointComponent
    | undefined;
  if (snapPoint?.attached === undefined) throw new Error("Snap attachment disappeared");
  snapPoint.attached.splice(location.index, 1);
  ctx.emit("snap.detached", { snapPointId: location.id, entityId });
  return true;
}

function attachSnap(
  draft: CanonicalGameState,
  snapPointId: EntityId,
  entityId: EntityId,
  ctx: Pick<ApplyContext, "emit">,
): void {
  const snapPoint = draft.entities[snapPointId]?.components["snap-point"] as
    | SnapPointComponent
    | undefined;
  if (snapPoint === undefined) throw new Error("Validated snap-point disappeared");
  snapPoint.attached = [...(snapPoint.attached ?? []), entityId].sort(compareIds);
  ctx.emit("snap.attached", { snapPointId, entityId });
}

function stacks(draft: CanonicalGameState): Record<StackId, StackRecord> {
  if (draft.stacks === undefined) draft.stacks = {};
  return draft.stacks;
}

function removeFromStack(
  draft: CanonicalGameState,
  entityId: EntityId,
  ctx: Pick<ApplyContext, "emit">,
): boolean {
  const location = stackContaining(draft, entityId);
  if (location === undefined) return false;
  const stack = draft.stacks?.[location.id];
  if (stack === undefined) throw new Error("Stack membership disappeared");
  stack.items.splice(location.index, 1);
  if (stack.items.length === 0) {
    delete draft.stacks?.[location.id];
    ctx.emit("stack.dissolved", { stackId: location.id, items: [] });
  } else {
    ctx.emit("stack.changed", {
      stackId: location.id,
      items: [...stack.items],
      removed: entityId,
    });
  }
  return true;
}

function detachExclusivePlacement(
  draft: CanonicalGameState,
  entityId: EntityId,
  ctx: Pick<ApplyContext, "emit">,
): void {
  const container = containerContaining(draft, entityId);
  if (container !== undefined) {
    const moved = applyContainerTransfer(draft, {
      entity: entityId,
      from: container.id,
      to: null,
      index: 0,
    });
    ctx.emit("container.removed", {
      containerId: container.id,
      entityId,
      index: moved.fromIndex as number,
    });
    return;
  }
  if (detachSnap(draft, entityId, ctx)) return;
  removeFromStack(draft, entityId, ctx);
}

function canLeaveCurrentPlacement(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
): ValidationResult {
  const location = stackContaining(state, entityId);
  if (location === undefined) return OK;
  const stack = state.stacks?.[location.id];
  return location.index === (stack?.items.length ?? 0) - 1
    ? OK
    : reject("Only the canonical stack top can be moved");
}

function stackTarget(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
): EntityId | undefined {
  const entity = state.entities[entityId];
  const transform = entity?.components.transform as TransformComponent | undefined;
  const stackable = entity?.components.stackable as StackableComponent | undefined;
  if (transform === undefined || stackable?.enabled !== true) return undefined;
  for (const candidateId of sortedEntityIds(state)) {
    if (candidateId === entityId) continue;
    const candidate = state.entities[candidateId];
    const capability = candidate?.components.stackable as StackableComponent | undefined;
    const candidateTransform = candidate?.components.transform as
      | TransformComponent
      | undefined;
    if (capability?.enabled !== true || candidateTransform === undefined) continue;
    if (squaredDistance(transform.position, candidateTransform.position) !== 0) continue;
    const placement = exclusivePlacement(state, candidateId);
    if (placement?.type === "container" || placement?.type === "snap") continue;
    if (placement?.type === "stack") {
      const stack = state.stacks?.[placement.location.id];
      if (placement.location.index !== (stack?.items.length ?? 0) - 1) continue;
    }
    return candidateId;
  }
  return undefined;
}

function implicitStackId(state: Readonly<CanonicalGameState>, actionId: string): StackId {
  const base = `stack_${actionId}`;
  if (!hasOwn.call(state.stacks ?? {}, base)) return base;
  let index = 1;
  while (hasOwn.call(state.stacks ?? {}, `${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function resolveStackDrop(
  draft: CanonicalGameState,
  entityId: EntityId,
  actionId: string,
  ctx: Pick<ApplyContext, "emit">,
): boolean {
  const targetId = stackTarget(draft, entityId);
  if (targetId === undefined) return false;
  const targetStack = stackContaining(draft, targetId);
  if (targetStack !== undefined) {
    const stack = draft.stacks?.[targetStack.id];
    if (stack === undefined) throw new Error("Stack target disappeared");
    stack.items.push(entityId);
    ctx.emit("stack.changed", {
      stackId: stack.id,
      items: [...stack.items],
      added: entityId,
    });
    return true;
  }
  const stackId = implicitStackId(draft, actionId);
  const stack: StackRecord = { id: stackId, items: [targetId, entityId] };
  stacks(draft)[stackId] = stack;
  ctx.emit("stack.created", { stackId, items: [...stack.items] });
  return true;
}

/** Resolve public/owner container visibility without exposing hidden membership. */
export function canPlayerViewContainer(
  state: Readonly<CanonicalGameState>,
  containerId: EntityId,
  playerId: string,
): boolean {
  const entity = state.entities[containerId];
  const container = entity?.components.container as ContainerComponent | undefined;
  if (container === undefined) return false;
  if (container.visibility === "public") return true;
  let owner: string | undefined;
  if (container.visibility === "owner") {
    owner = (entity?.components.hand as { owner?: unknown } | undefined)?.owner as
      | string
      | undefined;
  } else if (container.visibility.startsWith("owner:")) {
    owner = container.visibility.slice("owner:".length);
  }
  if (owner === undefined || owner.length === 0) return false;
  if (owner === playerId) return true;
  return state.seats[owner]?.playerId === playerId;
}

function validateSettings(value: unknown): value is Settings {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    const setting = value[key];
    if (
      typeof setting !== "boolean" &&
      typeof setting !== "number" &&
      typeof setting !== "string"
    ) {
      return false;
    }
    if (typeof setting === "number" && !Number.isFinite(setting)) return false;
  }
  return true;
}

const gameStart: ActionDefinition<unknown> = {
  type: "system.game_start",
  version: 1,
  sources: ["system"],
  validate(state, action) {
    if (state.sequence !== 0) return reject("Game has already started");
    if (!isRecord(action.payload) || !onlyKeys(action.payload, ["settings"])) {
      return reject("Payload must be an object with optional settings");
    }
    if (hasOwn.call(action.payload, "settings") && !validateSettings(action.payload.settings)) {
      return reject("settings must contain finite primitive values");
    }
    return OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as { settings?: Settings };
    if (payload.settings !== undefined) draft.settings = cloneCanonical(payload.settings);
    ctx.emit("game.started", { settings: cloneCanonical(draft.settings) });
  },
};

const STANDARD_D6_FACES: ReadonlyArray<number | string> = Object.freeze([
  1, 2, 3, 4, 5, 6,
]);

function dieFaces(die: DieComponent): ReadonlyArray<number | string> | Reject {
  if (die.faces === undefined) {
    return die.definitionId === "standard_d6"
      ? STANDARD_D6_FACES
      : reject(`Die definition ${die.definitionId} has no configured faces`);
  }
  if (
    !Array.isArray(die.faces) ||
    die.faces.length === 0 ||
    die.faces.some(
      (face) =>
        (typeof face !== "number" || !Number.isFinite(face)) &&
        typeof face !== "string",
    )
  ) {
    return reject("Die faces must be a non-empty array of finite numbers or strings");
  }
  return die.faces;
}

const dieRoll: ActionDefinition<unknown> = {
  type: "die.roll",
  version: 1,
  sources: ["player", "script"],
  validate(state, action) {
    const payload = entityPayload(action);
    if (isReject(payload)) return payload;
    const die = requireComponent<DieComponent>(state, payload.entityId, "die");
    if (isReject(die)) return die;
    const faces = dieFaces(die);
    if (isReject(faces)) return faces;
    const grabbable = state.entities[payload.entityId]?.components.grabbable as
      | GrabbableComponent
      | undefined;
    if (grabbable?.heldBy !== null && grabbable?.heldBy !== undefined) {
      const actorPlayerId =
        action.actor.type === "player" ? action.actor.playerId : undefined;
      if (grabbable.heldBy !== actorPlayerId) {
        return reject("Die is held by another player");
      }
    }
    return OK;
  },
  apply(draft, action, ctx) {
    const { entityId } = action.payload as { entityId: string };
    const die = draft.entities[entityId]?.components.die as DieComponent | undefined;
    if (die === undefined) throw new Error("Validated die disappeared");
    const faces = dieFaces(die);
    if (isReject(faces)) throw new Error("Validated die faces disappeared");
    const value = faces[ctx.rng.int(0, faces.length - 1)];
    if (value === undefined) throw new Error("Validated die has no faces");
    die.value = value;
    ctx.emit("die.rolled", { entityId, value });
  },
};

function playerPayload(action: ActionInstance<unknown>):
  | { playerId: string; name?: string }
  | Reject {
  if (
    !isRecord(action.payload) ||
    !onlyKeys(action.payload, ["playerId", "name"]) ||
    typeof action.payload.playerId !== "string" ||
    action.payload.playerId.length === 0 ||
    (hasOwn.call(action.payload, "name") && typeof action.payload.name !== "string")
  ) {
    return reject("Payload requires playerId and optional name strings");
  }
  return {
    playerId: action.payload.playerId,
    ...(typeof action.payload.name === "string" ? { name: action.payload.name } : {}),
  };
}

const playerJoined: ActionDefinition<unknown> = {
  type: "system.player_joined",
  version: 1,
  sources: ["system"],
  validate(state, action) {
    const payload = playerPayload(action);
    if (isReject(payload)) return payload;
    if (hasOwn.call(state.players, payload.playerId)) {
      return reject(`Player already exists: ${payload.playerId}`);
    }
    return OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as { playerId: string; name?: string };
    const player: PlayerRecord = {
      id: payload.playerId,
      ...(payload.name === undefined ? {} : { name: payload.name }),
    };
    draft.players[payload.playerId] = player;
    ctx.emit("player.joined", { player: cloneCanonical(player) });
  },
};

const playerLeft: ActionDefinition<unknown> = {
  type: "system.player_left",
  version: 1,
  sources: ["system"],
  validate(state, action) {
    const payload = playerPayload(action);
    if (isReject(payload) || payload.name !== undefined) {
      return isReject(payload)
        ? payload
        : reject("Payload must contain only playerId");
    }
    return hasOwn.call(state.players, payload.playerId)
      ? OK
      : reject(`Unknown player: ${payload.playerId}`);
  },
  apply(draft, action, ctx) {
    const { playerId } = action.payload as { playerId: string };
    const entityIds = Object.keys(draft.entities).sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (const entityId of entityIds) {
      const grabbable = draft.entities[entityId]?.components.grabbable as
        | GrabbableComponent
        | undefined;
      if (grabbable?.heldBy !== playerId) continue;
      grabbable.heldBy = null;
      ctx.emit("entity.dropped", { entityId, playerId, reason: "player_left" });
    }
    const seatIds = Object.keys(draft.seats).sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (const seatId of seatIds) {
      const seat = draft.seats[seatId];
      if (seat?.playerId !== playerId) continue;
      seat.playerId = null;
      ctx.emit("seat.left", { playerId, seatId });
    }
    delete draft.players[playerId];
    ctx.emit("player.left", { playerId });
  },
};

const seatAssign: ActionDefinition<unknown> = {
  type: "system.seat_assign",
  version: 1,
  sources: ["system"],
  validate(state, action) {
    if (
      !isRecord(action.payload) ||
      !onlyKeys(action.payload, ["playerId", "seatId"]) ||
      typeof action.payload.playerId !== "string" ||
      action.payload.playerId.length === 0 ||
      typeof action.payload.seatId !== "string" ||
      action.payload.seatId.length === 0
    ) {
      return reject("Payload requires only non-empty playerId and seatId strings");
    }
    return hasOwn.call(state.players, action.payload.playerId)
      ? OK
      : reject(`Unknown player: ${action.payload.playerId}`);
  },
  apply(draft, action, ctx) {
    const { playerId, seatId } = action.payload as {
      playerId: string;
      seatId: string;
    };
    const seat = draft.seats[seatId];
    draft.seats[seatId] =
      seat === undefined ? { id: seatId, playerId } : { ...seat, playerId };
    ctx.emit("seat.assigned", { playerId, seatId });
  },
};

const entityGrab: ActionDefinition<unknown> = {
  type: "entity.grab",
  version: 1,
  sources: ["player"],
  validate(state, action, context) {
    const payload = entityPayload(action);
    if (isReject(payload)) return payload;
    const grabbable = requireComponent<GrabbableComponent>(
      state,
      payload.entityId,
      "grabbable",
    );
    if (isReject(grabbable)) return grabbable;
    if (!grabbable.enabled) return reject("Entity is not grabbable");
    if (grabbable.heldBy !== null) return reject("Entity is already held");
    const lockable = state.entities[payload.entityId]?.components.lockable as
      | LockableComponent
      | undefined;
    if (lockable?.locked === true) return reject("Entity is locked");
    const placement = canLeaveCurrentPlacement(state, payload.entityId);
    if (isReject(placement)) return placement;
    if (context !== undefined) {
      return guardResult(
        context.canGrab(state, action, payload.entityId),
        "Entity grab denied by can_grab guard",
      );
    }
    return OK;
  },
  apply(draft, action, ctx) {
    const { entityId } = action.payload as { entityId: string };
    const playerId = (action.actor as { playerId: string }).playerId;
    const grabbable = draft.entities[entityId]?.components.grabbable as
      | GrabbableComponent
      | undefined;
    if (grabbable === undefined) throw new Error("Validated grabbable disappeared");
    grabbable.heldBy = playerId;
    ctx.emit("entity.grabbed", { entityId, playerId });
  },
};

const entityDrop: ActionDefinition<unknown> = {
  type: "entity.drop",
  version: 1,
  sources: ["player"],
  validate(state, action, context) {
    if (
      !isRecord(action.payload) ||
      !onlyKeys(action.payload, ["entityId", "transform"]) ||
      typeof action.payload.entityId !== "string"
    ) {
      return reject("Payload must contain entityId and transform");
    }
    const grabbable = requireComponent<GrabbableComponent>(
      state,
      action.payload.entityId,
      "grabbable",
    );
    if (isReject(grabbable)) return grabbable;
    const actorId = (action.actor as { playerId?: string }).playerId;
    if (grabbable.heldBy !== actorId) return reject("Actor does not hold entity");
    const placement = canLeaveCurrentPlacement(state, action.payload.entityId);
    if (isReject(placement)) return placement;
    const problem = transformProblem(action.payload.transform);
    if (problem !== undefined) return reject(`Invalid transform: ${problem}`);
    return context === undefined || action.actor.type !== "player"
      ? OK
      : guardResult(
          context.canDrop(state, action, action.payload.entityId),
          "Entity drop denied by can_drop guard",
        );
  },
  apply(draft, action, ctx) {
    const payload = action.payload as {
      entityId: string;
      transform: TransformComponent;
    };
    const entity = draft.entities[payload.entityId];
    const grabbable = entity?.components.grabbable as GrabbableComponent | undefined;
    if (entity === undefined || grabbable === undefined) {
      throw new Error("Validated entity disappeared");
    }
    detachExclusivePlacement(draft, payload.entityId, ctx);
    entity.components.transform = canonicalizeTransform(payload.transform);
    grabbable.heldBy = null;

    // SPEC 02.4 canonical drop precedence is intentionally fixed because
    // clients predict this action: snap -> stack -> zone recompute -> world.
    // A successful earlier resolution prevents later exclusive placement,
    // while zones remain semantic overlays on the resolved world position.
    const snapPointId = nearestSnapPoint(draft, payload.entityId);
    if (snapPointId !== undefined) {
      attachSnap(draft, snapPointId, payload.entityId, ctx);
    } else {
      resolveStackDrop(draft, payload.entityId, action.actionId, ctx);
    }
    recomputeZoneMembership(draft, [payload.entityId], ctx);
    ctx.emit("entity.dropped", {
      entityId: payload.entityId,
      transform: cloneCanonical(entity.components.transform) as unknown as JsonValue,
    });
  },
};

const entityFlip: ActionDefinition<unknown> = {
  type: "entity.flip",
  version: 1,
  sources: ["player", "script"],
  validate(state, action, context) {
    const payload = entityPayload(action);
    if (isReject(payload)) return payload;
    const flippable = requireComponent<FlippableComponent>(
      state,
      payload.entityId,
      "flippable",
    );
    if (isReject(flippable)) return flippable;
    return context === undefined || action.actor.type !== "player"
      ? OK
      : guardResult(
          context.canFlip(state, action, payload.entityId),
          "Entity flip denied by can_flip guard",
        );
  },
  apply(draft, action, ctx) {
    const { entityId } = action.payload as { entityId: string };
    const flippable = draft.entities[entityId]?.components.flippable as
      | FlippableComponent
      | undefined;
    if (flippable === undefined) throw new Error("Validated flippable disappeared");
    flippable.flipped = !flippable.flipped;
    ctx.emit("entity.flipped", { entityId, flipped: flippable.flipped });
  },
};

function transferPayload(value: unknown): ContainerTransfer | Reject {
  if (
    !isRecord(value) ||
    !onlyKeys(value, ["entity", "from", "to", "index"]) ||
    typeof value.entity !== "string" ||
    (value.from !== null && typeof value.from !== "string") ||
    (value.to !== null && typeof value.to !== "string") ||
    !Number.isSafeInteger(value.index)
  ) {
    return reject("Payload requires entity, from, to, and integer index");
  }
  return value as unknown as ContainerTransfer;
}

const containerMove: ActionDefinition<unknown> = {
  type: "container.move",
  version: 1,
  sources: ["script"],
  validate(state, action) {
    const payload = transferPayload(action.payload);
    return isReject(payload) ? payload : validateContainerTransfer(state, payload);
  },
  apply(draft, action, ctx) {
    const payload = action.payload as unknown as ContainerTransfer;
    const indices = applyContainerTransfer(draft, payload);
    ctx.emit("container.moved", {
      entity: payload.entity,
      from: payload.from,
      to: payload.to,
      index: payload.index,
      fromIndex: indices.fromIndex,
    });
    recomputeZoneMembership(draft, [payload.entity], ctx);
  },
};

function movementPayload(
  state: Readonly<CanonicalGameState>,
  action: ActionInstance<unknown>,
): { entityId: EntityId; transform: TransformComponent } | Reject {
  if (
    !isRecord(action.payload) ||
    !onlyKeys(action.payload, ["entityId", "transform"]) ||
    typeof action.payload.entityId !== "string"
  ) {
    return reject("Payload must contain entityId and transform");
  }
  const transform = requireComponent<TransformComponent>(
    state,
    action.payload.entityId,
    "transform",
  );
  if (isReject(transform)) return transform;
  const placement = canLeaveCurrentPlacement(state, action.payload.entityId);
  if (isReject(placement)) return placement;
  const problem = transformProblem(action.payload.transform);
  if (problem !== undefined) return reject(`Invalid transform: ${problem}`);
  return {
    entityId: action.payload.entityId,
    transform: action.payload.transform as unknown as TransformComponent,
  };
}

const entityMove: ActionDefinition<unknown> = {
  type: "entity.move",
  version: 1,
  sources: ["script", "system"],
  validate(state, action) {
    const payload = movementPayload(state, action);
    return isReject(payload) ? payload : OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as {
      entityId: EntityId;
      transform: TransformComponent;
    };
    detachExclusivePlacement(draft, payload.entityId, ctx);
    const entity = draft.entities[payload.entityId];
    if (entity === undefined) throw new Error("Validated entity disappeared");
    entity.components.transform = canonicalizeTransform(payload.transform);
    recomputeZoneMembership(draft, [payload.entityId], ctx);
  },
};

const entitySetLocked: ActionDefinition<unknown> = {
  type: "entity.set_locked",
  version: 1,
  sources: ["player", "script"],
  validate(state, action) {
    if (
      !isRecord(action.payload) ||
      !onlyKeys(action.payload, ["entityId", "locked"]) ||
      typeof action.payload.entityId !== "string" ||
      typeof action.payload.locked !== "boolean"
    ) {
      return reject("Payload requires only entityId and locked");
    }
    const lockable = requireComponent<LockableComponent>(
      state,
      action.payload.entityId,
      "lockable",
    );
    if (isReject(lockable)) return lockable;
    if (action.actor.type === "player" && state.settings.sandbox !== true) {
      return reject("Player locking requires sandbox permission");
    }
    return OK;
  },
  apply(draft, action) {
    const payload = action.payload as { entityId: EntityId; locked: boolean };
    const lockable = draft.entities[payload.entityId]?.components.lockable as
      | LockableComponent
      | undefined;
    if (lockable === undefined) throw new Error("Validated lockable disappeared");
    lockable.locked = payload.locked;
  },
};

const buttonPress: ActionDefinition<unknown> = {
  type: "button.press",
  version: 1,
  sources: ["player"],
  validate(state, action, context) {
    const payload = entityPayload(action);
    if (isReject(payload)) return payload;
    const button = requireComponent<ButtonComponent>(
      state,
      payload.entityId,
      "button",
    );
    if (isReject(button)) return button;
    if (!button.enabled) return reject("Button is disabled");
    return context === undefined
      ? OK
      : guardResult(
          context.canPress(state, action, payload.entityId),
          "Button press denied by can_press guard",
        );
  },
  apply(_draft, action, ctx) {
    const { entityId } = action.payload as { entityId: EntityId };
    const playerId = (action.actor as { playerId: string }).playerId;
    ctx.emit("button.pressed", { entityId, playerId });
  },
};

const textSet: ActionDefinition<unknown> = {
  type: "text.set",
  version: 1,
  sources: ["script"],
  validate(state, action) {
    if (
      !isRecord(action.payload) ||
      !onlyKeys(action.payload, ["entityId", "value"]) ||
      typeof action.payload.entityId !== "string" ||
      typeof action.payload.value !== "string"
    ) {
      return reject("Payload requires only entityId and string value");
    }
    const text = requireComponent<TextComponent>(
      state,
      action.payload.entityId,
      "text",
    );
    if (isReject(text)) return text;
    if (canonicalUtf8ByteLength(action.payload.value) > TEXT_MAX_UTF8_BYTES) {
      return reject(`Text exceeds ${TEXT_MAX_UTF8_BYTES} UTF-8 bytes`);
    }
    return OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as { entityId: EntityId; value: string };
    const text = draft.entities[payload.entityId]?.components.text as
      | TextComponent
      | undefined;
    if (text === undefined) throw new Error("Validated text disappeared");
    text.value = payload.value;
    ctx.emit("text.changed", { entityId: payload.entityId, value: payload.value });
  },
};

const snapAttach: ActionDefinition<unknown> = {
  type: "snap.attach",
  version: 1,
  sources: ["script"],
  validate(state, action) {
    if (
      !isRecord(action.payload) ||
      !onlyKeys(action.payload, ["snapPointId", "entityId"]) ||
      typeof action.payload.snapPointId !== "string" ||
      typeof action.payload.entityId !== "string"
    ) {
      return reject("Payload requires only snapPointId and entityId");
    }
    if (action.payload.snapPointId === action.payload.entityId) {
      return reject("A snap-point cannot attach itself");
    }
    const snapPoint = requireComponent<SnapPointComponent>(
      state,
      action.payload.snapPointId,
      "snap-point",
    );
    if (isReject(snapPoint)) return snapPoint;
    if (getEntity(state, action.payload.entityId) === undefined) {
      return reject(`Unknown entity: ${action.payload.entityId}`);
    }
    if (snapContaining(state, action.payload.entityId)?.id === action.payload.snapPointId) {
      return reject("Entity is already attached to snap-point");
    }
    const placement = canLeaveCurrentPlacement(state, action.payload.entityId);
    if (isReject(placement)) return placement;
    if (!snapAcceptsEntity(state, action.payload.snapPointId, action.payload.entityId)) {
      return reject("Snap-point capacity or tag compatibility rejected entity");
    }
    return OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as { snapPointId: EntityId; entityId: EntityId };
    detachExclusivePlacement(draft, payload.entityId, ctx);
    attachSnap(draft, payload.snapPointId, payload.entityId, ctx);
    recomputeZoneMembership(draft, [payload.entityId], ctx);
  },
};

function stackIdPayload(
  value: unknown,
  allowed: readonly string[],
): { stackId: StackId } | Reject {
  if (
    !isRecord(value) ||
    !onlyKeys(value, allowed) ||
    typeof value.stackId !== "string" ||
    value.stackId.length === 0
  ) {
    return reject("Payload requires a non-empty stackId");
  }
  return { stackId: value.stackId };
}

function validateStackableEntity(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
  requireWorld: boolean,
): ValidationResult {
  const stackable = requireComponent<StackableComponent>(state, entityId, "stackable");
  if (isReject(stackable)) return stackable;
  if (!stackable.enabled) return reject(`Entity ${entityId} is not stackable`);
  if (requireWorld && exclusivePlacement(state, entityId) !== undefined) {
    return reject(`Entity ${entityId} already has an exclusive placement`);
  }
  return OK;
}

const stackCreate: ActionDefinition<unknown> = {
  type: "stack.create",
  version: 1,
  sources: ["script"],
  validate(state, action) {
    if (
      !isRecord(action.payload) ||
      !onlyKeys(action.payload, ["stackId", "items"]) ||
      typeof action.payload.stackId !== "string" ||
      action.payload.stackId.length === 0 ||
      !Array.isArray(action.payload.items) ||
      action.payload.items.length < 2 ||
      action.payload.items.some((item) => typeof item !== "string")
    ) {
      return reject("Payload requires stackId and at least two entity IDs");
    }
    if (hasOwn.call(state.stacks ?? {}, action.payload.stackId)) {
      return reject(`Stack already exists: ${action.payload.stackId}`);
    }
    const items = action.payload.items as string[];
    if (new Set(items).size !== items.length) return reject("Stack items must be unique");
    for (const entityId of items) {
      const result = validateStackableEntity(state, entityId, true);
      if (isReject(result)) return result;
    }
    return OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as { stackId: StackId; items: EntityId[] };
    const stack: StackRecord = { id: payload.stackId, items: [...payload.items] };
    stacks(draft)[payload.stackId] = stack;
    ctx.emit("stack.created", { stackId: payload.stackId, items: [...stack.items] });
    recomputeZoneMembership(draft, stack.items, ctx);
  },
};

const stackAdd: ActionDefinition<unknown> = {
  type: "stack.add",
  version: 1,
  sources: ["script"],
  validate(state, action) {
    const payload = stackIdPayload(action.payload, ["stackId", "entityId"]);
    if (isReject(payload)) return payload;
    if (!isRecord(action.payload) || typeof action.payload.entityId !== "string") {
      return reject("Payload requires stackId and entityId");
    }
    if (!hasOwn.call(state.stacks ?? {}, payload.stackId)) {
      return reject(`Unknown stack: ${payload.stackId}`);
    }
    return validateStackableEntity(state, action.payload.entityId, true);
  },
  apply(draft, action, ctx) {
    const payload = action.payload as { stackId: StackId; entityId: EntityId };
    const stack = draft.stacks?.[payload.stackId];
    if (stack === undefined) throw new Error("Validated stack disappeared");
    stack.items.push(payload.entityId);
    ctx.emit("stack.changed", {
      stackId: payload.stackId,
      items: [...stack.items],
      added: payload.entityId,
    });
    recomputeZoneMembership(draft, [payload.entityId], ctx);
  },
};

const stackRemoveTop: ActionDefinition<unknown> = {
  type: "stack.remove_top",
  version: 1,
  sources: ["player", "script"],
  validate(state, action) {
    const payload = stackIdPayload(action.payload, ["stackId"]);
    if (isReject(payload)) return payload;
    const stack = state.stacks?.[payload.stackId];
    return stack === undefined || stack.items.length === 0
      ? reject(`Unknown or empty stack: ${payload.stackId}`)
      : OK;
  },
  apply(draft, action, ctx) {
    const { stackId } = action.payload as { stackId: StackId };
    const stack = draft.stacks?.[stackId];
    const entityId = stack?.items.pop();
    if (stack === undefined || entityId === undefined) {
      throw new Error("Validated stack disappeared");
    }
    if (stack.items.length === 0) {
      delete draft.stacks?.[stackId];
      ctx.emit("stack.dissolved", { stackId, items: [], removed: entityId });
    } else {
      ctx.emit("stack.changed", {
        stackId,
        items: [...stack.items],
        removed: entityId,
      });
    }
    recomputeZoneMembership(draft, [entityId], ctx);
  },
};

const stackMerge: ActionDefinition<unknown> = {
  type: "stack.merge",
  version: 1,
  sources: ["script"],
  validate(state, action) {
    if (
      !isRecord(action.payload) ||
      !onlyKeys(action.payload, ["targetStackId", "sourceStackId"]) ||
      typeof action.payload.targetStackId !== "string" ||
      typeof action.payload.sourceStackId !== "string" ||
      action.payload.targetStackId.length === 0 ||
      action.payload.sourceStackId.length === 0
    ) {
      return reject("Payload requires targetStackId and sourceStackId");
    }
    if (action.payload.targetStackId === action.payload.sourceStackId) {
      return reject("Cannot merge a stack into itself");
    }
    if (!hasOwn.call(state.stacks ?? {}, action.payload.targetStackId)) {
      return reject(`Unknown stack: ${action.payload.targetStackId}`);
    }
    if (!hasOwn.call(state.stacks ?? {}, action.payload.sourceStackId)) {
      return reject(`Unknown stack: ${action.payload.sourceStackId}`);
    }
    return OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as {
      targetStackId: StackId;
      sourceStackId: StackId;
    };
    const target = draft.stacks?.[payload.targetStackId];
    const source = draft.stacks?.[payload.sourceStackId];
    if (target === undefined || source === undefined) {
      throw new Error("Validated stack disappeared");
    }
    target.items.push(...source.items);
    const dissolvedItems = [...source.items];
    delete draft.stacks?.[payload.sourceStackId];
    ctx.emit("stack.changed", {
      stackId: payload.targetStackId,
      items: [...target.items],
      merged: payload.sourceStackId,
    });
    ctx.emit("stack.dissolved", {
      stackId: payload.sourceStackId,
      items: dissolvedItems,
      mergedInto: payload.targetStackId,
    });
  },
};

const stackDissolve: ActionDefinition<unknown> = {
  type: "stack.dissolve",
  version: 1,
  sources: ["script"],
  validate(state, action) {
    const payload = stackIdPayload(action.payload, ["stackId"]);
    if (isReject(payload)) return payload;
    return hasOwn.call(state.stacks ?? {}, payload.stackId)
      ? OK
      : reject(`Unknown stack: ${payload.stackId}`);
  },
  apply(draft, action, ctx) {
    const { stackId } = action.payload as { stackId: StackId };
    const stack = draft.stacks?.[stackId];
    if (stack === undefined) throw new Error("Validated stack disappeared");
    const items = [...stack.items];
    delete draft.stacks?.[stackId];
    ctx.emit("stack.dissolved", { stackId, items });
    recomputeZoneMembership(draft, items, ctx);
  },
};

function validateDeck(state: Readonly<CanonicalGameState>, deckId: string): ValidationResult {
  const entity = getEntity(state, deckId);
  if (entity === undefined) return reject(`Unknown entity: ${deckId}`);
  if (entity.components.deck === undefined || entity.components.container === undefined) {
    return reject(`Entity ${deckId} is not a deck`);
  }
  const deck = entity.components.deck as { enabled?: unknown };
  if (deck.enabled === false) return reject("Deck is disabled");
  return OK;
}

const deckShuffle: ActionDefinition<unknown> = {
  type: "deck.shuffle",
  version: 1,
  sources: ["player", "script"],
  validate(state, action) {
    if (
      !isRecord(action.payload) ||
      !onlyKeys(action.payload, ["deckId"]) ||
      typeof action.payload.deckId !== "string"
    ) {
      return reject("Payload must contain only deckId");
    }
    return validateDeck(state, action.payload.deckId);
  },
  apply(draft, action, ctx) {
    const { deckId } = action.payload as { deckId: string };
    const container = draft.entities[deckId]?.components.container as
      | ContainerComponent
      | undefined;
    if (container === undefined) throw new Error("Validated deck disappeared");
    container.items = ctx.rng.shuffle(container.items);
    ctx.emit("deck.shuffled", { deckId });
  },
};

interface DrawPayload {
  deckId: string;
  target: string;
  count: number;
}

function drawPayload(value: unknown): DrawPayload | Reject {
  if (
    !isRecord(value) ||
    !onlyKeys(value, ["deckId", "target", "count"]) ||
    typeof value.deckId !== "string" ||
    typeof value.target !== "string" ||
    !Number.isSafeInteger(value.count) ||
    (value.count as number) <= 0
  ) {
    return reject("Payload requires deckId, target, and a positive integer count");
  }
  return value as unknown as DrawPayload;
}

const deckDrawToContainer: ActionDefinition<unknown> = {
  type: "deck.draw_to_container",
  version: 1,
  sources: ["player", "script"],
  validate(state, action) {
    const payload = drawPayload(action.payload);
    if (isReject(payload)) return payload;
    const deckResult = validateDeck(state, payload.deckId);
    if (isReject(deckResult)) return deckResult;
    if (payload.deckId === payload.target) return reject("Deck and target must differ");
    const deck = state.entities[payload.deckId]?.components.container as
      | ContainerComponent
      | undefined;
    const target = requireComponent<ContainerComponent>(
      state,
      payload.target,
      "container",
    );
    if (isReject(target)) return target;
    if (deck === undefined || payload.count > deck.items.length) {
      return reject("Deck has insufficient cards");
    }
    if (
      target.capacity !== null &&
      target.items.length + payload.count > target.capacity
    ) {
      return reject("Target container has insufficient capacity");
    }
    return OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as DrawPayload;
    const deck = draft.entities[payload.deckId]?.components.container as
      | ContainerComponent
      | undefined;
    const target = draft.entities[payload.target]?.components.container as
      | ContainerComponent
      | undefined;
    if (deck === undefined || target === undefined) {
      throw new Error("Validated container disappeared");
    }
    const drawn: string[] = [];
    for (let index = 0; index < payload.count; index += 1) {
      const cardId = deck.items[deck.items.length - 1];
      if (cardId === undefined) throw new Error("Validated deck became insufficient");
      applyContainerTransfer(draft, {
        entity: cardId,
        from: payload.deckId,
        to: payload.target,
        index: target.items.length,
      });
      drawn.push(cardId);
    }
    ctx.emit("deck.drawn", {
      deckId: payload.deckId,
      target: payload.target,
      count: payload.count,
      items: drawn,
    });
  },
};

interface CounterPayload {
  entityId: string;
  amount: number;
}

function counterPayload(
  state: Readonly<CanonicalGameState>,
  action: ActionInstance<unknown>,
  field: "value" | "amount",
): CounterPayload | Reject {
  if (
    !isRecord(action.payload) ||
    !onlyKeys(action.payload, ["entityId", field]) ||
    typeof action.payload.entityId !== "string" ||
    typeof action.payload[field] !== "number" ||
    !Number.isFinite(action.payload[field])
  ) {
    return reject(`Payload requires entityId and finite ${field}`);
  }
  const counter = requireComponent<CounterComponent>(
    state,
    action.payload.entityId,
    "counter",
  );
  if (isReject(counter)) return counter;
  return {
    entityId: action.payload.entityId,
    amount: action.payload[field] as number,
  };
}

function clamped(counter: CounterComponent, value: number): number {
  let result = value;
  if (counter.min !== null && result < counter.min) result = counter.min;
  if (counter.max !== null && result > counter.max) result = counter.max;
  return Object.is(result, -0) ? 0 : result;
}

function applyCounter(
  draft: CanonicalGameState,
  entityId: string,
  next: (current: number) => number,
): number {
  const counter = draft.entities[entityId]?.components.counter as
    | CounterComponent
    | undefined;
  if (counter === undefined) throw new Error("Validated counter disappeared");
  counter.value = clamped(counter, next(counter.value));
  return counter.value;
}

const counterSet: ActionDefinition<unknown> = {
  type: "counter.set",
  version: 1,
  sources: ["player", "script"],
  validate(state, action) {
    const payload = counterPayload(state, action, "value");
    return isReject(payload) ? payload : OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as { entityId: string; value: number };
    const value = applyCounter(draft, payload.entityId, () => payload.value);
    ctx.emit("counter.changed", { entityId: payload.entityId, value });
  },
};

const counterAdd: ActionDefinition<unknown> = {
  type: "counter.add",
  version: 1,
  sources: ["player", "script"],
  validate(state, action) {
    const payload = counterPayload(state, action, "amount");
    if (isReject(payload)) return payload;
    const counter = state.entities[payload.entityId]?.components.counter as
      | CounterComponent
      | undefined;
    if (counter === undefined || !Number.isFinite(counter.value + payload.amount)) {
      return reject("Counter result must be finite");
    }
    return OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as { entityId: string; amount: number };
    const value = applyCounter(
      draft,
      payload.entityId,
      (current) => current + payload.amount,
    );
    ctx.emit("counter.changed", { entityId: payload.entityId, value });
  },
};

function promptCreatePayload(value: unknown):
  | Omit<PromptRecord, "status" | "response">
  | Reject {
  if (
    !isRecord(value) ||
    !onlyKeys(value, ["id", "kind", "playerId", "title", "choices", "min", "max", "step", "default"]) ||
    typeof value.id !== "string" || value.id.length === 0 ||
    !["choice", "confirm", "number"].includes(String(value.kind)) ||
    typeof value.playerId !== "string" || value.playerId.length === 0 ||
    typeof value.title !== "string"
  ) {
    return reject("Prompt requires id, kind, playerId, and title");
  }
  const kind = value.kind as PromptKind;
  if (kind === "choice") {
    if (!Array.isArray(value.choices) || value.choices.length === 0) {
      return reject("Choice prompt requires non-empty choices");
    }
    for (const choice of value.choices) canonicalStringify(choice);
    if (hasOwn.call(value, "default") && !value.choices.some(
      (choice) => canonicalStringify(choice) === canonicalStringify(value.default),
    )) return reject("Prompt default must be one of choices");
  } else if (kind === "number") {
    if (
      typeof value.min !== "number" || !Number.isFinite(value.min) ||
      typeof value.max !== "number" || !Number.isFinite(value.max) ||
      typeof value.step !== "number" || !Number.isFinite(value.step) || value.step <= 0 ||
      value.min > value.max
    ) return reject("Number prompt requires finite min, max, and positive step");
    if (hasOwn.call(value, "default")) {
      if (typeof value.default !== "number" || !validPromptNumber(value.default, value.min, value.max, value.step)) {
        return reject("Number prompt default violates its range or step");
      }
    }
  } else if (hasOwn.call(value, "default") && typeof value.default !== "boolean") {
    return reject("Confirm prompt default must be boolean");
  }
  return cloneCanonical(value) as unknown as Omit<PromptRecord, "status" | "response">;
}

function validPromptNumber(value: number, min: number, max: number, step: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max && Number.isInteger((value - min) / step);
}

const promptCreate: ActionDefinition<unknown> = {
  type: "prompt.create",
  version: 1,
  sources: ["script"],
  validate(state, action) {
    const payload = promptCreatePayload(action.payload);
    if (isReject(payload)) return payload;
    if (!hasOwn.call(state.players, payload.playerId)) return reject(`Unknown player: ${payload.playerId}`);
    return hasOwn.call(state.prompts, payload.id) ? reject(`Prompt already exists: ${payload.id}`) : OK;
  },
  apply(draft, action, ctx) {
    const payload = promptCreatePayload(action.payload);
    if (isReject(payload)) throw new Error("Validated prompt disappeared");
    const prompt = { ...payload, status: "open" as const } as PromptRecord;
    draft.prompts[prompt.id] = prompt;
    ctx.emit("prompt.created", cloneCanonical(prompt) as unknown as { [key: string]: JsonValue });
  },
};

const promptRespond: ActionDefinition<unknown> = {
  type: "prompt.respond",
  version: 1,
  sources: ["player"],
  validate(state, action) {
    if (!isRecord(action.payload) || !onlyKeys(action.payload, ["promptId", "response"]) ||
      typeof action.payload.promptId !== "string" || !hasOwn.call(action.payload, "response")) {
      return reject("Payload requires promptId and response");
    }
    const prompt = state.prompts[action.payload.promptId];
    if (prompt === undefined) return reject(`Unknown prompt: ${action.payload.promptId}`);
    if (prompt.status !== "open") return reject("Prompt is already resolved");
    if (action.actor.type !== "player" || action.actor.playerId !== prompt.playerId) {
      return reject("Only the prompted player may respond");
    }
    const response = action.payload.response;
    canonicalStringify(response);
    if (prompt.kind === "confirm" && typeof response !== "boolean") return reject("Confirm response must be boolean");
    if (prompt.kind === "choice" && !(prompt.choices ?? []).some(
      (choice) => canonicalStringify(choice) === canonicalStringify(response),
    )) return reject("Response must be one of the prompt choices");
    if (prompt.kind === "number" && (
      typeof response !== "number" || prompt.min === undefined || prompt.max === undefined ||
      prompt.step === undefined || !validPromptNumber(response, prompt.min, prompt.max, prompt.step)
    )) return reject("Number response violates the prompt range or step");
    return OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as { promptId: string; response: JsonValue };
    const prompt = draft.prompts[payload.promptId];
    if (prompt === undefined) throw new Error("Validated prompt disappeared");
    prompt.status = "resolved";
    prompt.response = cloneCanonical(payload.response);
    ctx.emit("prompt.responded", {
      promptId: prompt.id,
      playerId: prompt.playerId,
      response: cloneCanonical(payload.response),
    });
  },
};

const promptCancel: ActionDefinition<unknown> = {
  type: "prompt.cancel",
  version: 1,
  sources: ["script", "system"],
  validate(state, action) {
    if (!isRecord(action.payload) || !onlyKeys(action.payload, ["promptId"]) || typeof action.payload.promptId !== "string") {
      return reject("Payload requires only promptId");
    }
    const prompt = state.prompts[action.payload.promptId];
    if (prompt === undefined) return reject(`Unknown prompt: ${action.payload.promptId}`);
    return prompt.status === "open" ? OK : reject("Prompt is already resolved");
  },
  apply(draft, action, ctx) {
    const { promptId } = action.payload as { promptId: string };
    const prompt = draft.prompts[promptId];
    if (prompt === undefined) throw new Error("Validated prompt disappeared");
    prompt.status = "canceled";
    ctx.emit("prompt.canceled", { promptId, playerId: prompt.playerId });
  },
};

type TimerRegistration = Omit<TimerRecord, "id" | "status"> & { timerId: string };

function timerPayload(value: unknown): TimerRegistration | Reject {
  if (!isRecord(value) || !onlyKeys(value, ["timerId", "delay", "callback", "scriptId", "bindingId", "entityId"]) ||
    typeof value.timerId !== "string" || value.timerId.length === 0 ||
    typeof value.delay !== "number" || !Number.isFinite(value.delay) || value.delay <= 0 ||
    typeof value.callback !== "string" || value.callback.length === 0 ||
    typeof value.scriptId !== "string" || value.scriptId.length === 0 ||
    typeof value.bindingId !== "string" || value.bindingId.length === 0 ||
    (value.entityId !== undefined && typeof value.entityId !== "string")) {
    return reject("Timer requires timerId, positive delay, callback, scriptId, and bindingId");
  }
  return cloneCanonical(value) as unknown as TimerRegistration;
}

const timerRegister: ActionDefinition<unknown> = {
  type: "timer.register",
  version: 1,
  sources: ["script"],
  validate(state, action) {
    const payload = timerPayload(action.payload);
    if (isReject(payload)) return payload;
    return state.timers?.[payload.timerId] === undefined
      ? OK : reject(`Timer already exists: ${payload.timerId}`);
  },
  apply(draft, action, ctx) {
    const payload = timerPayload(action.payload);
    if (isReject(payload)) throw new Error("Validated timer disappeared");
    const { timerId, ...registration } = payload;
    const timer: TimerRecord = { ...registration, id: timerId, status: "scheduled" };
    if (draft.timers === undefined) draft.timers = {};
    draft.timers[timerId] = timer;
    ctx.emit("timer.registered", { timerId, delay: timer.delay });
  },
};

const timerCancel: ActionDefinition<unknown> = {
  type: "timer.cancel",
  version: 1,
  sources: ["script"],
  validate(state, action) {
    if (!isRecord(action.payload) || !onlyKeys(action.payload, ["timerId"]) || typeof action.payload.timerId !== "string") {
      return reject("Payload requires only timerId");
    }
    const timer = state.timers?.[action.payload.timerId];
    if (timer === undefined) return reject(`Unknown timer: ${action.payload.timerId}`);
    return timer.status === "scheduled" ? OK : reject("Timer is not scheduled");
  },
  apply(draft, action, ctx) {
    const { timerId } = action.payload as { timerId: string };
    const timer = draft.timers?.[timerId];
    if (timer === undefined) throw new Error("Validated timer disappeared");
    timer.status = "canceled";
    ctx.emit("timer.canceled", { timerId });
  },
};

const timerFire: ActionDefinition<unknown> = {
  type: "system.timer_fire",
  version: 1,
  sources: ["system"],
  validate(state, action) {
    if (!isRecord(action.payload) || !onlyKeys(action.payload, ["timerId"]) || typeof action.payload.timerId !== "string") {
      return reject("Payload requires only timerId");
    }
    const timer = state.timers?.[action.payload.timerId];
    if (timer === undefined) return reject(`Unknown timer: ${action.payload.timerId}`);
    return timer.status === "scheduled" ? OK : reject("Timer has already fired or was canceled");
  },
  apply(draft, action, ctx) {
    const { timerId } = action.payload as { timerId: string };
    const timer = draft.timers?.[timerId];
    if (timer === undefined) throw new Error("Validated timer disappeared");
    timer.status = "fired";
    ctx.emit("timer.fired", {
      timerId,
      callback: timer.callback,
      scriptId: timer.scriptId,
      bindingId: timer.bindingId,
      ...(timer.entityId === undefined ? {} : { entityId: timer.entityId }),
    });
  },
};

export const builtInActions: ReadonlyArray<ActionDefinition<unknown>> = [
  gameStart,
  playerJoined,
  playerLeft,
  seatAssign,
  entityGrab,
  entityDrop,
  entityMove,
  entityFlip,
  entitySetLocked,
  containerMove,
  deckShuffle,
  deckDrawToContainer,
  stackCreate,
  stackAdd,
  stackRemoveTop,
  stackMerge,
  stackDissolve,
  dieRoll,
  counterSet,
  counterAdd,
  buttonPress,
  textSet,
  snapAttach,
  promptCreate,
  promptRespond,
  promptCancel,
  timerRegister,
  timerCancel,
  timerFire,
];

/** Add a new entity using the current action's deterministic allocation stream. */
export function spawnEntity(
  draft: CanonicalGameState,
  components: EntityRecord["components"],
  allocateEntityId: () => EntityId,
): EntityRecord {
  canonicalStringify(components);
  const id = allocateEntityId();
  const entity: EntityRecord = { id, components: cloneCanonical(components) };
  draft.entities[id] = entity;
  return entity;
}

/** Permanently remove an entity and every canonical placement membership. */
export function destroyEntity(
  draft: CanonicalGameState,
  entityId: EntityId,
  ctx?: Pick<ApplyContext, "emit">,
): void {
  if (!hasOwn.call(draft.entities, entityId)) throw new Error(`Unknown entity: ${entityId}`);
  const events = ctx ?? { emit: () => {} };
  const entity = draft.entities[entityId];
  const affected = [entityId];

  const ownedContainer = entity?.components.container as ContainerComponent | undefined;
  if (ownedContainer !== undefined) affected.push(...ownedContainer.items);
  const ownedSnap = entity?.components["snap-point"] as SnapPointComponent | undefined;
  if (ownedSnap?.attached !== undefined) {
    for (const attachedId of [...ownedSnap.attached].sort(compareIds)) {
      affected.push(attachedId);
      events.emit("snap.detached", { snapPointId: entityId, entityId: attachedId });
    }
  }

  const ownedZone = entity?.components.zone as ZoneComponent | undefined;
  if (ownedZone?.members !== undefined) {
    for (const memberId of [...ownedZone.members].sort(compareIds)) {
      events.emit("zone.left", { zoneId: entityId, entityId: memberId });
    }
  }

  detachExclusivePlacement(draft, entityId, events);
  delete draft.entities[entityId];
  recomputeZoneMembership(draft, affected, events);
}
