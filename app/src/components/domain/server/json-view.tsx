import { ChevronRightIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
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

function Key({ name }: { name?: string }) {
  if (name === undefined) {
    return null;
  }
  return (
    <>
      <span className="text-sky-700 dark:text-sky-300">"{name}"</span>
      <span className="text-muted-foreground">: </span>
    </>
  );
}

function Leaf({ value, name, comma }: { value: unknown; name?: string; comma: boolean }) {
  let body: ReactNode;
  if (value === null) {
    body = <span className="text-purple-600 dark:text-purple-400">null</span>;
  } else if (value === undefined) {
    body = <span className="text-muted-foreground">undefined</span>;
  } else if (typeof value === 'string') {
    body = <span className="break-all text-emerald-700 dark:text-emerald-400">"{value}"</span>;
  } else if (typeof value === 'number') {
    body = <span className="text-amber-700 dark:text-amber-500">{String(value)}</span>;
  } else if (typeof value === 'boolean') {
    body = <span className="text-purple-600 dark:text-purple-400">{String(value)}</span>;
  } else {
    body = <span className="break-all">{String(value)}</span>;
  }
  return (
    <div>
      <Key name={name} />
      {body}
      {comma && <span className="text-muted-foreground">,</span>}
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
  const [open, setOpen] = useState(depth < 3);

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
        <span className="text-muted-foreground">
          {openBracket}
          {closeBracket}
        </span>
        {comma && <span className="text-muted-foreground">,</span>}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-1 text-left hover:opacity-80"
      >
        <ChevronRightIcon
          className={cn(
            'mt-[0.15rem] size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <span className="min-w-0">
          <Key name={name} />
          {embedded && (
            <span className="mr-1 rounded bg-muted-foreground/15 px-1 text-[0.65rem] text-muted-foreground">json</span>
          )}
          <span className="text-muted-foreground">{openBracket}</span>
          {!open && (
            <span className="text-muted-foreground">
              … {closeBracket}
              <span className="ml-1 text-[0.7rem]">
                {entries.length}{' '}
                {isArray ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'}
              </span>
            </span>
          )}
        </span>
      </button>
      {open && (
        <>
          <div className="ml-[0.4rem] border-l border-border pl-3">
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
          <div className="pl-[1.15rem] text-muted-foreground">
            {closeBracket}
            {comma && ','}
          </div>
        </>
      )}
    </div>
  );
}

/** Syntax-highlighted, collapsible tree rendering of any JSON value. */
export function JsonTree({ value }: { value: unknown }) {
  return (
    <div className="font-mono text-xs leading-relaxed">
      <Node value={value} depth={0} comma={false} />
    </div>
  );
}

/**
 * Labeled data panel with a Text / JSON toggle: renders the value as plain
 * pretty-printed text or as a collapsible syntax-highlighted tree.
 */
export function DataBlock({ value, label, isError }: { value: unknown; label: string; isError?: boolean }) {
  const [view, setView] = useState<'text' | 'json'>('text');
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className={cn('text-xs font-medium', isError ? 'text-destructive' : 'text-muted-foreground')}>{label}</p>
        <div className="inline-flex overflow-hidden rounded border text-xs">
          {(['text', 'json'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cn(
                'px-2 py-0.5 font-medium capitalize transition-colors',
                view === option ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div
        className={cn('mt-1 max-h-96 overflow-auto rounded bg-muted p-2', isError && 'border border-destructive/50')}
      >
        {view === 'text' ? (
          <pre className="whitespace-pre-wrap text-xs">{toText(value)}</pre>
        ) : (
          <JsonTree value={value} />
        )}
      </div>
    </div>
  );
}
