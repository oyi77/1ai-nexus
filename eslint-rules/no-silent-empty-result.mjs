// ─────────────────────────────────────────────────────────────
// ESLint rule: no-silent-empty-result
//
// The defect class this prevents: a failure that returns an empty
// collection, so the caller cannot tell "the upstream failed" from "there
// is genuinely nothing here" — and the pipeline continues as if it worked.
//
// This is not theoretical in this repo. A rate-limited GMGN holder request
// returned an empty list, the scanner treated it as "no holders", and 8 of
// 10 tokens were dropped from every pass with nothing in the log. A missing
// Google credential made a sheet sync report "rewritten" while no write
// happened.
//
// The rule allows a swallowed error ONLY when the code makes the failure
// visible:
//   • it logs the error (console.error / logger.error / logger.warn), or
//   • it pushes to an `errors` array that the caller receives, or
//   • it rethrows.
//
// A catch that returns [] / null / undefined / {} / 0 / false with no
// evidence of the failure is reported.
//
// Options:
//   • allowEmptyArray: permit `return []` in a catch (default false)
//   * allowReturning: permit `return <value>` in a catch (default false)
// ─────────────────────────────────────────────────────────────

/** Calls that make a swallowed error visible to a human or to the caller. */
const EVIDENCE_CALLEES = new Set([
  'console.error',
  'console.warn',
  // A plain log is still a record of the failure — the level is a routing
  // choice, not a difference in whether the error was swallowed.
  'console.log',
  'console.info',
  'logger.error',
  'logger.warn',
  // debug-level still records the failure; the level is a routing choice,
  // not a difference in whether the error was swallowed.
  'logger.debug',
  'logger.info',
])

/** Receivers that make a swallowed error visible (the caller sees it). */
const EVIDENCE_MEMBERS = ['errors.push', 'failures.push', 'issues.push', 'problems.push']

function hasEvidence(node) {
  let found = false
  const stack = [node]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    if (current.type === 'CallExpression') {
      const callee = current.callee
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.property.type === 'Identifier' &&
        EVIDENCE_CALLEES.has(`${callee.object.name}.${callee.property.name}`)
      ) {
        found = true
        break
      }
    }
    if (current.type === 'CallExpression' && current.callee.type === 'MemberExpression') {
      const callee = current.callee
      if (
        callee.object.type === 'Identifier' &&
        callee.property.type === 'Identifier' &&
        EVIDENCE_MEMBERS.includes(`${callee.object.name}.${callee.property.name}`)
      ) {
        found = true
        break
      }
    }
    if (current.type === 'ThrowStatement') {
      found = true
      break
    }
    // Rejecting a promise makes the failure visible to the caller — that is
    // the opposite of swallowing it.
    if (
      current.type === 'CallExpression' &&
      current.callee.type === 'Identifier' &&
      current.callee.name === 'reject'
    ) {
      found = true
      break
    }
    for (const key of Object.keys(current)) {
      if (key === 'parent') continue
      const child = current[key]
      if (Array.isArray(child)) {
        for (const c of child) if (c && typeof c.type === 'string') stack.push(c)
      } else if (child && typeof child.type === 'string') {
        stack.push(child)
      }
    }
  }
  return found
}

function returnsEmptyValue(statement) {
  if (!statement || statement.type !== 'ReturnStatement') return false
  const arg = statement.argument
  if (!arg) return true // `return;`
  if (arg.type === 'ArrayExpression') return arg.elements.length === 0
  // An object literal with properties is a RESULT (even `{ data: null,
  // error: '...' }` is an explicit failure envelope), not an empty one.
  if (arg.type === 'ObjectExpression') return arg.properties.length === 0
  if (arg.type === 'Literal') {
    if (arg.value === null) return true
    if (arg.value === false) return true
    if (arg.value === 0) return true
    if (arg.value === '') return true
  }
  if (arg.type === 'Identifier' && arg.name === 'undefined') return true
  return false
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow catch blocks that swallow an error and return an empty result without making the failure visible.',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowEmptyArray: { type: 'boolean' },
          allowReturning: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      silentEmpty:
        'This catch swallows the error and returns an empty result, so the caller cannot distinguish "upstream failed" from "nothing to report". Log the error, push it to an errors array, or rethrow.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {}
    const allowEmptyArray = options.allowEmptyArray === true
    const allowReturning = options.allowReturning === true

    return {
      CatchClause(node) {
        if (node.param === null) return // `catch {}` — no error to swallow
        const body = node.body.body
        if (!Array.isArray(body) || body.length === 0) return

        const last = body[body.length - 1]
        if (!returnsEmptyValue(last)) return
        if (allowReturning) return
        if (allowEmptyArray && last.type === 'ReturnStatement' && last.argument?.type === 'ArrayExpression') {
          return
        }
        if (hasEvidence(node.body)) return

        context.report({ node: last, messageId: 'silentEmpty' })
      },
    }
  },
}

export default rule
