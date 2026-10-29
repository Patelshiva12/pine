const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('D:/pine resort/pines-exotica-backend/pines-exotica-backend/node_modules/ws');

const port = 9357;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=' + port,
  '--user-data-dir=C:/Users/patel/AppData/Local/Temp/cprof_' + port,
  '--window-size=1280,900',
  'http://localhost:3000/guest#room-202'
]);

setTimeout(() => {
  http.get('http://127.0.0.1:' + port + '/json', res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', async () => {
      const targets = JSON.parse(d);
      const page = targets.find(t => t.type === 'page');
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      let reqId = 1;
      function call(method, params = {}) {
        return new Promise(r => {
          const id = reqId++;
          function onMsg(m) {
            const p = JSON.parse(m);
            if (p.id === id) { ws.off('message', onMsg); r(p.result); }
          }
          ws.on('message', onMsg);
          ws.send(JSON.stringify({ id, method, params }));
        });
      }

      ws.on('message', m => {
        const p = JSON.parse(m);
        if (p.method === 'Runtime.consoleAPICalled') {
          console.log('[BROWSER CONSOLE]', p.params.type, p.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' '));
        }
        if (p.method === 'Network.responseReceived') {
          console.log('[NETWORK RESPONSE]', p.params.response.status, p.params.response.url);
        }
      });

      ws.on('open', async () => {
        try {
          await call('Runtime.enable');
          await call('Network.enable');
          await new Promise(r => setTimeout(r, 2000));

          const res = await call('Runtime.evaluate', {
            expression: `
              (async () => {
                try {
                  // 1. Flip next to page 1
                  const openBtn = document.querySelector('[data-act="flip-next"]');
                  if (openBtn) openBtn.click();
                  await new Promise(r => setTimeout(r, 1000));

                  // 2. Add dish
                  const addBtn = document.querySelector('[data-act="q-add"]');
                  console.log('Add button found:', addBtn ? 'yes' : 'no');
                  if (addBtn) addBtn.click();
                  await new Promise(r => setTimeout(r, 600));

                  // 3. Open cart
                  const orderBtn = document.querySelector('.g-order button');
                  console.log('Order bar button found:', orderBtn ? 'yes' : 'no');
                  if (orderBtn) orderBtn.click();
                  await new Promise(r => setTimeout(r, 600));

                  // 4. Fill guest details
                  const nameIn = document.getElementById('c-name') || document.querySelector('[data-input="guestName"]');
                  if (nameIn) {
                    nameIn.value = 'Aman sinha';
                    nameIn.dispatchEvent(new Event('input', { bubbles: true }));
                  }
                  const phoneIn = document.getElementById('c-phone') || document.querySelector('[data-input="guestPhone"]');
                  if (phoneIn) {
                    phoneIn.value = '8547693211';
                    phoneIn.dispatchEvent(new Event('input', { bubbles: true }));
                  }

                  // 5. Click cart confirm or place
                  const placeBtn = document.querySelector('[data-act="cart-confirm-order"]') || document.querySelector('[data-act="place"]');
                  console.log('Cart checkout button:', placeBtn ? placeBtn.innerText : 'none');
                  if (placeBtn) placeBtn.click();
                  await new Promise(r => setTimeout(r, 600));

                  // 6. Click Continue & Place Order
                  const confirmBtn = document.querySelector('[data-act="confirm-place-order"]');
                  console.log('Confirm place button:', confirmBtn ? confirmBtn.innerText : 'none');
                  if (confirmBtn) {
                    confirmBtn.click();
                    await new Promise(r => setTimeout(r, 2000));
                  }

                  const toast = document.querySelector('.toast');
                  const doneBox = document.querySelector('.done-box');
                  return {
                    toast: toast ? toast.innerText : null,
                    done: doneBox ? doneBox.innerText : null
                  };
                } catch(e) {
                  return { error: e.message, stack: e.stack };
                }
              })()
            `,
            awaitPromise: true,
            returnByValue: true
          });
          console.log('FINAL RESULT:', res.result.value);

        } catch (e) {
          console.error(e);
        } finally {
          ws.close();
          chrome.kill();
          process.exit(0);
        }
      });
    });
  }).on('error', err => {
    console.error(err);
    chrome.kill();
    process.exit(1);
  });
}, 2000);
