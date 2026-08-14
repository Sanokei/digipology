import { canonicalStringify } from "digipology-canonical-json";
import { fromState } from "digipology-prng";
import type {
  CanonicalGameState,
  ContainerComponent,
  CounterComponent,
  EntityRecord,
  HandComponent,
  JsonValue,
  Quaternion,
  SnapPointComponent,
  StackRecord,
  TagsComponent,
  TextComponent,
  TransformComponent,
  Vector3,
  ZoneComponent,
} from "./types";

export const TRANSFORM_QUANTIZATION_GRID = 0.0001;
export const TRANSFORM_MAX_ABS_COORDINATE = 1_000_000;
export const QUATERNION_UNIT_TOLERANCE = 0.001;
/** Canonical text values use a 4 KiB UTF-8 budget in kernel v1. */
export const TEXT_MAX_UTF8_BYTES = 4096;

const hasOwn = Object.prototype.hasOwnProperty;

export class InvalidGameStateError extends Error {
  constructor(message: string) {
    super(`Invalid canonical game state: ${message}`);
    this.name = "InvalidGameStateError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

/** Clone canonical JSON-like data without invoking platform serialization. */
export function cloneCanonical<T>(value: T): T {
  canonicalStringify(value);
  return cloneKnownCanonical(value) as T;
}

function cloneKnownCanonical(value: unknown): JsonValue {
  if (value === null || typeof value !== "object") {
    return value as JsonValue;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneKnownCanonical(item));
  }
  const result: Record<string, JsonValue> = {};
  for (const key of sortedKeys(value)) {
    result[key] = cloneKnownCanonical((value as Record<string, unknown>)[key]);
  }
  return result;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function canonicalUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
      bytes += next >= 0xdc00 && next <= 0xdfff ? 4 : 3;
    } else bytes += 3;
  }
  return bytes;
}

function vectorProblem(value: unknown, scale: boolean): string | undefined {
  if (!isRecord(value)) return "must be an object";
  for (const axis of ["x", "y", "z"] as const) {
    const coordinate = value[axis];
    if (!finiteNumber(coordinate)) return `${axis} must be finite`;
    if (Math.abs(coordinate) > TRANSFORM_MAX_ABS_COORDINATE) {
      return `${axis} is outside canonical bounds`;
    }
    if (scale && coordinate <= 0) return `${axis} scale must be positive`;
  }
  return undefined;
}

function quaternionProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return "must be an object";
  for (const axis of ["x", "y", "z", "w"] as const) {
    if (!finiteNumber(value[axis])) return `${axis} must be finite`;
  }
  const x = value.x as number;
  const y = value.y as number;
  const z = value.z as number;
  const w = value.w as number;
  const magnitude = Math.sqrt(x * x + y * y + z * z + w * w);
  if (magnitude === 0) return "must not be zero";
  if (Math.abs(magnitude - 1) > QUATERNION_UNIT_TOLERANCE) {
    return "must be normalized";
  }
  return undefined;
}

export function transformProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return "transform must be an object";
  const position = vectorProblem(value.position, false);
  if (position !== undefined) return `position.${position}`;
  const rotation = quaternionProblem(value.rotation);
  if (rotation !== undefined) return `rotation.${rotation}`;
  const scale = vectorProblem(value.scale, true);
  if (scale !== undefined) return `scale.${scale}`;
  return undefined;
}

function quantize(value: number): number {
  const result = Math.round(value / TRANSFORM_QUANTIZATION_GRID) *
    TRANSFORM_QUANTIZATION_GRID;
  return Object.is(result, -0) ? 0 : result;
}

function quantizeVector(value: Vector3): Vector3 {
  return { x: quantize(value.x), y: quantize(value.y), z: quantize(value.z) };
}

