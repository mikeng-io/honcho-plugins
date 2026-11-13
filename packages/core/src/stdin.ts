export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let s = "";
    process.stdin.on("data", (c) => (s += c));
    process.stdin.on("end", () => resolve(s));
    process.stdin.on("error", () => resolve(s));
  });
}

// Hook payloads vary by host and version: prompt text may be a plain string
// or an array of content blocks. Normalize both.
export function textOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) {
    return input
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}

export async function readPayload(): Promise<any> {
  const stdin = await readStdin();
  try {
    return JSON.parse(stdin);
  } catch {
    return {};
  }
}
