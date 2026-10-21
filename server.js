const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const db = require('./db');
const seed = require('./seed');

const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const settingRoutes = require('./routes/settings');
const alertRoutes = require('./routes/alerts');
const guestRoutes = require('./routes/guests');
const locationRoutes = require('./routes/locations');
const serviceRoutes = require('./routes/services');
const customCookingRoutes = require('./routes/custom_cooking');
const migrateV2 = require('./migrate_v2');

const app = express();
const server = http.createServer(app);

// Setup Socket.io
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  }
});

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Attach Socket.io instance to request
app.use((req, res, next) => {
  req.io = io;
  next();
});

// API Routes
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/guests', guestRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/custom-cooking', customCookingRoutes);

// No-cache middleware so client browser always gets latest updates immediately
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Status Healthcheck API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Pines Exotica Unified Backend', time: new Date() });
});

// Static files path
const publicPath = path.join(__dirname, 'public');
const hasLocalPublic = fs.existsSync(publicPath);

const guestPath = hasLocalPublic ? publicPath : path.join(__dirname, '..', 'frontend-guest');
const adminPath = hasLocalPublic ? publicPath : path.join(__dirname, '..', 'frontend-admin');
const assetsPath = hasLocalPublic ? publicPath : path.join(__dirname, '..', 'pines-exotica-menu', 'pines-exotica-menu');

// Static assets
app.use(express.static(guestPath));
app.use('/photos', express.static(path.join(assetsPath, 'photos')));
app.use('/sketches', express.static(path.join(assetsPath, 'sketches')));
app.use('/fonts', express.static(path.join(assetsPath, 'fonts')));
app.use('/media', express.static(assetsPath));

// Clean URLs for Kitchen, Service & Admin tabs
const adminHtmlPath = path.join(adminPath, 'admin.html');
const guestHtmlPath = path.join(guestPath, 'index.html');
const kitchenHtmlPath = path.join(adminPath, 'kitchen.html');
const serviceHtmlPath = path.join(adminPath, 'service.html');

const adminRoutes = ['kitchen', 'service', 'orders', 'menu', 'guests', 'locations', 'services', 'custom-cooking', 'custom_cooking', 'folio', 'taxes', 'charges', 'qr'];
adminRoutes.forEach(r => {
  app.get(`/admin/${r}`, (req, res) => res.sendFile(adminHtmlPath));
});
app.get('/admin', (req, res) => res.sendFile(adminHtmlPath));
app.use('/admin', express.static(adminPath));

app.get('/guest', (req, res) => res.sendFile(guestHtmlPath));
app.use('/guest', express.static(guestPath));

// Convenient shortcuts
app.get('/', (req, res) => res.sendFile(guestHtmlPath));
app.get('/kitchen', (req, res) => {
  if (fs.existsSync(kitchenHtmlPath)) return res.sendFile(kitchenHtmlPath);
  res.redirect('/admin/kitchen');
});
app.get('/service', (req, res) => {
  if (fs.existsSync(serviceHtmlPath)) return res.sendFile(serviceHtmlPath);
  res.redirect('/admin/service');
});
app.get('/cms', (req, res) => res.redirect('/admin/menu'));

// Socket.io Real-Time Connection
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

const PORT = parseInt(process.env.PORT || '3000', 10);

// Initialize DB and start server
async function startServer() {
  try {
    console.log('[Server] Connecting to PostgreSQL database...');
    await db.initializeDatabase();
    
    // Seed database if empty
    const checkCount = await db.query('SELECT COUNT(*) FROM menu_items');
    if (parseInt(checkCount.rows[0].count, 10) === 0) {
      console.log('[Server] Database is empty. Running initial seed...');
      await seed();
    }
    
    // Auto-verify Phase 2 tables (guests, locations, extra_services, custom_cooking_items)
    await migrateV2();

    server.listen(PORT, '0.0.0.0', () => {
      console.log('===============================================================');
      console.log(`  🌲 PINES EXOTICA BACKEND RUNNING ON http://localhost:${PORT}`);
      console.log(`  📱 Guest Menu:    http://localhost:${PORT}/guest`);
      console.log(`  👨‍🍳 Kitchen KDS:   http://localhost:${PORT}/kitchen`);
      console.log(`  🛎️  Room Service:  http://localhost:${PORT}/service`);
      console.log(`  ⚙️  Admin Panel:   http://localhost:${PORT}/cms`);
      console.log('===============================================================');
    });
  } catch (err) {
    console.error('[Server Failed to Start]', err.message);
    console.log('\n[Tip] Make sure PostgreSQL password in .env is correct and PostgreSQL is running.');
  }
}

startServer();
