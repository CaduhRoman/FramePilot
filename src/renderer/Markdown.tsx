import React from 'react';

/** Minimal Markdown for chat replies, rendered to React elements (never raw HTML). */

const INLINE = /(`+)([^`]+?)\1|\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)|~~(.+?)~~|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(text: string, key = 'i'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0, n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2] !== undefined) out.push(<code key={k}>{m[2]}</code>);
    else if (m[3] !== undefined || m[4] !== undefined) out.push(<strong key={k}>{inline(m[3] ?? m[4], k)}</strong>);
    else if (m[5] !== undefined || m[6] !== undefined) out.push(<em key={k}>{inline(m[5] ?? m[6], k)}</em>);
    else if (m[7] !== undefined) out.push(<del key={k}>{inline(m[7], k)}</del>);
    else out.push(<span key={k} className="md-link" title={m[9]}>{inline(m[8], k)}</span>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

type Item = {text: string; children: string[]};
function list(lines: string[], key: string): React.ReactNode {
  const base = LIST.exec(lines[0])![1].length;
  const ordered = /\d/.test(LIST.exec(lines[0])![2]);
  const items: Item[] = [];
  for (const line of lines) {
    const m = LIST.exec(line);
    if (m && m[1].length <= base) items.push({text: m[3], children: []});
    else items.at(-1)?.children.push(line);
  }
  const Tag = ordered ? 'ol' : 'ul';
  return <Tag key={key}>{items.map((item, i) => <li key={i}>{inline(item.text, `${key}-${i}`)}
    {item.children.some(c => LIST.test(c)) ? list(item.children.filter(c => c.trim()), `${key}-${i}-sub`) : item.children.length > 0 && <> {inline(item.children.join(' ').trim(), `${key}-${i}-c`)}</>}
  </li>)}</Tag>;
}

export function Markdown({text}: {text: string}) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${i}`;
    if (!line.trim()) {i++; continue;}
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key} className="md-code"><code>{body.join('\n')}</code></pre>);
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {blocks.push(<p key={key} className="md-heading">{inline(heading[1], key)}</p>); i++; continue;}
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {blocks.push(<hr key={key} />); i++; continue;}
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(<div key={key} className="md-table"><table><thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${key}h${j}`)}</th>)}</tr></thead>
        <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, j) => <td key={j}>{inline(r[j] ?? '', `${key}r${ri}c${j}`)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={key}><Markdown text={quote.join('\n')} /></blockquote>);
      continue;
    }
    if (LIST.test(line)) {
      const first = LIST.exec(line)!;
      const ordered = /\d/.test(first[2]);
      // A top-level item of the other kind (bullet vs number) starts a new list.
      const sameList = (l: string) => {
        const m = LIST.exec(l);
        return m ? m[1].length > first[1].length || /\d/.test(m[2]) === ordered : /^\s{2,}\S/.test(l);
      };
      const items: string[] = [];
      while (i < lines.length && sameList(lines[i])) items.push(lines[i++]);
      blocks.push(list(items, key));
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && !/^\s*(#{1,6}\s|```|~~~|>)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push(<p key={key}>{para.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l, `${key}-${j}`)}</React.Fragment>)}</p>);
  }
  return <div className="markdown">{blocks}</div>;
}

/** First heading, used as a short card title. */
export function headingOf(text: string) {
  const m = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/m.exec(text);
  return m ? m[1].replace(/[*_`]/g, '').slice(0, 80) : null;
}
