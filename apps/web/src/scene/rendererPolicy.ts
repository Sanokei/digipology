export type RendererTier = "default" | "low";
export type RendererAdapterKind = "lite" | "webgl";
export type RendererOverride = RendererAdapterKind | null;
export type RendererSelectionReason =
  | "webgpu"
  | "no-webgpu"
  | "override-lite"
  | "override-webgl"
  | "override-lite-no-webgpu";

export interface RendererAdapterSelection {
  renderer: RendererAdapterKind;
  requestedLiteFallback: boolean;
  reason: RendererSelectionReason;
}

export interface RendererFallback {
  from: "lite";
  to: "webgl";
  error: string;
}

export interface RendererStatus {
  requested: RendererAdapterKind;
  mounted: RendererAdapterKind | null;
  reason: RendererSelectionReason;
  fallback: RendererFallback | null;
  tier: RendererTier;
}

export interface RendererDeviceProfile {
  deviceMemory?: number | undefined;
  hardwareConcurrency?: number | undefined;
  userAgent?: string | undefined;
  mobile?: boolean | undefined;
}

const MOBILE_USER_AGENT = /Android|webOS|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i;

function positiveFinite(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function classifyRendererTier(profile: RendererDeviceProfile): RendererTier {
  const memory = positiveFinite(profile.deviceMemory);
  const cores = positiveFinite(profile.hardwareConcurrency);
  const mobile = profile.mobile ?? MOBILE_USER_AGENT.test(profile.userAgent ?? "");

  if ((memory !== undefined && memory <= 2) || (cores !== undefined && cores <= 2)) {
    return "low";
  }

  if (mobile && ((memory !== undefined && memory <= 4) || (cores !== undefined && cores <= 4))) {
    return "low";
  }

  return "default";
}

export function clampDevicePixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(Math.max(devicePixelRatio, 1), 2);
}

export function hardwareScalingLevel(devicePixelRatio: number): number {
  return 1 / clampDevicePixelRatio(devicePixelRatio);
}

export function rendererOverrideFromSearch(search: string): RendererOverride {
  const requested = new URLSearchParams(search).get("renderer");
  return requested === "lite" || requested === "webgl" ? requested : null;
}

export function selectRendererAdapter(
  webGpuAvailable: boolean,
  override: RendererOverride,
): RendererAdapterSelection {
  if (override === "webgl") {
    return { renderer: "webgl", requestedLiteFallback: false, reason: "override-webgl" };
  }
  if (override === "lite" && !webGpuAvailable) {
    return {
      renderer: "webgl",
      requestedLiteFallback: true,
      reason: "override-lite-no-webgpu",
    };
  }
  return {
    renderer: override === "lite" || webGpuAvailable ? "lite" : "webgl",
    requestedLiteFallback: false,
    reason: override === "lite" ? "override-lite" : webGpuAvailable ? "webgpu" : "no-webgpu",
  };
}
