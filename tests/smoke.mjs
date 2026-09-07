import assert from 'node:assert/strict';
import { cleanCode } from '../js/network.js';
import { LEVEL, PLAYER_COLORS } from '../js/levels.js';

assert.equal(cleanCode(' ab-cd e! '), 'ABCDE');
assert.equal(cleanCode('abc10z'), 'ABCZ');
assert.ok(LEVEL.platforms.length >= 5, 'level should contain multiple platforms');
assert.ok(PLAYER_COLORS.length >= 4, 'multiplayer should have several distinct player colors');
assert.ok(LEVEL.exit.x > LEVEL.spawn.x, 'exit should be positioned after spawn');

console.log('Smoke tests passed.');
