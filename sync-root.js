'use strict';
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
const rootDir = path.resolve(__dirname, '..', '..');

function syncFile(srcFileName, destFileName, startRoute) {
  const srcPath = path.join(publicDir, srcFileName);
  let content = fs.readFileSync(srcPath, 'utf8');
  const inject = '<script>window.PE_API={base:"http://localhost:3000/api/v1",ws:"ws://localhost:3000/ws"};' + (startRoute ? 'window.__START_ROUTE="' + startRoute + '";' : '') + '</script>';
  content = content.replace('<head>', '<head>' + inject);
  const destPath = path.join(rootDir, destFileName);
  fs.writeFileSync(destPath, content, 'utf8');
  console.log('Synced:', destPath, '<-', srcFileName);
}

syncFile('admin.html', '4-Admin.html', 'admin');
syncFile('kitchen.html', '2-Kitchen.html', 'kitchen');
syncFile('service.html', '3-Room-Service.html', 'service');
syncFile('index.html', '1-Guest-Menu.html', null);
syncFile('index.html', 'Pines-Exotica-Menu.html', null);

// Copy helper scripts to root
fs.copyFileSync(path.join(publicDir, 'api-store.js'), path.join(rootDir, 'api-store.js'));
fs.copyFileSync(path.join(publicDir, 'qrcode.min.js'), path.join(rootDir, 'qrcode.min.js'));
console.log('Synced api-store.js and qrcode.min.js to root directory');

console.log('All root HTML files updated successfully!');
