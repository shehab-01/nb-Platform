import { describe, expect, it } from "vitest";

import { buildXlsx, crc32 } from "./xlsx";

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("buildXlsx", () => {
  const bytes = buildXlsx([
    ["No", "Phone"],
    [1, "01712345678"],
    [2, "<&>"],
  ]);
  const text = new TextDecoder().decode(bytes);

  it("is a zip archive", () => {
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const end = new DataView(bytes.buffer, bytes.length - 22);
    expect(end.getUint32(0, true)).toBe(0x06054b50);
    expect(end.getUint16(10, true)).toBe(5);
  });

  it("keeps phone numbers as text and escapes markup", () => {
    expect(text).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">01712345678</t>');
    expect(text).toContain('<c r="A2"><v>1</v></c>');
    expect(text).toContain("&lt;&amp;&gt;");
  });
});
