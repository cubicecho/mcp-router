/**
 * Head of the aggregate's instructions, explaining the one thing that is true of
 * this endpoint and of no server behind it: the names are prefixed. Without it a
 * member's own guidance ("call `resolve-library-id` first") names tools the
 * client was never offered.
 */
const AGGREGATE_INSTRUCTIONS_PREAMBLE =
  'This endpoint merges several MCP servers. Every tool name, prompt name and resource URI is ' +
  "prefixed with `<server>__`. Each section below is one server's own instructions; read the " +
  "names in it as carrying that section's prefix.";

/**
 * The aggregate's `instructions`: every member's own, under a heading naming the
 * server whose prefix they belong to. Servers with nothing to say are left out
 * entirely, and if none of them has anything the whole field is absent rather
 * than a lone preamble explaining a scheme with no content under it.
 *
 * @param members `[server name, its instructions]` in the order they should read.
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
