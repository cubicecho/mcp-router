import type { Context } from '../core/context.ts';

/** The sign-in steps that are throttled. Each has its own budget. */
export const AuthFlow = {
  VerifyOneTimeToken: 'verify-one-time-token',
  TrustedNetwork: 'trusted-network',
} as const;
export type AuthFlow = (typeof AuthFlow)[keyof typeof AuthFlow];

/**
 * Runs one sign-in attempt, refused once the caller has failed too often. Only a failure counts: one that
 * succeeds is given back, so opening the UI on a trusted network again and again never locks anyone out.
 *
 * @typeParam T - What the attempt answers.
 * @param context - The request's context, for its limiter and client IP.
 * @param flow - Which sign-in step this is.
 * @param attempt - The step itself. A throw is a failure.
 * @returns What the attempt answered.
 *
 * @remarks
 * By address alone: no sign-in step here names an account before it succeeds.
 */
export async function throttle<T>(context: Context, flow: AuthFlow, attempt: () => Promise<T>): Promise<T> {
  const refund = context.limiter.hit(`${flow}:ip:${context.ip}`);
  const answer = await attempt();
  refund();
  return answer;
}
