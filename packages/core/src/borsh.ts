/**
 * Minimal borsh readers and writers used by the MarkDesk protocol encoders.
 *
 * Everything operates on `Uint8Array` so the package stays independent of
 * Node-specific buffers and can run in the browser bundle.
 */

export class BorshWriter {
  private readonly bytes: number[] = [];

  get length(): number {
    return this.bytes.length;
  }

  u8(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new RangeError(`u8 out of range: ${value}`);
    }
    this.bytes.push(value);
    return this;
  }

  u16(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new RangeError(`u16 out of range: ${value}`);
    }
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff);
    return this;
  }

  i16(value: number): this {
    if (!Number.isInteger(value) || value < -0x8000 || value > 0x7fff) {
      throw new RangeError(`i16 out of range: ${value}`);
    }
    this.u16(value & 0xffff);
    return this;
  }

  u32(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new RangeError(`u32 out of range: ${value}`);
    }
    this.bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
    return this;
  }

  u64(value: bigint | number): this {
    const raw = BigInt(value);
    if (raw < 0n || raw > 0xffff_ffff_ffff_ffffn) {
      throw new RangeError(`u64 out of range: ${value}`);
    }
    for (let shift = 0n; shift < 64n; shift += 8n) {
      this.bytes.push(Number((raw >> shift) & 0xffn));
    }
    return this;
  }

  i64(value: bigint | number): this {
    const raw = BigInt(value);
    if (raw < -0x8000_0000_0000_0000n || raw > 0x7fff_ffff_ffff_ffffn) {
      throw new RangeError(`i64 out of range: ${value}`);
    }
    const encoded = raw >= 0n ? raw : (1n << 64n) + raw;
    for (let shift = 0n; shift < 64n; shift += 8n) {
      this.bytes.push(Number((encoded >> shift) & 0xffn));
    }
    return this;
  }

  /** Writes a 32-byte public key from a raw little-endian-free byte array. */
  publicKey(bytes: Uint8Array): this {
    if (bytes.length !== 32) {
      throw new RangeError(`public key must be 32 bytes, got ${bytes.length}`);
    }
    this.bytes.push(...bytes);
    return this;
  }

  /** Writes pre-encoded bytes, e.g. an Anchor instruction discriminator. */
  rawBytes(bytes: Uint8Array): this {
    this.bytes.push(...bytes);
    return this;
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export class BorshReader {
  readonly data: Uint8Array;
  offset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  private take(count: number): Uint8Array {
    if (this.offset + count > this.data.length) {
      throw new RangeError(
        `borsh read out of bounds: need ${this.offset + count} bytes, have ${this.data.length}`,
      );
    }
    const slice = this.data.subarray(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }

  u8(): number {
    return this.take(1)[0]!;
  }

  u16(): number {
    const [low, high] = this.take(2);
    return low! | (high! << 8);
  }

  i16(): number {
    const value = this.u16();
    return value >= 0x8000 ? value - 0x10000 : value;
  }

  u32(): number {
    const bytes = this.take(4);
    // Multiplication (not `<<`) keeps the high byte unsigned past 2^31.
    return bytes[0]! + bytes[1]! * 2 ** 8 + bytes[2]! * 2 ** 16 + bytes[3]! * 2 ** 24;
  }

  u64(): bigint {
    let value = 0n;
    const bytes = this.take(8);
    for (let i = 7; i >= 0; i -= 1) {
      value = (value << 8n) | BigInt(bytes[i]!);
    }
    return value;
  }

  i64(): bigint {
    const raw = this.u64();
    return raw >= 1n << 63n ? raw - (1n << 64n) : raw;
  }

  publicKey(): Uint8Array {
    return Uint8Array.from(this.take(32));
  }

  expectEnd(): void {
    if (this.offset !== this.data.length) {
      throw new RangeError(`borsh trailing bytes: consumed ${this.offset} of ${this.data.length}`);
    }
  }
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export function toHex(bytes: Uint8Array): string {
  return bytes.reduce((hex, byte) => hex + byte.toString(16).padStart(2, "0"), "");
}
