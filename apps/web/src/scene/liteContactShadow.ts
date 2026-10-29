import type { ShaderMaterialOptions } from "@babylonjs/lite";

/** Self-contained alpha avoids StandardMaterial's lazily loaded opacity extension. */
export const LITE_CONTACT_SHADOW: ShaderMaterialOptions = {
  name: "table-contact-shadow",
  attributes: ["position", "uv"],
  uniforms: ["world", "view", "projection"],
  needAlphaBlending: true,
  blendMode: "alpha",
  depthWrite: false,
  backFaceCulling: true,
  vertexSource: `
struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = shaderSystem.projection * (shaderSystem.view * (shaderSystem.world * vec4<f32>(input.position, 1.0)));
  output.uv = input.uv;
  return output;
}`,
  fragmentSource: `
struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let radius = length(input.uv * 2.0 - vec2<f32>(1.0, 1.0));
  let alpha = (1.0 - smoothstep(0.0, 1.0, radius)) * 0.31;
  if (alpha < 0.001) { discard; }
  return vec4<f32>(0.0, 0.0, 0.0, alpha);
}`,
};

/** Apply world yaw after laying the plane flat; Lite's XYZ Euler order differs. */
export function horizontalShadowRotation(yaw: number): [number, number, number, number] {
  const sin = Math.sin(yaw / 2) * Math.SQRT1_2;
  const cos = Math.cos(yaw / 2) * Math.SQRT1_2;
  return [cos, sin, -sin, cos];
}
