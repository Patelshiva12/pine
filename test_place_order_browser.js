const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('D:/pine resort/pines-exotica-backend/pines-exotica-backend/node_modules/ws');

const port = 9351;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=' + port,
  '--user-data-dir=C:/Users/patel/AppData/Local/Temp/cprof_' + port,
  '--window-size=1280,900',
  'http://localhost:3000/guest'
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
                // 1. Click on add to cart button of first dish
                const addBtn = document.querySelector('[data-act="q-add"]');
                if (!addBtn) return { error: 'No add button found' };
                addBtn.click();
                await new Promise(r => setTimeout(r, 500));

                // 2. Open cart
                const cartBar = document.querySelector('.g-order button');
                if (cartBar) cartBar.click();
                await new Promise(r => setTimeout(r, 500));

                // 3. Fill name and phone if inputs exist
                const nameInput = document.getElementById('c-name') || document.querySelector('[data-input="guestName"]');
                if (nameInput) {
                  nameInput.value = 'Aman sinha';
                  nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
                const phoneInput = document.getElementById('c-phone') || document.querySelector('[data-input="guestPhone"]');
                if (phoneInput) {
                  phoneInput.value = '8547693211';
                  phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
                }

                // 4. Click Review or Place Order button in cart
                const placeBtn = document.querySelector('[data-act="cart-confirm-order"]') || document.querySelector('[data-act="place"]');
                console.log('Cart button found:', placeBtn ? placeBtn.outerHTML : 'none');
                if (placeBtn) placeBtn.click();
                await new Promise(r => setTimeout(r, 500));

                // 5. If confirmation sheet opened, click confirm-place-order
                const confirmBtn = document.querySelector('[data-act="confirm-place-order"]');
                console.log('Confirm button found:', confirmBtn ? confirmBtn.outerHTML : 'none');
                if (confirmBtn) {
                  confirmBtn.click();
                  await new Promise(r => setTimeout(r, 1500));
                }

                // Check active toast or result
                const toastEl = document.querySelector('.toast');
                return {
                  toastText: toastEl ? toastEl.innerText : 'no toast',
                  modalHTML: document.querySelector('.sheet') ? document.querySelector('.sheet').innerText.substring(0, 300) : 'none'
                };
              })()
            `,
            awaitPromise: true,
            returnByValue: true
          });
          console.log('Test result:', res.result.value);

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
