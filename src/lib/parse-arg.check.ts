import assert from 'node:assert'
import { parseArg } from './parse-arg.js'

const obj = { pages: [1, 2], nested: { a: 1 } }
// already an object -> returned unchanged (same reference)
assert.equal(parseArg(obj), obj)
// JSON string -> parsed to a deep-equal object (this is the MCP failure mode)
assert.deepEqual(parseArg<typeof obj>(JSON.stringify(obj)), obj)
// undefined (optional arg) -> stays undefined
assert.equal(parseArg(undefined), undefined)

console.log('OK')
