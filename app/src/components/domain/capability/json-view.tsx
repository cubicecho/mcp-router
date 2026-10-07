import { type ReactNode, useState } from 'react';
import { Disclosure } from '@/components/disclosure';
import { CodeBlock } from '@/components/ui/code';
import { SegmentedButton, SegmentedGroup } from '@/components/ui/segmented';
import { DISPLAY_DEFAULTS } from '@/lib/defaults';
import { cn } from '@/lib/utils';

/**
 * Renders a value as plain text.
 *
 * @param value - Anything; a string is returned as-is.
 * @returns Pretty-printed JSON, or `String(value)` when it cannot be serialized.
 */
function toText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Parses a string that is itself a JSON object or array, as MCP text content often is.
 *
 * @param value - The string; surrounding whitespace is ignored.
 * @returns The parsed object or array for the tree to drill into; undefined for anything else.
 */
function parseEmbedded(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.length < 2 || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Words the size of a collapsed container.
 *
 * @param count - Number of entries.
 * @param isArray - True counts items, false counts keys.
 * @returns e.g. "3 items" for an array, "1 key" for an object.
 */
function formatSize(count: number, isArray: boolean): string {
  const noun = isArray ? 'item' : 'key';
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/**
 * The quoted property name and colon in front of a value.
 *
 * @param [props.name] - Property name; left out for array items and the root.
 * @returns The label, or null without a name.
 */
function Key({ name }: { name?: string }) {
  if (name === undefined) {
    return null;
  }
  return (
    <>
      <span className="text-foreground">"{name}"</span>
      <span className="text-foreground/60">: </span>
    </>
  );
}

/**
 * One line of the tree for a value with no children, coloured by its type.
 *
 * @param props.value - A primitive; anything else is drawn through `String()`.
 * @param [props.name] - Property name; left out for array items and the root.
 * @param props.comma - Whether a trailing comma follows the value.
 * @returns The line.
 */
function Leaf({ value, name, comma }: { value: unknown; name?: string; comma: boolean }) {
  let body: ReactNode;
  if (value === null) {
    body = <span className="text-info">null</span>;
  } else if (value === undefined) {
    body = <span className="text-foreground/60">undefined</span>;
  } else if (typeof value === 'string') {
    body = <span className="break-all text-positive">"{value}"</span>;
  } else if (typeof value === 'number') {
    body = <span className="text-warning">{String(value)}</span>;
  } else if (typeof value === 'boolean') {
    body = <span className="text-info">{String(value)}</span>;
  } else {
    body = <span className="break-all">{String(value)}</span>;
  }
  return (
    <div>
      <Key name={name} />
      {body}
      {comma && <span className="text-foreground/60">,</span>}
    </div>
  );
}

/**
 * One value of the tree: a leaf line, or a collapsible object or array that recurses into its entries.
 *
 * @param props.value - The value; a string holding a JSON object or array is parsed and drawn as a tree.
 * @param [props.name] - Property name; left out for array items and the root.
 * @param props.depth - Nesting level, 0 at the root; shallow levels start expanded.
 * @param props.comma - Whether a trailing comma follows the value.
 * @param [props.embedded] - True when the value was parsed out of a string, which tags it "json".
 * @returns The line or the disclosure.
 */
function Node({
  value,
  name,
  depth,
  comma,
  embedded,
}: {
  value: unknown;
  name?: string;
  depth: number;
  comma: boolean;
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(depth < DISPLAY_DEFAULTS.jsonOpenDepth);

  // A string that is itself JSON renders as a drillable tree, tagged "json".
  if (typeof value === 'string') {
    const parsed = parseEmbedded(value);
    if (parsed !== undefined) {
      return <Node value={parsed} name={name} depth={depth} comma={comma} embedded />;
    }
    return <Leaf value={value} name={name} comma={comma} />;
  }

  if (value === null || typeof value !== 'object') {
    return <Leaf value={value} name={name} comma={comma} />;
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const openBracket = isArray ? '[' : '{';
  const closeBracket = isArray ? ']' : '}';

  if (entries.length === 0) {
    return (
      <div>
        <Key name={name} />
        <span className="text-foreground/60">
          {openBracket}
          {closeBracket}
        </span>
        {comma && <span className="text-foreground/60">,</span>}
      </div>
    );
  }

  return (
    <Disclosure
      open={open}
      onOpenChange={setOpen}
      className="gap-0"
      titleClassName="font-mono font-normal text-xs"
      contentClassName="gap-0"
      title={
        <>
          <Key name={name} />
          {embedded && (
            <span className="mr-1 rounded bg-foreground/10 px-1 text-[0.65rem] text-foreground/60">json</span>
          )}
          <span className="text-foreground/60">{openBracket}</span>
          {open === false && (
            <span className="text-foreground/60">
              … {closeBracket}
              <span className="ml-1 text-[0.7rem]">{formatSize(entries.length, isArray)}</span>
            </span>
          )}
        </>
      }
      contentSlot={
        <>
          <div className="ml-2 border-l border-foreground/10 pl-3">
            {entries.map(([key, child], i) => (
              <Node
                key={key}
                name={isArray ? undefined : key}
                value={child}
                depth={depth + 1}
                comma={i < entries.length - 1}
              />
            ))}
          </div>
          <div className="pl-[1.375rem] text-foreground/60">
            {closeBracket}
            {comma && ','}
          </div>
        </>
      }
    />
  );
}

/**
 * Syntax-highlighted, collapsible tree rendering of any JSON value.
 *
 * @param props.value - The root value.
 * @returns The tree.
 */
function JsonTree({ value }: { value: unknown }) {
  return (
    <div className="font-mono text-xs leading-relaxed">
      <Node value={value} depth={0} comma={false} />
    </div>
  );
}

const VIEW_TEXT = 'text';
const VIEW_TREE = 'json';

/**
 * Labeled data panel that shows a value as pretty-printed text or, on a toggle, as a collapsible tree.
 *
 * @param props.value - The data to show.
 * @param props.label - Caption above the panel; also names the view toggle.
 * @param [props.isError] - Draws the caption and border in the error colour.
 * @returns The panel.
 */
export function DataBlock({ value, label, isError }: { value: unknown; label: string; isError?: boolean }) {
  const [view, setView] = useState<typeof VIEW_TEXT | typeof VIEW_TREE>(VIEW_TEXT);
  const errorBorder = isError ? 'border-negative/40' : undefined;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <p className={cn('text-xs font-medium', isError ? 'text-negative' : 'text-foreground/60')}>{label}</p>
        <SegmentedGroup
          variant="plain"
          aria-label={`${label} view`}
          value={view}
          onValueChange={(next) => setView(next === VIEW_TREE ? VIEW_TREE : VIEW_TEXT)}
        >
          <SegmentedButton value={VIEW_TEXT}>Text</SegmentedButton>
          <SegmentedButton value={VIEW_TREE}>JSON</SegmentedButton>
        </SegmentedGroup>
      </div>
      {view === VIEW_TEXT ? (
        <CodeBlock content={toText(value)} wrap maxHeight="lg" className={errorBorder} />
      ) : (
        <div
          className={cn(
            // On the page's own ground, not the grey of a code block: the tree's value colours
            // (strings, numbers, booleans) are under 4.5:1 against a tinted panel.
            'max-h-96 overflow-auto rounded-md border border-foreground/10 bg-background p-3',
            errorBorder,
          )}
        >
          <JsonTree value={value} />
        </div>
      )}
    </div>
  );
}
