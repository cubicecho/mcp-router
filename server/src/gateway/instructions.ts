/**
 * Head of the aggregate's instructions, explaining that the names on this endpoint are prefixed.
 *
 * @remarks
 * Without it a member's own guidance ("call `resolve-library-id` first") names tools the client was never offered.
 */
const AGGREGATE_INSTRUCTIONS_PREAMBLE =
  'This endpoint merges several MCP servers. Every tool name, prompt name and resource URI is ' +
  "prefixed with `<server>__`. Each section below is one server's own instructions; read the " +
  "names in it as carrying that section's prefix.";

/**
 * Builds the aggregate's `instructions`: every member's own, under a heading naming the server they belong to.
 *
 * @param members - `[server name, its instructions]` in the order they should read; blank ones are left out.
 * @returns The preamble and the sections, or undefined when no member has anything to say.
 */
export function mergeInstructions(members: [name: string, instructions: string | undefined][]): string | undefined {
  const sections = members
    .filter((member): member is [string, string] => Boolean(member[1]?.trim()))
    .map(([name, text]) => `## ${name}\n\n${text.trim()}`);
  if (sections.length === 0) {
    return undefined;
  }
  return [AGGREGATE_INSTRUCTIONS_PREAMBLE, ...sections].join('\n\n');
}