/** Validate, normalize, and quantize a transform for canonical commit. */
export function canonicalizeTransform(value: unknown): TransformComponent {
  const problem = transformProblem(value);
  if (problem !== undefined) throw new TypeError(`Invalid transform: ${problem}`);
  const transform = value as TransformComponent;
  const rotation = transform.rotation;
  const magnitude = Math.sqrt(
    rotation.x * rotation.x +
      rotation.y * rotation.y +
      rotation.z * rotation.z +
      rotation.w * rotation.w,
  );
  const normalized: Quaternion = {
    x: rotation.x / magnitude,
    y: rotation.y / magnitude,
    z: rotation.z / magnitude,
    w: rotation.w / magnitude,
  };
  return {
    position: quantizeVector(transform.position),
    rotation: {
      x: quantize(normalized.x),
      y: quantize(normalized.y),
      z: quantize(normalized.z),
      w: quantize(normalized.w),
    },
    scale: quantizeVector(transform.scale),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new InvalidGameStateError(`${label} must be an object`);
  return value;
}

function validateIdentityRecords(
  value: unknown,
  label: string,
): Record<string, unknown> {
  const records = requireRecord(value, label);
  for (const id of sortedKeys(records)) {
    const record = requireRecord(records[id], `${label}.${id}`);
    if (record.id !== id) {
      throw new InvalidGameStateError(`${label}.${id}.id must equal its record key`);
    }
  }
  return records;
}

function validateContainer(
  component: unknown,
  entityId: string,
  entities: Record<string, unknown>,
  memberships: Record<string, string>,
): void {
  const container = requireRecord(
    component,
    `entities.${entityId}.components.container`,
  ) as unknown as ContainerComponent;
  if (!Array.isArray(container.items)) {
    throw new InvalidGameStateError(`container ${entityId} items must be an array`);
  }
  if (
    container.capacity !== null &&
    (!Number.isSafeInteger(container.capacity) || container.capacity < 0)
  ) {
    throw new InvalidGameStateError(`container ${entityId} has invalid capacity`);
  }
  if (container.capacity !== null && container.items.length > container.capacity) {
    throw new InvalidGameStateError(`container ${entityId} exceeds capacity`);
  }
  if (typeof container.ordering !== "string" || typeof container.visibility !== "string") {
    throw new InvalidGameStateError(`container ${entityId} metadata must be strings`);
  }
  for (const itemId of container.items) {
    if (typeof itemId !== "string" || !hasOwn.call(entities, itemId)) {
      throw new InvalidGameStateError(`container ${entityId} references an unknown item`);
    }
    if (hasOwn.call(memberships, itemId)) {
      throw new InvalidGameStateError(
        `entity ${itemId} belongs to more than one container`,
      );
    }
    memberships[itemId] = entityId;
  }
}

function validateCounter(component: unknown, entityId: string): void {
  const counter = requireRecord(
    component,
    `entities.${entityId}.components.counter`,
  ) as unknown as CounterComponent;
  for (const field of ["value", "default"] as const) {
    if (!finiteNumber(counter[field])) {
      throw new InvalidGameStateError(`counter ${entityId}.${field} must be finite`);
    }
  }
  for (const field of ["min", "max"] as const) {
    if (counter[field] !== null && !finiteNumber(counter[field])) {
      throw new InvalidGameStateError(`counter ${entityId}.${field} must be finite or null`);
    }
  }
  if (counter.min !== null && counter.max !== null && counter.min > counter.max) {
    throw new InvalidGameStateError(`counter ${entityId} has inverted bounds`);
  }
  if (
    (counter.min !== null && counter.value < counter.min) ||
    (counter.max !== null && counter.value > counter.max)
  ) {
    throw new InvalidGameStateError(`counter ${entityId} value is outside its bounds`);
  }
}

function validateStringArray(
  value: unknown,
  label: string,
  allowEmptyStrings = false,
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        typeof item !== "string" || (!allowEmptyStrings && item.length === 0),
    )
  ) {
    throw new InvalidGameStateError(`${label} must be an array of strings`);
  }
}

