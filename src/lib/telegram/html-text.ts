/**
 * Split Telegram HTML text into messages of at most `limit` UTF-16 code units
 * (Telegram's sendMessage cap is 4096). Never cuts inside a tag, an entity, or a
 * surrogate pair; formatting open at a boundary is closed at the end of one
 * chunk and reopened at the start of the next, so each chunk parses alone.
 * Only b, i, u, s, code, pre and a(href) are markup; everything else is literal.
 */

const LIMIT = 4096;
const TAG_RE = /<(\/?)(b|i|u|s|code|pre|a)(\s[^<>]*)?>/y;
const ENTITY_RE = /&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#x[0-9a-fA-F]{1,6});/y;

type Atom = { raw: string; tag: boolean };
type Frame = { open: string; close: string };

/** Tags, entities and single code points; every atom is an allowed break edge. */
function tokenize(text: string): Atom[] {
  const atoms: Atom[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '<') {
      TAG_RE.lastIndex = i;
      const m = TAG_RE.exec(text);
      if (m) {
        atoms.push({ raw: m[0], tag: true });
        i += m[0].length;
        continue;
      }
    }
    if (text[i] === '&') {
      ENTITY_RE.lastIndex = i;
      const m = ENTITY_RE.exec(text);
      if (m) {
        atoms.push({ raw: m[0], tag: false });
        i += m[0].length;
        continue;
      }
    }
    const cp = text.codePointAt(i);
    if (cp === undefined) break;
    atoms.push({ raw: String.fromCodePoint(cp), tag: false });
    i += cp > 0xffff ? 2 : 1;
  }
  return atoms;
}

function closeAll(stack: Frame[]): string {
  let out = '';
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i].close;
  return out;
}

function openAll(stack: Frame[]): string {
  let out = '';
  for (const frame of stack) out += frame.open;
  return out;
}

function closeFor(open: string): string {
  const m = /^<([a-z]+)/.exec(open);
  return m ? `</${m[1]}>` : '';
}

export function splitTelegramHtml(text: string, limit: number = LIMIT): string[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`splitTelegramHtml: limit must be a positive integer, got ${limit}`);
  }
  if (!text) return [''];
  if (text.length <= limit) return [text];

  const atoms = tokenize(text);
  const chunks: string[] = [];
  let stack: Frame[] = [];
  let start = 0;

  while (start < atoms.length) {
    const prefixStack = stack;
    const prefix = openAll(prefixStack);
    let used = prefix.length;
    let walk = prefixStack.slice();
    let end = start;
    let endStack = walk;
    let newlineEnd = -1;
    let newlineStack: Frame[] = [];

    for (let i = start; i < atoms.length; i++) {
      const atom = atoms[i];
      used += atom.raw.length;
      if (atom.tag) {
        if (atom.raw[1] === '/') walk.pop();
        else walk.push({ open: atom.raw, close: closeFor(atom.raw) });
      }
      if (used + closeAll(walk).length > limit) break;
      end = i + 1;
      endStack = walk.slice();
      if (atom.raw === '\n') {
        newlineEnd = end;
        newlineStack = walk.slice();
      }
    }
    if (end === start) {
      throw new RangeError('splitTelegramHtml: markup overhead leaves no room for content at this limit');
    }

    const stop = newlineEnd > 0 ? newlineEnd : end;
    const stopStack = newlineEnd > 0 ? newlineStack : endStack;
    let body = '';
    for (let i = start; i < stop; i++) body += atoms[i].raw;
    chunks.push(prefix + body + closeAll(stopStack));
    stack = stopStack;
    start = stop;
  }

  return chunks;
}
