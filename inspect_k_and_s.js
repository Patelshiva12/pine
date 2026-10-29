const fs = require('fs');

const files = ['public/admin.html', 'public/kitchen.html', 'public/service.html'];

files.forEach(f => {
  const full = 'D:/pine resort/pines-exotica-backend/pines-exotica-backend/' + f;
  const content = fs.readFileSync(full, 'utf8');
  console.log(f, 'has .wrap{:', content.includes('.wrap{'));
  console.log(f, 'has .tr{:', content.includes('.tr{'));
  console.log(f, 'has .orow{:', content.includes('.orow{'));
});
