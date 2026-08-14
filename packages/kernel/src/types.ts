import type { Rng, RngState } from "digipology-prng";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PlayerId = string;
export type SeatId = string;
export type EntityId = string;
export type PromptId = string;

export type Settings = Record<string, boolean | number | string>;

export interface PlayerRecord {
  id: PlayerId;
  [key: string]: JsonValue;
}

export interface SeatRecord {
  id: SeatId;
  [key: string]: JsonValue;
}

export interface PromptRecord {
  id: PromptId;
  [key: string]: JsonValue;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface TransformComponent {
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
}

export interface GrabbableComponent {
  enabled: boolean;
  heldBy: PlayerId | null;
}

export interface FlippableComponent {
  flipped: boolean;
}

export interface CardComponent {
  definitionId: string;
  faceUp: boolean;
}

export interface ContainerComponent {
  items: EntityId[];
  capacity: number | null;
  ordering: string;
  visibility: string;
}

export interface DeckComponent {
  enabled: boolean;
}

export interface CounterComponent {
  value: number;
  default: number;
  min: number | null;
  max: number | null;
}

export interface HandComponent {
  owner: string;
  canonicalOrder: boolean;
}

export interface DieComponent {
  definitionId: string;
  value: number | string;
  /** Optional canonical face list. Legacy standard_d6 instances fall back to 1..6. */
  faces?: Array<number | string>;
}

export interface ZoneComponent {
  shape: "box" | "sphere";
  acceptedTags: string[];
  visibleInPlay: boolean;
}

export interface SnapPointComponent {
  radius: number;
  capacity: number;
  tags: string[];
  alignment: JsonValue;
}

export interface TextComponent {
  value: string;
}

export interface ButtonComponent {
  enabled: boolean;
  label: string;
}

export interface EntityComponents {
  transform?: TransformComponent;
  grabbable?: GrabbableComponent;
  flippable?: FlippableComponent;
  card?: CardComponent;
  container?: ContainerComponent;
  deck?: DeckComponent;
  counter?: CounterComponent;
  hand?: HandComponent;
  die?: DieComponent;
  zone?: ZoneComponent;
  "snap-point"?: SnapPointComponent;
  text?: TextComponent;
  button?: ButtonComponent;
  [componentType: string]: unknown;
}

export interface EntityRecord {
  id: EntityId;
  components: EntityComponents;
}

export interface CanonicalGameState {
  schemaVersion: 1;
  sequence: number;
  releaseId: string;
  kernelVersion: 1;
  settings: Settings;
  rng: RngState;
  players: Record<PlayerId, PlayerRecord>;
  seats: Record<SeatId, SeatRecord>;
  entities: Record<EntityId, EntityRecord>;
  scriptState: JsonValue;
  prompts: Record<PromptId, PromptRecord>;
}

export type ActionSource = "player" | "script" | "system";

export interface PlayerActor {
  type: "player";
  playerId: PlayerId;
}

export interface ScriptActor {
  type: "script";
  scriptId?: string;
}

export interface SystemActor {
  type: "system";
}

export type ActionActor = PlayerActor | ScriptActor | SystemActor;

export interface ActionInput<P = JsonValue> {
  type: string;
  payload: P;
}

export interface OrderedActionInput<P = JsonValue> {
  sequence: number;
  actionId: string;
  actor: ActionActor;
  action: ActionInput<P>;
}

export interface ActionInstance<P = unknown> extends ActionInput<P> {
  sequence: number;
  actionId: string;
  actor: ActionActor;
}

export interface Ok {
  ok: true;
}

export interface Reject {
  ok?: false;
  reason: string;
}

export type ValidationResult = Ok | Reject;

export interface KernelEvent {
  type: string;
  sequence: number;
  actionId: string;
  data: { [key: string]: JsonValue };
}

export interface ApplyContext {
  readonly rng: Rng;
  allocateEntityId(): EntityId;
  emit(type: string, data?: { [key: string]: JsonValue }): void;
}

export interface ActionDefinition<P = unknown> {
  type: string;
  version: 1;
  sources: ReadonlyArray<ActionSource>;
  validate(
    state: Readonly<CanonicalGameState>,
    action: ActionInstance<P>,
  ): ValidationResult;
  apply(
    draft: CanonicalGameState,
    action: ActionInstance<P>,
    ctx: ApplyContext,
  ): void;
}

export interface ApplyOrderedResult {
  state: CanonicalGameState;
  events: KernelEvent[];
  rejection?: { reason: string };
}

export interface GameSnapshot {
  formatVersion: 1;
  kernelVersion: 1;
  releaseId: string;
  sequence: number;
  state: CanonicalGameState;
  stateHash: string;
}

export interface ComponentDefinition {
  type: string;
  behavior: "implemented" | "stub";
  requires: readonly string[];
}
