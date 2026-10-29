const fs = require('fs');
const { execSync } = require('child_process');

const orig = execSync('git show origin/main:public/admin.html', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
const curr = fs.readFileSync('public/admin.html', 'utf8');

const sIdx1 = orig.indexOf('<!-- OFFICIAL RESORT TAX INVOICE (PRINT-ONLY) -->');
const eIdx1 = orig.indexOf('<!-- /OFFICIAL RESORT TAX INVOICE -->', sIdx1);

const sIdx2 = curr.indexOf('<!-- OFFICIAL RESORT TAX INVOICE (PRINT-ONLY) -->');
const eIdx2 = curr.indexOf('<!-- /OFFICIAL RESORT TAX INVOICE -->', sIdx2);

console.log('Orig invoice length:', eIdx1 - sIdx1);
console.log('Curr invoice length:', eIdx2 - sIdx2);

if (orig.substring(sIdx1, eIdx1) !== curr.substring(sIdx2, eIdx2)) {
  console.log('DIFFERENCE FOUND in resort-print-invoice!');
  // Find where they differ
  const origBlock = orig.substring(sIdx1, eIdx1);
  const currBlock = curr.substring(sIdx2, eIdx2);
  console.log('Orig block length:', origBlock.length, 'Curr block length:', currBlock.length);
  // print diff
  const origLines = origBlock.split('\n');
  const currLines = currBlock.split('\n');
  origLines.forEach((l, i) => {
    if (l !== currLines[i]) {
      console.log('Line', i, 'diff:');
      console.log('  ORIG:', l);
      console.log('  CURR:', currLines[i]);
    }
  });
} else {
  console.log('resort-print-invoice HTML is 100% IDENTICAL!');
}
