/**
 * Splits typed text into command-line arguments.
 *
 * @param text - One argument per line.
 * @returns The lines, each trimmed, with blank ones dropped.
 */
export function argsFromLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
