import { describe, expect, it } from "bun:test";
import { commandLine, completionPrefix, firstWord, rememberLine, splitCommand } from "./console";

describe("console commands", () => {
  it("prepends the selected program", () => {
    expect(commandLine("status", "git")).toBe("git status");
    expect(commandLine("clean install", "mvn")).toBe("mvn clean install");
    expect(commandLine("-version", "java")).toBe("java -version");
    expect(commandLine("test ./...", "go")).toBe("go test ./...");
  });

  it("keeps a line that already names a program", () => {
    expect(commandLine("git status", "git")).toBe("git status");
    expect(commandLine("mvn test", "git")).toBe("mvn test");
    expect(commandLine("go build ./...", "mvn")).toBe("go build ./...");
  });

  it("runs a bang line as typed", () => {
    expect(commandLine("!ls -la", "git")).toBe("ls -la");
    expect(commandLine("", "git")).toBe("");
  });

  it("supports a custom prefix", () => {
    expect(commandLine("build", "my-cli")).toBe("my-cli build");
    expect(commandLine("my-cli build", "my-cli")).toBe("my-cli build");
  });

  it("builds the completion prefix without doubling the program", () => {
    expect(completionPrefix("st", "git")).toBe("git st");
    expect(completionPrefix("git st", "git")).toBe("git st");
    expect(completionPrefix("clean", "mvn")).toBe("mvn clean");
    expect(completionPrefix("mvn clean", "git")).toBe("mvn clean");
    expect(completionPrefix("", "mvn")).toBe("mvn");
    expect(completionPrefix("!ls", "git")).toBe("ls");
  });

  it("remembers each program's history separately", () => {
    const one = rememberLine({}, "git", "status");
    const two = rememberLine(one, "mvn", "clean");
    expect(two).toEqual({ git: ["status"], mvn: ["clean"] });
    expect(two.git).not.toContain("clean");
    expect(rememberLine(two, "git", "status")).toEqual({ git: ["status"], mvn: ["clean"] });
    expect(rememberLine(two, "git", "log").git).toEqual(["log", "status"]);
  });

  it("splits the program from its arguments", () => {
    expect(splitCommand("git status --short")).toEqual({ head: "git", rest: "status --short" });
    expect(splitCommand("make")).toEqual({ head: "make", rest: "" });
    expect(firstWord("  ")).toBe("");
  });
});
