function minimalBitsForBigInt(x: bigint): number {
  if (x < 0n) throw new Error("Negative value not supported");
  if (x === 0n) return 1;
  let bits = 0;
  while (x > 0n) {
    x >>= 1n;
    bits++;
  }
  return bits;
}

export function packUnsigned64(
  values: (number | bigint)[],
  bitWidths?: number[]
): bigint {
  if (values.length === 0) return 0n;

  const bigVals = values.map((v) => (typeof v === "number" ? BigInt(v) : v));

  // compute or validate widths
  const widths: number[] = [];
  if (bitWidths) {
    if (bitWidths.length !== values.length)
      throw new Error("bitWidths length must match values length");
    for (let i = 0; i < values.length; i++) {
      const w = bitWidths[i];
      if (!Number.isInteger(w) || w <= 0)
        throw new Error("bitWidths must be positive integers");
      widths.push(w);
      // check that value fits
      const max = (1n << BigInt(w)) - 1n;
      if (bigVals[i] < 0n || bigVals[i] > max) {
        throw new Error(
          `Value at index ${i} (${bigVals[i]}) does not fit in ${w} bits`
        );
      }
    }
  } else {
    for (let i = 0; i < bigVals.length; i++) {
      const w = minimalBitsForBigInt(bigVals[i]);
      widths.push(w);
    }
  }

  const totalBits = widths.reduce((a, b) => a + b, 0);
  if (totalBits > 64)
    throw new Error(`Total bits ${totalBits} > 64 (overflow)`);
  let result = 0n;
  for (let i = 0; i < bigVals.length; i++) {
    const w = widths[i];
    // shift result left by w and OR the next value
    result = (result << BigInt(w)) | bigVals[i];
  }
  return result;
}

export function unpackUnsigned64(packed: bigint, widths: number[]): bigint[] {
  if (packed < 0n) throw new Error("packed must be non-negative");
  const totalBits = widths.reduce((a, b) => a + b, 0);
  if (totalBits > 64) throw new Error("Widths sum to more than 64");

  const out: bigint[] = new Array(widths.length);
  let rem = packed;
  for (let i = widths.length - 1; i >= 0; i--) {
    const w = widths[i];
    const mask = (1n << BigInt(w)) - 1n;
    out[i] = rem & mask;
    rem = rem >> BigInt(w);
  }
  return out;
}
