// TEMPORARY diagnostic — Windows only. Not part of the product.
//
// The 23 Windows CI failures all carry `inventory-cache-parent-owner-only-failed`,
// i.e. assertWindowsParentOwnerOnly() returns false right after
// hardenWindowsDirectoryAcl() reports success. One hypothesis (icacls' listing
// interleaving SACL "Mandatory Label" lines with real DACL ACEs) was fixed in
// v0.44.0 and did NOT clear the failure, so the actual shape of icacls output on
// a GitHub-hosted Windows runner is still unknown.
//
// Guessing a second hypothesis from macOS would repeat the first mistake. This
// script prints the raw, unparsed facts from the runner itself so the next fix
// is grounded in observation. Delete once the real cause is fixed.

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const line = (s) => console.log(s);
const show = (label, r) => {
  line(`--- ${label}`);
  line(`    status : ${r.status}`);
  line(`    error  : ${r.error ? r.error.message : '(none)'}`);
  line(`    stdout :\n${(r.stdout || '').split(/\r?\n/).map((l) => `      | ${l}`).join('\n')}`);
  const err = (r.stderr || '').trim();
  if (err) line(`    stderr :\n${err.split(/\r?\n/).map((l) => `      ! ${l}`).join('\n')}`);
};

if (process.platform !== 'win32') {
  line('not win32 — nothing to diagnose');
  process.exit(0);
}

line('=== environment ===');
for (const k of ['USERDOMAIN', 'USERNAME', 'TEMP', 'TMP', 'USERPROFILE']) {
  line(`    ${k} = ${process.env[k] ?? '(unset)'}`);
}
const identity = `${process.env.USERDOMAIN ?? ''}\\${process.env.USERNAME ?? ''}`;
line(`    derived identity = ${identity}`);

const dir = mkdtempSync(join(tmpdir(), 'hopper-acl-diag-'));
line(`\n=== target dir ===\n    ${dir}`);

line('\n=== whoami (authoritative identity, vs the env-derived one above) ===');
show('whoami', spawnSync('whoami', [], { encoding: 'utf-8', windowsHide: true }));

line('\n=== icacls BEFORE hardening (what a fresh mkdtemp dir inherits) ===');
show('icacls <dir>', spawnSync('icacls', [dir], { encoding: 'utf-8', windowsHide: true }));

line('\n=== icacls on the TEMP root (where the inheritance comes from) ===');
show('icacls %TEMP%', spawnSync('icacls', [process.env.TEMP ?? tmpdir()], { encoding: 'utf-8', windowsHide: true }));

line('\n=== hardening command, exactly as cache.js issues it ===');
line(`    icacls "${dir}" /inheritance:r /grant:r "${identity}:(OI)(CI)(F)"`);
show('harden', spawnSync('icacls', [dir, '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)(F)`], {
  encoding: 'utf-8', windowsHide: true,
}));

line('\n=== icacls AFTER hardening — this is what the assertion parses ===');
const after = spawnSync('icacls', [dir], { encoding: 'utf-8', windowsHide: true });
show('icacls <dir>', after);

line('\n=== how the assertion sees it ===');
const aclLines = String(after.stdout || '')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => /:\([A-Z]/i.test(l))
  .filter((l) => !/^mandatory label\\/i.test(l));
line(`    surviving ACE lines: ${aclLines.length} (assertion requires exactly 1)`);
aclLines.forEach((l, i) => line(`      [${i}] ${JSON.stringify(l)}`));
const want = `${identity.toLowerCase()}:(oi)(ci)(f)`;
line(`    expected suffix: ${JSON.stringify(want)}`);
if (aclLines.length === 1) {
  line(`    endsWith match : ${aclLines[0].toLowerCase().endsWith(want)}`);
}
line(`\n    VERDICT: ${aclLines.length === 1 && aclLines[0].toLowerCase().endsWith(want) ? 'would PASS' : 'would FAIL'}`);
