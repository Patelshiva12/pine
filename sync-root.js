'use strict';
const fs = require('fs');
const path = require('path');

const srcFile = path.join(__dirname, 'public', 'index.html');
const src = fs.readFileSync(srcFile, 'utf8');

function writeWithStart(destPath, start) {
  const inject = '<script>window.PE_API={base:"http://localhost:8080/api/v1",ws:"ws://localhost:8080/ws"};' + (start ? 'window.__START_ROUTE="' + start + '";' : '') + '</script>';
  const content = src.replace('<head>', '<head>' + inject);
  fs.writeFileSync(destPath, content, 'utf8');
  console.log('Synced:', destPath);
}

const rootDir = path.resolve(__dirname, '..', '..');
writeWithStart(path.join(rootDir, '4-Admin.html'), 'admin');
writeWithStart(path.join(rootDir, '1-Guest-Menu.html'), null);
writeWithStart(path.join(rootDir, 'Pines-Exotica-Menu.html'), null);
writeWithStart(path.join(rootDir, '2-Kitchen.html'), 'kitchen');
writeWithStart(path.join(rootDir, '3-Room-Service.html'), 'service');
console.log('All root HTML files updated successfully!');
