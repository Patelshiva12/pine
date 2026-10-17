'use strict';
// In-process event bus. Services publish domain events; realtime.js fans them out over WebSocket.
// Running more than one API instance? Replace publish/subscribe with Postgres LISTEN/NOTIFY or Redis
// pub/sub here — nothing else needs to change.
const { EventEmitter } = require('events');
const em = new EventEmitter();
em.setMaxListeners(100);

/** Event types: order.created, order.updated, alert.created, menu.updated, menu.deleted, settings.updated */
function publish(type, data) { setImmediate(() => em.emit('event', { type, data, at: Date.now() })); }
function subscribe(fn) { em.on('event', fn); return () => em.off('event', fn); }

module.exports = { publish, subscribe };
