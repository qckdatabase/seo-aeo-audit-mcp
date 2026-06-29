import assert from 'node:assert'
import { isDeniedCompetitor } from './competitor-denylist.js'

// horizontal giants blocked anywhere (incl. subdomains)
assert.equal(isDeniedCompetitor('amazon.com'), true)
assert.equal(isDeniedCompetitor('www.reddit.com'), true)
assert.equal(isDeniedCompetitor('en.wikipedia.org'), true)
assert.equal(isDeniedCompetitor('m.youtube.com'), true)
// platforms blocked at root only — keep customer subdomains
assert.equal(isDeniedCompetitor('shopify.com'), true)
assert.equal(isDeniedCompetitor('mystore.myshopify.com'), false)
assert.equal(isDeniedCompetitor('someone.medium.com'), false)
// a real competitor passes through
assert.equal(isDeniedCompetitor('fooddive.com'), false)

console.log('OK')
