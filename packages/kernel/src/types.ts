import type { Rng, RngState } from "digipology-prng";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PlayerId = string;
export type SeatId = string;
export type EntityId = string;
export type StackId = string;
export type PromptId = string;
export type TimerId = string;

export type Settings = Record<string, boolean | number | string>;

export interface PlayerRecord {
  id: PlayerId;
  [key: string]: JsonValue;
}

export interface SeatRecord {
  id: SeatId;
  [key: string]: JsonValue;
}

export type PromptKind = "choice" | "confirm" | "number";
export type PromptStatus = "open" | "resolved" | "canceled";

export interface PromptRecord {
  id: PromptId;
  kind: PromptKind;
  playerId: PlayerId;
  title: string;
  status: PromptStatus;
  choices?: JsonValue[];
  min?: number;
  max?: number;
  step?: number;
  default?: JsonValue;
  response?: JsonValue;
}

export interface TimerRecord {
  id: TimerId;
  delay: number;
  callback: string;
  scriptId: string;
  bindingId: string;
  entityId?: EntityId;
  status: "scheduled" | "fired" | "canceled";
}

export interface ScriptBindingComponent {
  scriptId: string;
  bindingId: string;
  props: { [key: string]: JsonValue };
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

export interface LockableComponent {
  locked: boolean;
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

export interface StackableComponent {
  enabled: boolean;
}

/** Canonical gameplay tags used by zones and snap points. */
export interface TagsComponent {
  values: string[];
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
  /** Present once canonical zone membership has been authored or computed. */
  members?: EntityId[];
}

export interface SnapPointComponent {
  radius: number;
  capacity: number;
  tags: string[];
  alignment: JsonValue;
  /** Present once canonical attachment state has been authored or computed. */
  attached?: EntityId[];
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
  lockable?: LockableComponent;
  flippable?: FlippableComponent;
  stackable?: StackableComponent;
  tags?: TagsComponent;
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
  script?: ScriptBindingComponent;
  [componentType: string]: unknown;
}

export interface EntityRecord {
  id: EntityId;
  components: EntityComponents;
}

export interface StackRecord {
  id: StackId;
  /** Last item is the canonical top, matching v1 Container/Deck ordering. */
  items: EntityId[];
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
  /** Optional for schema-v1 compatibility; created lazily by stack actions. */
  stacks?: Record<StackId, StackRecord>;
  scriptState: JsonValue;
  prompts: Record<PromptId, PromptRecord>;
  /** Optional for schema-v1 compatibility; created lazily by timer actions. */
  timers?: Record<TimerId, TimerRecord>;
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

export type DeepReadonly<T> = T extends JsonPrimitive
  ? T
  : T extends ReadonlyArray<infer Item>
    ? ReadonlyArray<DeepReadonly<Item>>
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export interface GuardDecision {
  allowed: boolean;
  reason?: string;
}

export type ActionGuard = (
  state: DeepReadonly<CanonicalGameState>,
  action: DeepReadonly<ActionInstance<unknown>>,
  entityId: EntityId,
) => boolean | GuardDecision;

export type CanPressGuard = ActionGuard;

export interface ActionValidationContext {
  readonly canGrab: ActionGuard;
  readonly canDrop: ActionGuard;
  readonly canFlip: ActionGuard;
  readonly canPress: CanPressGuard;
}

export interface ScriptBinding {
  readonly scriptId: string;
  readonly bindingId: string;
  readonly props: { readonly [key: string]: JsonValue };
  readonly entityId?: EntityId;
}

export interface ScriptDiagnostic {
  readonly kind: string;
  readonly message: string;
  readonly line?: number;
}

export interface ScriptInvocationResult {
  readonly ok: boolean;
  readonly handled?: boolean;
  readonly scriptState?: JsonValue;
  readonly allowed?: boolean;
  readonly reason?: string;
  readonly error?: ScriptDiagnostic;
}

export interface ScriptRuntimeBridge {
  queue(action: ActionInput<JsonValue>): void;
  randomInt(min: number, max: number): number;
  randomFloat(): number;
  allocateTimerId(): TimerId;
}

export interface ScriptInvocation {
  readonly state: DeepReadonly<CanonicalGameState>;
  readonly scriptState: JsonValue;
  readonly binding: ScriptBinding;
  readonly functionName: string;
  readonly context: { readonly [key: string]: JsonValue };
  readonly readOnly: boolean;
  readonly bridge: ScriptRuntimeBridge;
}

/** Host-injected Lua implementation. The kernel never imports a Lua engine. */
export interface ScriptRuntime {
  bindings(state: DeepReadonly<CanonicalGameState>): readonly ScriptBinding[];
  invoke(request: ScriptInvocation): Promise<ScriptInvocationResult>;
}

export interface ScriptTransactionOptions {
  readonly runtime: ScriptRuntime;
  readonly maxCommands?: number;
}

export interface ActionDefinition<P = unknown> {
  type: string;
  version: 1;
  sources: ReadonlyArray<ActionSource>;
  validate(
    state: Readonly<CanonicalGameState>,
    action: ActionInstance<P>,
    context?: ActionValidationContext,
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

export interface ActionRegistryOptions {
  canGrab?: ActionGuard;
  canDrop?: ActionGuard;
  canFlip?: ActionGuard;
  /** JavaScript-facing spelling. */
  canPress?: CanPressGuard;
  can_grab?: ActionGuard;
  can_drop?: ActionGuard;
  can_flip?: ActionGuard;
  /** Lua guard spelling retained for the wave-9 binding surface. */
  can_press?: CanPressGuard;
}
