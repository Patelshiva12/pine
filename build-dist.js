'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Directories
const projectDir = __dirname; // D:\pine resort\pines-exotica-backend\pines-exotica-backend
const outerBackendDir = path.resolve(projectDir, '..'); // D:\pine resort\pines-exotica-backend
const rootResortDir = path.resolve(outerBackendDir, '..'); // D:\pine resort
const distDir = path.join(projectDir, 'dist');
const zipDestProject = path.join(projectDir, 'pines-exotica-production.zip');
const zipDestRoot = path.join(rootResortDir, 'pines-exotica-production.zip');

console.log('===============================================================');
console.log('  🌲 PINES EXOTICA - PRODUCTION BUILD & DIST GENERATOR');
console.log('===============================================================');

// 1. Clean dist directory
if (fs.existsSync(distDir)) {
  console.log('[1/6] Cleaning existing dist directory...');
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// 2. Files & Folders to bundle
const filesToCopy = [
  'server.js',
  'db.js',
  'package.json',
  'package-lock.json',
  'schema.sql',
  'seed.js',
  'migrate_v2.js',
  'migrate_v3.js',
  'migrate_v4_order_codes.js',
  'migrate_v5_room_tariff.js',
  'migrate_v6_guest_locations_and_referral.js',
  '.env.example'
];

const foldersToCopy = [
  'routes',
  'public'
];

// 3. Copy Backend Files
console.log('[2/6] Bundling Backend files & migrations into dist/...');
filesToCopy.forEach(file => {
  const src = path.join(projectDir, file);
  const dest = path.join(distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`  ✓ Copied file: ${file}`);
  } else if (file === '.env.example') {
    // Generate clean .env.example if missing
    const defaultEnv = 
`# Pines Exotica Production Environment Configuration
PORT=3000
NODE_ENV=production

# PostgreSQL Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=pine
`;
    fs.writeFileSync(dest, defaultEnv, 'utf8');
    console.log(`  ✓ Generated default .env.example`);
  }
});

// 4. Copy Folders (routes and public)
console.log('[3/6] Bundling Frontend (public/) & API Routes (routes/)...');
foldersToCopy.forEach(folder => {
  const src = path.join(projectDir, folder);
  const dest = path.join(distDir, folder);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`  ✓ Copied directory: ${folder}/`);
  }
});

// 5. Sync outer directories to avoid any confusion if someone accesses them
console.log('[4/6] Synchronizing parent outer folders to prevent version mismatch...');
try {
  // Sync outer public
  const outerPublic = path.join(outerBackendDir, 'public');
  if (fs.existsSync(outerPublic)) {
    fs.cpSync(path.join(projectDir, 'public'), outerPublic, { recursive: true });
    console.log(`  ✓ Synchronized outer public folder: ${outerPublic}`);
  }
  // Sync outer server.js & migrations
  ['server.js', 'migrate_v2.js', 'migrate_v3.js', 'migrate_v4_order_codes.js', 'migrate_v5_room_tariff.js'].forEach(f => {
    const src = path.join(projectDir, f);
    const dest = path.join(outerBackendDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  });
} catch (e) {
  console.warn('  ⚠️ Outer sync warning:', e.message);
}

// 6. Verify dist critical files
console.log('[5/6] Verifying dist/ contents...');
const criticalChecks = [
  path.join(distDir, 'server.js'),
  path.join(distDir, 'package.json'),
  path.join(distDir, 'public', 'admin.html'),
  path.join(distDir, 'public', 'index.html'),
  path.join(distDir, 'public', 'kitchen.html'),
  path.join(distDir, 'public', 'service.html'),
  path.join(distDir, 'public', 'api-store.js')
];

let allOk = true;
criticalChecks.forEach(p => {
  if (fs.existsSync(p)) {
    const stats = fs.statSync(p);
    console.log(`  ✓ Verified: ${path.relative(distDir, p)} (${(stats.size / 1024).toFixed(1)} KB)`);
  } else {
    console.error(`  ✗ MISSING: ${path.relative(distDir, p)}`);
    allOk = false;
  }
});

if (!allOk) {
  console.error('\n[Error] Build verification failed!');
  process.exit(1);
}

// 7. Create Zip Archive for 1-Click Upload
console.log('[6/6] Generating clean deployment zip (excluding node_modules)...');
try {
  // Use PowerShell Compress-Archive
  const psCmd = `powershell -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${zipDestProject}' -Force"`;
  execSync(psCmd, { stdio: 'inherit' });
  console.log(`  ✓ Created Zip in project: ${zipDestProject}`);

  // Copy to root resort folder as well
  fs.copyFileSync(zipDestProject, zipDestRoot);
  console.log(`  ✓ Copied Zip to main resort folder: ${zipDestRoot}`);
} catch (zipErr) {
  console.warn('  ⚠️ Automatic zip failed, but dist/ folder is completely ready:', zipErr.message);
}

console.log('\n===============================================================');
console.log('  🎉 BUILD COMPLETED SUCCESSFULLY!');
console.log('===============================================================');
console.log(`  📁 Clean Dist Folder:  ${distDir}`);
console.log(`  📦 Deployable Zip:     ${zipDestRoot}`);
console.log('\n  👉 HOW TO DEPLOY:');
console.log('  1. Upload "pines-exotica-production.zip" to your server.');
console.log('  2. Extract it into your web root / project folder.');
console.log('  3. In that folder run:');
console.log('     npm install --omit=dev');
console.log('     pm2 restart server.js   (or pm2 start server.js --name pines-resort)');
console.log('===============================================================\n');