function validateReferencedIds(
  value: unknown,
  label: string,
  entities: Record<string, unknown>,
  ownerId: string | undefined,
  requireSorted: boolean,
): string[] {
  validateStringArray(value, label);
  const seen = new Set<string>();
  for (const entityId of value) {
    if (!hasOwn.call(entities, entityId)) {
      throw new InvalidGameStateError(`${label} references unknown entity ${entityId}`);
    }
    if (ownerId !== undefined && entityId === ownerId) {
      throw new InvalidGameStateError(`${label} cannot reference itself`);
    }
    if (seen.has(entityId)) {
      throw new InvalidGameStateError(`${label} contains duplicate entity ${entityId}`);
    }
    seen.add(entityId);
  }
  if (requireSorted) {
    const sorted = [...value].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] !== sorted[index]) {
        throw new InvalidGameStateError(`${label} must use ascending entity order`);
      }
    }
  }
  return value;
}

function validateHand(component: unknown, entityId: string): void {
  const hand = requireRecord(
    component,
    `entities.${entityId}.components.hand`,
  ) as unknown as HandComponent;
  if (
    typeof hand.owner !== "string" ||
    hand.owner.length === 0 ||
    typeof hand.canonicalOrder !== "boolean"
  ) {
    throw new InvalidGameStateError(`entity ${entityId} has invalid hand`);
  }
}

function validateTags(component: unknown, entityId: string): void {
  const tags = requireRecord(
    component,
    `entities.${entityId}.components.tags`,
  ) as unknown as TagsComponent;
  validateStringArray(tags.values, `entity ${entityId} tags`);
}

function validateZone(
  component: unknown,
  entityId: string,
  entities: Record<string, unknown>,
): void {
  const zone = requireRecord(
    component,
    `entities.${entityId}.components.zone`,
  ) as unknown as ZoneComponent;
  if (
    (zone.shape !== "box" && zone.shape !== "sphere") ||
    typeof zone.visibleInPlay !== "boolean"
  ) {
    throw new InvalidGameStateError(`entity ${entityId} has invalid zone`);
  }
  validateStringArray(zone.acceptedTags, `zone ${entityId} acceptedTags`);
  if (zone.members !== undefined) {
    validateReferencedIds(
      zone.members,
      `zone ${entityId} members`,
      entities,
      entityId,
      true,
    );
  }
}

function validateSnapPoint(
  component: unknown,
  entityId: string,
  entities: Record<string, unknown>,
  placements: Record<string, string>,
): void {
  const snapPoint = requireRecord(
    component,
    `entities.${entityId}.components.snap-point`,
  ) as unknown as SnapPointComponent;
  if (
    !finiteNumber(snapPoint.radius) ||
    snapPoint.radius < 0 ||
    !Number.isSafeInteger(snapPoint.capacity) ||
    snapPoint.capacity < 0
  ) {
    throw new InvalidGameStateError(`entity ${entityId} has invalid snap-point limits`);
  }
  validateStringArray(snapPoint.tags, `snap-point ${entityId} tags`);
  if (!hasOwn.call(snapPoint as unknown as object, "alignment")) {
    throw new InvalidGameStateError(`snap-point ${entityId} requires alignment`);
  }
  if (snapPoint.attached === undefined) return;
  const attached = validateReferencedIds(
    snapPoint.attached,
    `snap-point ${entityId} attached`,
    entities,
    entityId,
    true,
  );
  if (attached.length > snapPoint.capacity) {
    throw new InvalidGameStateError(`snap-point ${entityId} exceeds capacity`);
  }
  for (const attachedId of attached) {
    const tags = ((entities[attachedId] as EntityRecord).components.tags as
      | TagsComponent
      | undefined)?.values ?? [];
    if (
      snapPoint.tags.length > 0 &&
      !snapPoint.tags.some((tag) => tags.includes(tag))
    ) {
      throw new InvalidGameStateError(
        `snap-point ${entityId} has incompatible attachment ${attachedId}`,
      );
    }
    if (hasOwn.call(placements, attachedId)) {
      throw new InvalidGameStateError(
        `entity ${attachedId} has more than one exclusive placement`,
      );
    }
    placements[attachedId] = `snap:${entityId}`;
  }
}

