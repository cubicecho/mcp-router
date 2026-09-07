/**
 * The `instructions` the echo fixture serves, in a module of its own.
 *
 * `echo-server.ts` is spawned as a child process, not imported: its top-level
 * `await server.connect(new StdioServerTransport())` would take over the stdio of
 * whatever imported it. So the one value a test needs to assert against lives
 * here, where both sides can read it without either running the other.
 */
export const ECHO_INSTRUCTIONS = 'Call `pid` to learn which process answered you.';
