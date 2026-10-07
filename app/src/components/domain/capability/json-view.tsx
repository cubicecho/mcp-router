import { type ReactNode, useState } from 'react';
import { Disclosure } from '@/components/disclosure';
import { CodeBlock } from '@/components/ui/code';
import { SegmentedButton, SegmentedGroup } from '@/components/ui/segmented';
import { DISPLAY_DEFAULTS } from '@/lib/defaults';
import { cn } from '@/lib/utils';

/** Plain-text rendering of a value: strings as-is, everything else pretty JSON. */
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
 * If a string is itself a JSON object/array (common for MCP text content),
 * return the parsed value so the tree can drill into it; otherwise undefined.
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

/** "3 items" for an array, "1 key" for an object. */
function formatSize(count: number, isArray: boolean): string {
  const noun = isArray ? 'item' : 'key';
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

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

/** Syntax-highlighted, collapsible tree rendering of any JSON value. */
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
 * Labeled data panel with a Text / JSON toggle: renders the value as plain
 * pretty-printed text or as a collapsible syntax-highlighted tree.
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
