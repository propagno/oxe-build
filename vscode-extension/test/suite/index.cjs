'use strict';

const assert = require('node:assert/strict');
const vscode = require('vscode');

const EXTENSION_ID = 'oxe-cc.oxe-agents';
const EXPECTED_PARTICIPANTS = [
  'oxe.router',
  'oxe.ask',
  'oxe.scan',
  'oxe.spec',
  'oxe.plan',
  'oxe.quick',
  'oxe.execute',
  'oxe.debug',
  'oxe.verify',
  'oxe.review',
  'oxe.capabilities',
  'oxe.skill',
  'oxe.dashboard',
];

async function run() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} must be discovered by the Extension Host`);

  const participants = extension.packageJSON.contributes?.chatParticipants || [];
  assert.deepEqual(
    participants.map((participant) => participant.id),
    EXPECTED_PARTICIPANTS,
    'the manifest must register the canonical 13 OXE chat participants'
  );

  await extension.activate();
  assert.equal(extension.isActive, true, 'the OXE extension must activate in a real Extension Host');
  assert.equal(typeof extension.exports?.getRegisteredParticipantIds, 'function');
  assert.deepEqual(
    extension.exports.getRegisteredParticipantIds(),
    EXPECTED_PARTICIPANTS,
    'activation must observably register all 13 participants'
  );

  console.log(
    `Extension Host: activated ${EXTENSION_ID}; ${participants.length} participants discovered; ` +
    'registration verified through the extension public test contract'
  );
}

module.exports = { run };
