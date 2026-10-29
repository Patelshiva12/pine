const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('D:/pine resort/pines-exotica-backend/pines-exotica-backend/node_modules/ws');

const port = 9352;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=' + port,
  '--user-data-dir=C:/Users/patel/AppData/Local/Temp/cprof_' + port,
  '--window-size=1280,900',
  'file:///D:/pine resort/1-Guest-Menu.html'
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
      });

      ws.on('open', async () => {
        try {
          await call('Runtime.enable');
          await new Promise(r => setTimeout(r, 2000));

          const res = await call('Runtime.evaluate', {
            expression: `
              (() => {
                return {
                  hasApiStore: typeof makeBackendStore !== 'undefined',
                  scripts: Array.from(document.scripts).map(s => s.src)
                };
              })()
            `,
            returnByValue: true
          });
          console.log('File test result:', res.result.value);

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
