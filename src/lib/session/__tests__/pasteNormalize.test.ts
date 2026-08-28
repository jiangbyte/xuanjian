import { describe, expect, it } from "vitest";
import { normalizePasteForPty } from "@/lib/session/pasteNormalize";

describe("normalizePasteForPty", () => {
  it("converts CRLF so backslash line continuation survives", () => {
    const pasted =
      "docker run -d \\\r\n  --name mysql \\\r\n  mysql:8\r\n";
    expect(normalizePasteForPty(pasted)).toBe(
      "docker run -d \\\n  --name mysql \\\n  mysql:8\n",
    );
  });

  it("converts lone CR", () => {
    expect(normalizePasteForPty("a\\\rb\\\rc")).toBe("a\\\nb\\\nc");
  });

  it("keeps LF-only text unchanged", () => {
    const t = "docker run -d \\\n  --name mysql\n";
    expect(normalizePasteForPty(t)).toBe(t);
  });
});
