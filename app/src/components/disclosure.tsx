/**
 * Compiled from `registry/layout/disclosure.tsx` by `scripts/rn2web`.
 * Do not edit — edit the source and re-run `npm run compile`.
 *
 * The prose below is the source's own, carried across untouched, which is the property that makes
 * a compiled registry worth having: this is the same component, not a second one to keep in step
 * by hand. Where a comment names a React Native component it is describing the source; the
 * element map in `scripts/rn2web/tables.mjs` says what that became here.
 */

import type { ReactNode } from 'react';
import * as React from 'react';
import { ChevronRight } from '@/components/ui/icons';
import { cn, type SlotNode } from '@/lib/utils';

type DisclosureProps = {
  /** What the button says: "Completed (3)", "Raw output". It is the button's accessible name. */
  title: ReactNode;
  /** One line under the title, inside the button, drawn whether open or shut. */
  description?: ReactNode | undefined;
  /**
   * The header's far end, **outside** the button: a copy button, a count, a clear-all. A control
   * nested in a button is invalid HTML and, in practice, a click that also toggles the section.
   */
  actionSlot?: SlotNode | undefined;
  /** What opening shows. Not mounted while shut, so a long list behind it costs nothing. */
  contentSlot?: SlotNode | undefined;
  /**
   * Whether it is open, when the caller holds that — a deep link, a "show the failure" button
   * elsewhere, a title that reads "Hide" once open. Leave it out and the disclosure holds its own.
   */
  open?: boolean | undefined;
  /** Told on every toggle, controlled or not. Given alone, it listens without taking over. */
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** Where an uncontrolled disclosure starts. Shut by default, the way `<details>` is. */
  defaultOpen?: boolean | undefined;
  className?: string | undefined;
  headerClassName?: string | undefined;
  titleClassName?: string | undefined;
  contentClassName?: string | undefined;
};

/**
 * A titled part of a screen whose body shows and hides — "Show completed (3)" under a list, "Raw
 * output" over a payload nobody reads in passing. One source for both platforms.
 *
 * It is here because fourteen places in eight projects wrote it by hand, three ways: a chevron
 * `<button>` with a rotate class (mcp-router, three times), a bare `<details>` (task_server,
 * kanban, zeromem), and a ghost `Button` whose label flips between Show and Hide (telos, auto-cal,
 * min-agent on device). `<details>` has no React Native counterpart, so the native copies each
 * rebuilt it from `useState`, and none of the three shapes agreed on where an action goes.
 *
 * What it guarantees is `DisclosureRow`'s list, because they are the parts hand-written
 * disclosures get wrong:
 *
 * - **The whole header is one button** — a `<button>` on the web, `role="button"` on device —
 *   so it is reached by Tab and toggled by Enter and Space, not a 16-pixel chevron with a handler.
 * - `aria-expanded` on that button, so the state is announced rather than only drawn; and on the
 *   web `aria-controls` naming the body, while the body is there to name.
 * - The chevron turns off the same boolean, so there is one source of truth for open.
 * - **`actionSlot` sits outside the button.** A button in a button is invalid, and the nested one's
 *   click toggles the section on its way up.
 *
 * The look is the compact one, since that is what most of the copies are: a muted `text-sm`
 * line with the chevron before it, and the body under it with no inset. `titleClassName` is how a
 * caller makes the title the foreground where the disclosure is the section's heading.
 *
 * Open is the shell's own interaction, so it may hold it (AGENTS.md rule 5): uncontrolled with
 * `defaultOpen`, controlled with `open`, and `onOpenChange` heard either way. The two never mirror.
 */
export function Disclosure({
  title,
  description,
  actionSlot,
  contentSlot,
  open: openProp,
  onOpenChange,
  defaultOpen = false,
  className,
  headerClassName,
  titleClassName,
  contentClassName,
}: DisclosureProps) {
  const [ownOpen, setOwnOpen] = React.useState(defaultOpen);
  const open = openProp ?? ownOpen;
  const contentId = React.useId();
  const shown = open && contentSlot !== undefined && contentSlot !== null && contentSlot !== false;

  const toggle = () => {
    if (openProp === undefined) {
      setOwnOpen(!open);
    }
    onOpenChange?.(!open);
  };

  return (
    <div data-slot="disclosure" className={cn('cube-rn-view', 'min-w-0 gap-2', className)}>
      <div
        data-slot="disclosure-header"
        className={cn('cube-rn-view', 'min-w-0 flex-row items-start gap-2', headerClassName)}
      >
        <button
          type="button"
          data-slot="disclosure-trigger"
          aria-expanded={open}
          // Web only: React Native has no `aria-controls`, and pointing it at an id that is not in
          // the document is a broken reference rather than a hint — the body unmounts when shut.
          {...(shown ? { 'aria-controls': contentId } : {})}
          onClick={toggle}
          className={cn(
            'cube-rn-view cube-rn-pressable',
            'min-w-0 flex-1 flex-row items-start gap-1.5 rounded-sm',
            'text-left focus-visible:bg-hover focus-visible:outline-none',
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn('mt-0.5 size-4 shrink-0 text-foreground/60', 'transition-transform', open && 'rotate-90')}
          />
          <div className="cube-rn-view min-w-0 flex-1 gap-0.5">
            <span
              data-slot="disclosure-title"
              className={cn('cube-rn-text', 'font-medium text-foreground/60 text-sm', titleClassName)}
            >
              {title}
            </span>
            {description ? (
              <span data-slot="disclosure-description" className="cube-rn-text text-foreground/60 text-xs">
                {description}
              </span>
            ) : null}
          </div>
        </button>
        {actionSlot ? (
          <div data-slot="disclosure-action" className="cube-rn-view shrink-0 flex-row items-center gap-1">
            {actionSlot}
          </div>
        ) : null}
      </div>

      {shown ? (
        <div
          data-slot="disclosure-content"
          id={contentId}
          className={cn('cube-rn-view', 'min-w-0 gap-2', contentClassName)}
        >
          {contentSlot}
        </div>
      ) : null}
    </div>
  );
}
