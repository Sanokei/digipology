import { expect, test } from "bun:test";
import { SEAT_PALETTE, seatPaletteEntry, seatPaletteIndex } from "./seatPalette";

test("provides ten named, distinct, stable seat colors", () => {
  expect(SEAT_PALETTE.map((entry) => entry.name)).toEqual(["White", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Brown"]);
  expect(new Set(SEAT_PALETTE.map((entry) => entry.color)).size).toBe(10);
  for (let index = 1; index <= 10; index += 1) {
    expect(seatPaletteIndex(`seat_${index}`)).toBe(index - 1);
    expect(seatPaletteEntry(`piece_seat_${index}_a`)).toBe(SEAT_PALETTE[index - 1]!);
  }
});
