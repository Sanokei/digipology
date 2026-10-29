/** Admission only: visible variation is not evidence of good composition or style. */
export function hasVisibleRasterSignal(pixels: Uint8ClampedArray): boolean {
  if (pixels.length < 4 || pixels.length % 4 !== 0) return false;
  const minimum = [255, 255, 255], maximum = [0, 0, 0];
  const matte = [250, 247, 238];
  let visible = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3]! / 255;
    if (alpha >= 0.05) visible += 1;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = pixels[index + channel]! * alpha + matte[channel]! * (1 - alpha);
      minimum[channel] = Math.min(minimum[channel]!, value);
      maximum[channel] = Math.max(maximum[channel]!, value);
    }
  }
  return visible >= Math.max(4, pixels.length / 4 * 0.001) && maximum.some((value, channel) => value - minimum[channel]! >= 12);
}

export async function assertVisibleRasterSignal(file: Blob): Promise<void> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("The generated image could not be decoded. Retry to create a new image."); }
  try {
    const scale = 96 / Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser could not inspect the generated image. Retry or download the original.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (!hasVisibleRasterSignal(context.getImageData(0, 0, canvas.width, canvas.height).data)) throw new Error("The generated image was blank or invisible. Retry to create a new image.");
  } finally { bitmap.close(); }
}
