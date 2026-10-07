/** The arguments typed one per line: each trimmed, blank lines dropped. */
export function argsFromLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
