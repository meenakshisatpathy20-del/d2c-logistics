/**
 * Weight check before booking. A wrong weight is caught later as a weight
 * dispute and an extra charge; it is far cheaper to catch it now.
 */
export function weightWarning(weightGrams: number, l: number, b: number, h: number, typicalGrams?: number | null): string | null {
  if (!(weightGrams > 0)) return null;
  if (weightGrams > 20_000) return "Over 20 kg: please check the weight.";
  const volumetric = (l * b * h) / 5; // grams, L×B×H/5000 kg
  if (volumetric > weightGrams * 2 && volumetric - weightGrams >= 500) {
    return `The box size counts as ${(Math.ceil(volumetric / 500) * 500) / 1000} kg, so the courier will charge for that. Check the box size or use a smaller box.`;
  }
  if (typicalGrams && Math.abs(weightGrams - typicalGrams) / typicalGrams > 0.3) {
    return `This product usually weighs ${typicalGrams / 1000} kg in our past orders. Check the weight before booking.`;
  }
  return null;
}
