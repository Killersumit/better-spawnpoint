/**
 * Minimal, dependency-free, XSS-safe markdown renderer for the policy pages.
 *
 * Why not a markdown library: the full-featured ones pull in syntax
 * highlighters, diagram engines, and a WASM runtime (hundreds of kB and a
 * permission-shaped attack surface) to render ten documents that use headings,
 * lists, tables, and links. This file supports exactly the subset the policy
 * templates use, and — more importantly — it is safe BY CONSTRUCTION:
 *
 *  • Every piece of text is escaped; there is no `dangerouslySetInnerHTML`
 *    anywhere in the render path.
 *  • Link hrefs are allow-listed to `https:`, `mailto:`, `tel:`, and
 *    site-relative paths, so `javascript:` and `data:` URLs cannot render.
 *  • Raw HTML in the source markdown is escaped and shown as text, not parsed.
 *
 * Supported syntax: # to ####  headings, paragraphs, `-`/`*` bullet lists,
 * `1.` ordered lists, GFM tables, `>` blockquotes, `---` rules, and inline
 * `**bold**`, `*italic*`, `` `code` ``, and `[text](url)`.
 *
 * Rendered elements carry accessible structure: one <h1>-equivalent heading per
 * page comes from the layout, tables use <th scope="col">, and links that leave
 * the site get rel="noopener noreferrer".
 */
import type { ElementType, ReactNode } from "react";

export function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only these schemes may become clickable. */
const ALLOWED_SCHEMES = ["https:", "mailto:", "tel:"];

export function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  // Site-relative and hash links are fine.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  if (trimmed.startsWith("#")) return true;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return true;
  if (lower.startsWith("mailto:") || lower.startsWith("tel:")) return true;

  try {
    return ALLOWED_SCHEMES.includes(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}

export function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

/** Inline formatting. Input is raw markdown text, output is safe React nodes. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Order matters: code first (its contents must not be re-parsed), then links,
  // then emphasis.
  const pattern =
    /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_{1}[^_]+_{1})/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${index++}`;

    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1.5 py-0.5 text-sm">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const label = linkMatch?.[1] ?? "";
      const href = linkMatch?.[2] ?? "";
      if (!isSafeHref(href)) {
        // Unsafe scheme: render the label as plain text rather than dropping it.
        nodes.push(label);
      } else {
        nodes.push(
          <a
            key={key}
            href={href}
            className="underline underline-offset-2"
            {...(isExternal(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {label}
          </a>
        );
      }
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "quote"; lines: string[] }
  | { type: "rule" };

function parseBlocks(markdown: string): Block[] {
  // HTML comments are authoring notes for the template, never rendered.
  const cleaned = markdown.replace(/<!--[\s\S]*?-->/g, "");
  const lines = cleaned.split("\n");
  const blocks: Block[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: (heading[1] ?? "#").length, text: heading[2] ?? "" });
      i++;
      continue;
    }

    // Table: a header row, a divider row, then body rows.
    if (
      line.includes("|") &&
      /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? "") &&
      (lines[i + 1] ?? "").includes("-")
    ) {
      const headers = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").includes("|")) {
        rows.push(splitRow(lines[i] ?? ""));
        i++;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) {
        quoteLines.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^(#{1,4})\s+/.test(lines[i] ?? "") &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? "") &&
      !/^\s*>\s?/.test(lines[i] ?? "")
    ) {
      paragraph.push(lines[i] ?? "");
      i++;
    }
    blocks.push({ type: "paragraph", lines: paragraph });
  }

  return blocks;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

export function Markdown({ source }: { source: string }): ReactNode {
  const blocks = parseBlocks(source);

  return (
    <>
      {blocks.map((block, index) => {
        const key = `block-${index}`;

        switch (block.type) {
          case "heading": {
            // The page layout owns the single <h1>, so body headings start at h2.
            const Tag = (
              block.level <= 1 ? "h2" : `h${Math.min(block.level, 6)}`
            ) as ElementType;
            return (
              <Tag key={key} className="mt-8 scroll-mt-20 text-xl font-semibold tracking-tight">
                {renderInline(block.text, key)}
              </Tag>
            );
          }

          case "paragraph":
            return (
              <p key={key} className="mt-4 leading-7 text-muted-foreground">
                {renderInline(block.lines.join(" "), key)}
              </p>
            );

          case "list":
            return block.ordered ? (
              <ol key={key} className="mt-4 ml-6 list-decimal space-y-2 text-muted-foreground">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key} className="mt-4 ml-6 list-disc space-y-2 text-muted-foreground">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ul>
            );

          case "table":
            return (
              <div key={key} className="mt-6 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {block.headers.map((header, headerIndex) => (
                        <th
                          key={`${key}-h-${headerIndex}`}
                          scope="col"
                          className="py-2 pr-4 font-medium"
                        >
                          {renderInline(header, `${key}-h-${headerIndex}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={`${key}-r-${rowIndex}`} className="border-b border-border/60">
                        {row.map((cell, cellIndex) => (
                          <td
                            key={`${key}-c-${rowIndex}-${cellIndex}`}
                            className="py-2 pr-4 align-top text-muted-foreground"
                          >
                            {renderInline(cell, `${key}-c-${rowIndex}-${cellIndex}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "quote":
            return (
              <blockquote
                key={key}
                className="mt-4 border-l-2 border-border pl-4 italic text-muted-foreground"
              >
                {renderInline(block.lines.join(" "), key)}
              </blockquote>
            );

          case "rule":
            return <hr key={key} className="my-8 border-border" />;

          default:
            return null;
        }
      })}
    </>
  );
}

/** Convenience for tests and for `npm run verify` sanity checks. */
export const markdownInternals = { parseBlocks, renderInline, splitRow };
