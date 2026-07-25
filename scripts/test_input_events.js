const assert = require("assert");
const { isPrimaryButtonEvent } = require("../assets/input_events.js");

assert.strictEqual(isPrimaryButtonEvent({ button: 0 }), true);
assert.strictEqual(isPrimaryButtonEvent({ button: 1 }), false);
assert.strictEqual(isPrimaryButtonEvent({ button: 2 }), false);
assert.strictEqual(isPrimaryButtonEvent({ button: 3 }), false);
assert.strictEqual(isPrimaryButtonEvent({}), true);
