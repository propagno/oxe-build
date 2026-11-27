'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { makeJiraClient } = require('../../bin/lib/oxe-release-ops.cjs');

describe('v1.22.1 F1 A1 — OXB-221-01 (OB-25)', () => {
  it('A1: OXB-221-01 makeJiraClient resolves canonical alm.jira.site/project with options > alm.jira > alm > env precedence', () => {
    assert.equal(typeof makeJiraClient, 'function', 'makeJiraClient must be exported');

    const env = { JIRA_EMAIL: 'bot@example.com', JIRA_API_TOKEN: 'tok', JIRA_SITE: 'https://env.atlassian.net', JIRA_PROJECT: 'ENVP' };
    const canonicalCfg = {
      alm: {
        provider: 'jira',
        jira: { site: 'https://org.atlassian.net/', project: 'OB' },
      },
    };
    const c1 = makeJiraClient(canonicalCfg, { env });
    assert.equal(c1.configured, true);
    assert.equal(c1.site, 'https://org.atlassian.net');
    assert.equal(c1.project, 'OB');

    const legacyCfg = { alm: { provider: 'jira', site: 'https://legacy.atlassian.net', project: 'LEG' } };
    const c2 = makeJiraClient(legacyCfg, { env });
    assert.equal(c2.configured, true);
    assert.equal(c2.site, 'https://legacy.atlassian.net');
    assert.equal(c2.project, 'LEG');

    const c3 = makeJiraClient(canonicalCfg, { env, site: 'https://cli.atlassian.net/', project: 'CLI' });
    assert.equal(c3.site, 'https://cli.atlassian.net');
    assert.equal(c3.project, 'CLI');

    const c4 = makeJiraClient({}, { env });
    assert.equal(c4.configured, true);
    assert.equal(c4.site, 'https://env.atlassian.net');
    assert.equal(c4.project, 'ENVP');
  });
});