function validateStacks(
  value: unknown,
  entities: Record<string, unknown>,
  placements: Record<string, string>,
): void {
  const stacks = validateIdentityRecords(value, "stacks");
  for (const stackId of sortedKeys(stacks)) {
    const stack = stacks[stackId] as unknown as StackRecord;
    const items = validateReferencedIds(
      stack.items,
      `stack ${stackId} items`,
      entities,
      undefined,
      false,
    );
    if (items.length === 0) {
      throw new InvalidGameStateError(`stack ${stackId} must not be empty`);
    }
    for (const itemId of items) {
      const stackable = (entities[itemId] as EntityRecord).components.stackable as
        | { enabled?: unknown }
        | undefined;
      if (stackable?.enabled !== true) {
        throw new InvalidGameStateError(`stack ${stackId} item ${itemId} is not stackable`);
      }
      if (hasOwn.call(placements, itemId)) {
        throw new InvalidGameStateError(
          `entity ${itemId} has more than one exclusive placement`,
        );
      }
      placements[itemId] = `stack:${stackId}`;
    }
  }
}

function validateEntity(
  entity: unknown,
  entityId: string,
  entities: Record<string, unknown>,
  memberships: Record<string, string>,
): void {
  const record = entity as EntityRecord;
  const components = requireRecord(record.components, `entities.${entityId}.components`);
  if (hasOwn.call(components, "transform")) {
    const problem = transformProblem(components.transform);
    if (problem !== undefined) {
      throw new InvalidGameStateError(`entity ${entityId} has invalid ${problem}`);
    }
    const canonical = canonicalizeTransform(components.transform);
    if (canonicalStringify(canonical) !== canonicalStringify(components.transform)) {
      throw new InvalidGameStateError(`entity ${entityId} transform is not canonicalized`);
    }
  }
  if (hasOwn.call(components, "grabbable")) {
    const grabbable = requireRecord(
      components.grabbable,
      `entities.${entityId}.components.grabbable`,
    );
    if (
      typeof grabbable.enabled !== "boolean" ||
      (grabbable.heldBy !== null && typeof grabbable.heldBy !== "string")
    ) {
      throw new InvalidGameStateError(`entity ${entityId} has invalid grabbable`);
    }
  }
  if (hasOwn.call(components, "lockable")) {
    const lockable = requireRecord(
      components.lockable,
      `entities.${entityId}.components.lockable`,
    );
    if (typeof lockable.locked !== "boolean") {
      throw new InvalidGameStateError(`entity ${entityId} has invalid lockable`);
    }
  }
  if (hasOwn.call(components, "stackable")) {
    const stackable = requireRecord(
      components.stackable,
      `entities.${entityId}.components.stackable`,
    );
    if (typeof stackable.enabled !== "boolean") {
      throw new InvalidGameStateError(`entity ${entityId} has invalid stackable`);
    }
  }
  if (hasOwn.call(components, "tags")) validateTags(components.tags, entityId);
  if (hasOwn.call(components, "flippable")) {
    const flippable = requireRecord(
      components.flippable,
      `entities.${entityId}.components.flippable`,
    );
    if (typeof flippable.flipped !== "boolean") {
      throw new InvalidGameStateError(`entity ${entityId} has invalid flippable`);
    }
  }
  if (hasOwn.call(components, "card")) {
    const card = requireRecord(components.card, `entities.${entityId}.components.card`);
    if (typeof card.definitionId !== "string" || typeof card.faceUp !== "boolean") {
      throw new InvalidGameStateError(`entity ${entityId} has invalid card`);
    }
  }
  if (hasOwn.call(components, "container")) {
    validateContainer(components.container, entityId, entities, memberships);
  }
  if (hasOwn.call(components, "deck") && !hasOwn.call(components, "container")) {
    throw new InvalidGameStateError(`deck ${entityId} requires a container`);
  }
  if (hasOwn.call(components, "deck")) {
    const deck = requireRecord(components.deck, `entities.${entityId}.components.deck`);
    if (typeof deck.enabled !== "boolean") {
      throw new InvalidGameStateError(`deck ${entityId} has invalid deck capability`);
    }
  }
  for (const componentType of ["grabbable", "card", "die", "zone", "snap-point"] as const) {
    if (hasOwn.call(components, componentType) && !hasOwn.call(components, "transform")) {
      throw new InvalidGameStateError(`${componentType} ${entityId} requires transform`);
    }
  }
  if (hasOwn.call(components, "hand") && !hasOwn.call(components, "container")) {
    throw new InvalidGameStateError(`hand ${entityId} requires a container`);
  }
  if (hasOwn.call(components, "hand")) validateHand(components.hand, entityId);
  if (hasOwn.call(components, "zone")) {
    validateZone(components.zone, entityId, entities);
  }
  if (hasOwn.call(components, "snap-point")) {
    validateSnapPoint(components["snap-point"], entityId, entities, memberships);
  }
  if (hasOwn.call(components, "text")) {
    const text = requireRecord(
      components.text,
      `entities.${entityId}.components.text`,
    ) as unknown as TextComponent;
    if (typeof text.value !== "string") {
      throw new InvalidGameStateError(`entity ${entityId} has invalid text`);
    }
    if (canonicalUtf8ByteLength(text.value) > TEXT_MAX_UTF8_BYTES) {
      throw new InvalidGameStateError(
        `entity ${entityId} text exceeds ${TEXT_MAX_UTF8_BYTES} UTF-8 bytes`,
      );
    }
  }
  if (hasOwn.call(components, "button")) {
    const button = requireRecord(
      components.button,
      `entities.${entityId}.components.button`,
    );
    if (typeof button.enabled !== "boolean" || typeof button.label !== "string") {
      throw new InvalidGameStateError(`entity ${entityId} has invalid button`);
    }
  }
  if (hasOwn.call(components, "counter")) {
    validateCounter(components.counter, entityId);
  }
}

