/**
 * Pines Exotica - Live Backend Store Adapter (v2 Expanded)
 * Connects Frontend directly to Node.js + Express REST APIs & Socket.io
 * Supports: Menu, Orders, Alerts, Settings, Locations (Villas/Rooms/Tables), Services (Spa/BBQ), Guests
 */
function makeBackendStore() {
  const isHttp = location.protocol.startsWith('http');
  const API_BASE = window.API_BASE_URL || (isHttp ? '' : 'http://localhost:3000');
  const socket = (typeof io !== 'undefined') ? (API_BASE ? io(API_BASE) : io()) : null;

  const collections = {
    menu: [],
    orders: [],
    alerts: [],
    locations: [],
    services: [],
    guests: [],
    customCooking: [],
    cookingSlabs: [],
    referralSources: [],
    geoStates: [],
    geoCities: [],
    settings: { billing: null }
  };

  const listeners = {
    menu: new Set(),
    orders: new Set(),
    alerts: new Set(),
    locations: new Set(),
    services: new Set(),
    guests: new Set(),
    customCooking: new Set(),
    cookingSlabs: new Set(),
    referralSources: new Set(),
    geoStates: new Set(),
    geoCities: new Set(),
    settings: new Set()
  };

  function notify(collName) {
    if (listeners[collName]) {
      listeners[collName].forEach(cb => {
        try { cb(collections[collName]); } catch (e) { console.error(e); }
      });
    }
  }

  async function fetchCollection(name) {
    try {
      if (name === 'menu') {
        const res = await fetch(`${API_BASE}/api/menu`);
        if (res.ok) { collections.menu = await res.json(); notify('menu'); }
      } else if (name === 'orders') {
        const res = await fetch(`${API_BASE}/api/orders`);
        if (res.ok) { collections.orders = await res.json(); notify('orders'); }
      } else if (name === 'alerts') {
        const res = await fetch(`${API_BASE}/api/alerts`);
        if (res.ok) { collections.alerts = await res.json(); notify('alerts'); }
      } else if (name === 'locations') {
        const res = await fetch(`${API_BASE}/api/locations`);
        if (res.ok) { collections.locations = await res.json(); notify('locations'); }
      } else if (name === 'services') {
        const res = await fetch(`${API_BASE}/api/services`);
        if (res.ok) { collections.services = await res.json(); notify('services'); }
      } else if (name === 'guests') {
        const res = await fetch(`${API_BASE}/api/guests`);
        if (res.ok) { collections.guests = await res.json(); notify('guests'); }
      } else if (name === 'customCooking' || name === 'custom_cooking') {
        const res = await fetch(`${API_BASE}/api/custom-cooking`);
        if (res.ok) { collections.customCooking = await res.json(); notify('customCooking'); }
      } else if (name === 'cookingSlabs' || name === 'slabs') {
        const res = await fetch(`${API_BASE}/api/custom-cooking/slabs`);
        if (res.ok) { collections.cookingSlabs = await res.json(); notify('cookingSlabs'); }
      } else if (name === 'referralSources' || name === 'referrals') {
        const res = await fetch(`${API_BASE}/api/referral-sources?all=true`);
        if (res.ok) { collections.referralSources = await res.json(); notify('referralSources'); }
      } else if (name === 'geoStates' || name === 'states') {
        const res = await fetch(`${API_BASE}/api/geo/states`);
        if (res.ok) { collections.geoStates = await res.json(); notify('geoStates'); }
      } else if (name === 'geoCities' || name === 'cities') {
        const res = await fetch(`${API_BASE}/api/geo/cities`);
        if (res.ok) { collections.geoCities = await res.json(); notify('geoCities'); }
      }
    } catch (err) {
      console.warn(`[BackendStore] Error fetching ${name}:`, err);
    }
  }

  async function fetchSettings() {
    try {
      const res = await fetch(`${API_BASE}/api/settings`);
      if (res.ok) {
        collections.settings.billing = await res.json();
        if (listeners.settings) {
          listeners.settings.forEach(cb => {
            try { cb(collections.settings.billing); } catch (e) {}
          });
        }
      }
    } catch (err) {
      console.warn('[BackendStore] Error fetching settings:', err);
    }
  }

  if (socket) {
    socket.on('connect', () => {
      console.log('✅ [BackendStore] Connected to live backend via Socket.io:', API_BASE || 'origin');
    });

    socket.on('orders:created', (newOrder) => {
      const idx = collections.orders.findIndex(o => o.id === newOrder.id);
      if (idx !== -1) collections.orders[idx] = newOrder;
      else collections.orders.unshift(newOrder);
      notify('orders');
      if (typeof chime === 'function') {
        try { chime('new'); } catch(e) {}
      }
    });

    socket.on('orders:updated', (updatedOrder) => {
      const idx = collections.orders.findIndex(o => o.id === updatedOrder.id);
      if (idx !== -1) collections.orders[idx] = updatedOrder;
      else collections.orders.unshift(updatedOrder);
      notify('orders');
    });

    socket.on('menu:updated', (event) => {
      if (event.action === 'deleted') {
        collections.menu = collections.menu.filter(m => m.id !== event.id);
      } else if (event.item) {
        const idx = collections.menu.findIndex(m => m.id === event.item.id);
        if (idx !== -1) collections.menu[idx] = event.item;
        else collections.menu.push(event.item);
      }
      notify('menu');
    });

    socket.on('locations:updated', () => {
      fetchCollection('locations');
    });

    socket.on('services:updated', () => {
      fetchCollection('services');
    });

    socket.on('guests:updated', () => {
      fetchCollection('guests');
    });

    socket.on('custom_cooking:updated', () => {
      fetchCollection('customCooking');
    });

    socket.on('custom_cooking:slabs_updated', () => {
      fetchCollection('cookingSlabs');
    });

    socket.on('referrals:updated', () => {
      fetchCollection('referralSources');
    });

    socket.on('alerts:created', (alert) => {
      collections.alerts.unshift(alert);
      notify('alerts');
    });

    socket.on('settings:updated', (newSettings) => {
      collections.settings.billing = newSettings;
      if (listeners.settings) {
        listeners.settings.forEach(cb => {
          try { cb(newSettings); } catch (e) {}
        });
      }
    });
  }

  return {
    mode: 'live',
    writable: true,
    apiBase: API_BASE,

    watchColl(name, opts, cb) {
      if (!listeners[name]) listeners[name] = new Set();
      listeners[name].add(cb);

      fetchCollection(name);

      if (collections[name] && collections[name].length > 0) {
        let arr = collections[name].slice();
        if (opts && opts.order) {
          const [f, d] = opts.order;
          arr.sort((a, b) => (a[f] > b[f] ? 1 : -1) * (d === 'desc' ? -1 : 1));
        }
        if (opts && opts.limit) arr = arr.slice(0, opts.limit);
        cb(arr);
      }

      return () => {
        listeners[name].delete(cb);
      };
    },

    watchDoc(path, cb) {
      if (path === 'settings/billing' || path.startsWith('settings')) {
        listeners.settings.add(cb);
        fetchSettings();
        if (collections.settings.billing) cb(collections.settings.billing);
        return () => {
          listeners.settings.delete(cb);
        };
      }
      return () => {};
    },

    async set(path, v) {
      const [col, id] = path.split('/');
      if (col === 'orders') {
        const res = await fetch(`${API_BASE}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...v, id })
        });
        if (!res.ok) throw new Error('Failed to create order');
        return await res.json();
      } else if (col === 'menu') {
        const res = await fetch(`${API_BASE}/api/menu`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...v, id })
        });
        if (!res.ok) throw new Error('Failed to create menu item');
        return await res.json();
      } else if (col === 'locations') {
        const res = await fetch(`${API_BASE}/api/locations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to create location');
        return await res.json();
      } else if (col === 'services') {
        const res = await fetch(`${API_BASE}/api/services`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...v, id })
        });
        if (!res.ok) throw new Error('Failed to create service');
        return await res.json();
      } else if (col === 'guests') {
        const res = await fetch(`${API_BASE}/api/guests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...v, id })
        });
        if (!res.ok) throw new Error('Failed to add guest');
        return await res.json();
      } else if (col === 'customCooking' || col === 'custom_cooking') {
        const res = await fetch(`${API_BASE}/api/custom-cooking`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to add custom cooking item');
        return await res.json();
      } else if (col === 'cookingSlabs' || col === 'slabs') {
        const res = await fetch(`${API_BASE}/api/custom-cooking/slabs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to add cooking slab');
        return await res.json();
      } else if (col === 'referralSources' || col === 'referrals') {
        const res = await fetch(`${API_BASE}/api/referral-sources`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to add referral source');
        return await res.json();
      } else if (col === 'geoCities' || col === 'cities') {
        const res = await fetch(`${API_BASE}/api/geo/cities`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to add city');
        return await res.json();
      } else if (col === 'settings') {
        const res = await fetch(`${API_BASE}/api/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to update settings');
        return await res.json();
      } else if (col === 'alerts') {
        const res = await fetch(`${API_BASE}/api/alerts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...v, id })
        });
        if (!res.ok) throw new Error('Failed to save alert');
        return await res.json();
      }
    },

    async update(path, v) {
      const [col, id] = path.split('/');
      if (col === 'orders') {
        const res = await fetch(`${API_BASE}/api/orders/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to update order');
        return await res.json();
      } else if (col === 'menu') {
        const res = await fetch(`${API_BASE}/api/menu/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to update menu item');
        return await res.json();
      } else if (col === 'locations') {
        const res = await fetch(`${API_BASE}/api/locations/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to update location');
        return await res.json();
      } else if (col === 'services') {
        const res = await fetch(`${API_BASE}/api/services/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to update service');
        return await res.json();
      } else if (col === 'guests') {
        const res = await fetch(`${API_BASE}/api/guests/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to update guest');
        return await res.json();
      } else if (col === 'customCooking' || col === 'custom_cooking') {
        const res = await fetch(`${API_BASE}/api/custom-cooking/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to update custom cooking item');
        return await res.json();
      } else if (col === 'cookingSlabs' || col === 'slabs') {
        const res = await fetch(`${API_BASE}/api/custom-cooking/slabs/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to update cooking slab');
        return await res.json();
      } else if (col === 'referralSources' || col === 'referrals') {
        const res = await fetch(`${API_BASE}/api/referral-sources/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to update referral source');
        return await res.json();
      } else if (col === 'settings') {
        const res = await fetch(`${API_BASE}/api/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v)
        });
        if (!res.ok) throw new Error('Failed to update settings');
        return await res.json();
      }
    },

    async del(path) {
      const [col, id] = path.split('/');
      let endpoint = '';
      if (col === 'menu') endpoint = `${API_BASE}/api/menu/${id}`;
      else if (col === 'locations') endpoint = `${API_BASE}/api/locations/${id}`;
      else if (col === 'services') endpoint = `${API_BASE}/api/services/${id}`;
      else if (col === 'guests') endpoint = `${API_BASE}/api/guests/${id}`;
      else if (col === 'customCooking' || col === 'custom_cooking') endpoint = `${API_BASE}/api/custom-cooking/${id}`;
      else if (col === 'cookingSlabs' || col === 'slabs') endpoint = `${API_BASE}/api/custom-cooking/slabs/${id}`;
      else if (col === 'referralSources' || col === 'referrals') endpoint = `${API_BASE}/api/referral-sources/${id}`;

      if (endpoint) {
        const res = await fetch(endpoint, { method: 'DELETE' });
        if (!res.ok) throw new Error(`Failed to delete ${col} item`);
        return await res.json();
      }
    },

    async lookupPincode(pincode) {
      const res = await fetch(`${API_BASE}/api/geo/pincode/${pincode}`);
      if (!res.ok) throw new Error('Pincode lookup failed');
      return await res.json();
    }
  };
}
