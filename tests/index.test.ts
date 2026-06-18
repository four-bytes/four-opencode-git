import { describe, test, expect } from "bun:test";
import plugin from "../src/four-opencode-git";

describe("four-opencode-git", () => {
  test("plugin module loads", () => {
    expect(plugin).toBeDefined();
    expect(typeof plugin).toBe("function");
  });
});