/** Throw unless the complete state satisfies the v1 canonical schema/invariants. */
export function validateCanonicalGameState(state: unknown): asserts state is CanonicalGameState {
  canonicalStringify(state);
  const candidate = requireRecord(state, "state");
  if (candidate.schemaVersion !== 1 || candidate.kernelVersion !== 1) {
    throw new InvalidGameStateError("schemaVersion and kernelVersion must equal 1");
  }
  if (
    !Number.isSafeInteger(candidate.sequence) ||
    (candidate.sequence as number) < 0
  ) {
    throw new InvalidGameStateError("sequence must be a non-negative safe integer");
  }
  if (typeof candidate.releaseId !== "string") {
    throw new InvalidGameStateError("releaseId must be a string");
  }
  const settings = requireRecord(candidate.settings, "settings");
  for (const key of sortedKeys(settings)) {
    const value = settings[key];
    if (
      typeof value !== "boolean" &&
      typeof value !== "number" &&
      typeof value !== "string"
    ) {
      throw new InvalidGameStateError(`setting ${key} must be primitive`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new InvalidGameStateError(`setting ${key} must be finite`);
    }
  }
  fromState(candidate.rng as CanonicalGameState["rng"]);
  validateIdentityRecords(candidate.players, "players");
  validateIdentityRecords(candidate.seats, "seats");
  validateIdentityRecords(candidate.prompts, "prompts");
  const entities = validateIdentityRecords(candidate.entities, "entities");
  const memberships: Record<string, string> = {};
  if (hasOwn.call(candidate, "stacks")) {
    validateStacks(candidate.stacks, entities, memberships);
  }
  for (const entityId of sortedKeys(entities)) {
    validateEntity(entities[entityId], entityId, entities, memberships);
  }
  canonicalStringify(candidate.scriptState);
}
