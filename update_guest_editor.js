const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'public', 'admin.html');
let html = fs.readFileSync(targetFile, 'utf8');
console.log('[Update Guest Editor] Original file length:', html.length);

// 1. Replace guestEditor() function
const geStart = 'function guestEditor(){';
const geEnd = 'function rateEditor(';

const sIdx = html.indexOf(geStart);
const eIdx = html.indexOf(geEnd);

if (sIdx === -1 || eIdx === -1) {
  console.error('ERROR: Could not locate guestEditor() in admin.html');
  process.exit(1);
}

const newGuestEditor = `function guestEditor(){
  const g = S.guestDraft;
  const locType = g.assignedLocationType || 'room';
  const locationsOfType = (S.locations || []).filter(l => l.type === locType && l.isActive !== false);

  const nowTs = Date.now();
  const inDateVal = g.checkInDate 
    ? (typeof g.checkInDate === 'number' || !isNaN(Number(g.checkInDate)) ? new Date(Number(g.checkInDate)).toISOString().split('T')[0] : g.checkInDate)
    : new Date(nowTs).toISOString().split('T')[0];

  const expDateVal = g.expectedCheckOutDate 
    ? (typeof g.expectedCheckOutDate === 'number' || !isNaN(Number(g.expectedCheckOutDate)) ? new Date(Number(g.expectedCheckOutDate)).toISOString().split('T')[0] : g.expectedCheckOutDate)
    : '';

  const selectedLocs = String(g.assignedLocationNumber || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  const refSources = (S.referralSources && S.referralSources.length) 
    ? S.referralSources.map(s => s.name)
    : ['Aman (Staff)', 'Direct Walk-in', 'MakeMyTrip', 'Agoda', 'Booking.com', 'Resort Website / Direct Call', 'Instagram / Social Media', 'Corporate / Travel Agent'];

  const statesList = (S.geoStates && S.geoStates.length)
    ? S.geoStates.map(s => s.state_name || s.name)
    : ['Himachal Pradesh', 'Delhi', 'Punjab', 'Haryana', 'Chandigarh', 'Maharashtra', 'Karnataka', 'Gujarat', 'Uttar Pradesh', 'Rajasthan', 'Uttarakhand'];

  return \`<div class="overlay" data-act="overlay-close-guest"><div class="sheet" role="dialog" aria-modal="true" aria-label="Guest Check-in" style="max-width:700px">
    <div class="sheet-head">
      <h3>\${g._new ? 'Guest Registration &amp; Check-in' : 'Edit Guest Details'}</h3>
      <button class="icon-btn" data-act="guest-close" aria-label="Close">✕</button>
    </div>
    <div class="sheet-body" style="gap:18px">
      
      <!-- 1. Primary Guest Details -->
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--pine);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line);padding-bottom:4px;margin-bottom:10px">
          1. Primary Identity &amp; Government Proof
        </div>
        <div class="field"><label for="g-name">Guest Full Name *</label><input class="input" id="g-name" data-input="g.name" value="\${esc(g.name || '')}" placeholder="e.g. Amit Sharma"></div>
        <div class="form-grid" style="margin-top:8px">
          <div class="field"><label for="g-phone">Phone Number (10 Digits) *</label><input class="input" id="g-phone" type="tel" maxlength="15" data-input="g.phone" value="\${esc(g.phone || '')}" placeholder="e.g. 9816012345"></div>
          <div class="field"><label for="g-aadhaar">Aadhaar Card Number (12 Digits) *</label><input class="input mono" id="g-aadhaar" maxlength="14" data-input="g.aadhaar" value="\${esc(g.aadhaarNumber || '')}" placeholder="1234 5678 9012"></div>
        </div>
      </div>

      <!-- 2. Stay, Rooms & Occupancy (with Room Multi-select & Check-in Date) -->
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--pine);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line);padding-bottom:4px;margin-bottom:10px">
          2. Stay, Rooms &amp; Occupancy Details
        </div>
        
        <div class="field">
          <label>Location Type *</label>
          <div class="seg" style="width:100%">
            <button data-act="g-loctype" data-v="villa" aria-pressed="\${locType === 'villa'}">🏡 Villa</button>
            <button data-act="g-loctype" data-v="room" aria-pressed="\${locType === 'room'}">🛏️ Room</button>
            <button data-act="g-loctype" data-v="table" aria-pressed="\${locType === 'table'}">🍽️ Table</button>
          </div>
        </div>

        <div class="field" style="margin-top:10px">
          <label style="display:flex;justify-content:space-between;align-items:center;">
            <span>Assigned \${locType === 'room' ? 'Room(s)' : (locType === 'villa' ? 'Villa(s)' : 'Table(s)')} * <small style="color:var(--muted);font-weight:400;">(Click to Select / Multi-Select)</small></span>
            <span style="font-size:12px;color:var(--pine);font-weight:700;">Selected: \${selectedLocs.length ? selectedLocs.join(', ') : 'None'} (\${selectedLocs.length})</span>
          </label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;padding:10px;background:#F8FAFC;border:1.5px solid var(--line);border-radius:8px;max-height:145px;overflow-y:auto;">
            \${locationsOfType.length ? locationsOfType.map(l => {
              const isSelected = selectedLocs.includes(String(l.number).toUpperCase());
              return \`<button type="button" class="btn sm" data-act="toggle-loc-select" data-num="\${esc(l.number)}" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:7px;border:1.5px solid \${isSelected ? '#17362A' : '#CBD5E1'};background:\${isSelected ? '#17362A' : '#FFFFFF'};color:\${isSelected ? '#FFFFFF' : '#1E293B'};font-weight:700;font-size:12.5px;cursor:pointer;transition:all 0.15s ease;">
                <span>\${isSelected ? '✓' : (locType === 'villa' ? '🏡' : (locType === 'room' ? '🛏️' : '🍽️'))}</span>
                <span>\${esc(l.number)}</span>
                <small style="opacity:0.8;font-size:11px;font-weight:400;">(\${esc(l.name)}\${l.parentVilla ? \` &bull; \${esc(l.parentVilla)}\` : ''})</small>
              </button>\`;
            }).join('') : \`<span class="muted" style="font-size:12px;">No active \${locType}s found.</span>\`}
          </div>
        </div>

        <div class="form-grid" style="margin-top:10px">
          <div class="field">
            <label for="g-checkin-date">Check-in Date *</label>
            <input class="input" id="g-checkin-date" type="date" data-input="g.checkin" value="\${inDateVal}">
          </div>
          <div class="field">
            <label for="g-checkout-exp">Expected Check-out Date</label>
            <input class="input" id="g-checkout-exp" type="date" data-input="g.expcheckout" value="\${expDateVal}">
          </div>
        </div>

        <div class="form-grid" style="margin-top:8px">
          <div class="field"><label for="g-rooms">Number of Rooms</label><input class="input" id="g-rooms" type="number" min="1" max="20" data-input="g.rooms" value="\${esc(g.numberOfRooms || (selectedLocs.length || 1))}"></div>
          <div class="field"><label for="g-adults">Adults</label><input class="input" id="g-adults" type="number" min="1" max="50" data-input="g.adults" value="\${esc(g.adultsCount || 1)}"></div>
          <div class="field"><label for="g-kids">Children</label><input class="input" id="g-kids" type="number" min="0" max="30" data-input="g.kids" value="\${esc(g.kidsCount || 0)}"></div>
          <div class="field"><label for="g-tariff">Room Tariff (₹ / Night)</label><input class="input mono" id="g-tariff" type="number" min="0" step="100" data-input="g.tariff" value="\${esc(g.roomTariff !== undefined ? g.roomTariff : 4500)}" placeholder="e.g. 4500"></div>
        </div>
      </div>

      <!-- 3. Address & Location Details (Auto-fills City & State silently without extra button) -->
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--pine);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line);padding-bottom:4px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
          <span>3. Complete Address &amp; Origin</span>
          <span class="muted" style="font-size:11px;font-weight:500;text-transform:none;">6-digit Pincode automatically detects City &amp; State</span>
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="g-pincode">Pincode (6 Digits)</label>
            <input class="input mono" id="g-pincode" maxlength="6" data-input="g.pincode" value="\${esc(g.pincode || '')}" placeholder="e.g. 175131">
          </div>
          <div class="field">
            <label for="g-country">Country</label>
            <select class="input" id="g-country" data-change="g.country">
              <option value="India" \${(!g.country || g.country==='India')?'selected':''}>India</option>
              <option value="United States" \${g.country==='United States'?'selected':''}>United States</option>
              <option value="United Kingdom" \${g.country==='United Kingdom'?'selected':''}>United Kingdom</option>
              <option value="United Arab Emirates" \${g.country==='United Arab Emirates'?'selected':''}>United Arab Emirates</option>
              <option value="Canada" \${g.country==='Canada'?'selected':''}>Canada</option>
              <option value="Australia" \${g.country==='Australia'?'selected':''}>Australia</option>
              <option value="Other" \${g.country==='Other'?'selected':''}>Other</option>
            </select>
          </div>
        </div>

        <div class="form-grid" style="margin-top:8px">
          <div class="field">
            <label for="g-state">State / Province</label>
            <input class="input" id="g-state" list="states-datalist" data-input="g.state" value="\${esc(g.state || '')}" placeholder="e.g. Himachal Pradesh, Delhi">
            <datalist id="states-datalist">
              \${statesList.map(s => \`<option value="\${esc(s)}">\`).join('')}
            </datalist>
          </div>
          <div class="field">
            <label for="g-city">City / District</label>
            <input class="input" id="g-city" data-input="g.city" value="\${esc(g.city || '')}" placeholder="e.g. Manali, New Delhi">
          </div>
        </div>

        <div class="field" style="margin-top:8px">
          <label for="g-street">Street Address / House / Locality</label>
          <input class="input" id="g-street" data-input="g.street" value="\${esc(g.street || '')}" placeholder="e.g. Flat 402, Pine Wood Heights, Mall Road">
        </div>
      </div>

      <!-- 4. Referral / Booking Source -->
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--pine);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line);padding-bottom:4px;margin-bottom:10px">
          4. Referral &amp; Booking Source
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="g-ref-select">Referred By / Via (Master)</label>
            <select class="input" id="g-ref-select" data-change="g.ref-select">
              <option value="">-- Choose Referral Source --</option>
              \${refSources.map(r => \`<option value="\${esc(r)}" \${(g.referredBy||'').toLowerCase()===r.toLowerCase()?'selected':''}>\${esc(r)}</option>\`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="g-ref-custom">Or Custom Referral Name / Notes</label>
            <input class="input" id="g-ref-custom" data-input="g.ref" value="\${esc(g.referredBy || '')}" placeholder="e.g. Aman (Staff), Sharma Travels">
          </div>
        </div>
      </div>

      \${S.guestDraftErr ? \`<div class="notice warn" style="margin:0">\${esc(S.guestDraftErr)}</div>\` : ''}
    </div>
    <div class="sheet-foot">
      <button class="btn" data-act="guest-close">Cancel</button>
      <button class="btn primary" data-act="guest-save">\${g._new ? 'Confirm Check-in &amp; Register Guest' : 'Save Guest Details'}</button>
    </div>
  </div></div>\`;
}

`;

html = html.substring(0, sIdx) + newGuestEditor + html.substring(eIdx);
console.log('✓ Updated guestEditor() with Check-in Date, Room Multiselect, and removed Auto-fill button');

// 2. Update saveGuest() to handle checkInDate and multi-room villas
const sgStart = 'async function saveGuest(){';
const sgEnd = 'async function saveReferral()';

const sgSIdx = html.indexOf(sgStart);
const sgEIdx = html.indexOf(sgEnd);

if (sgSIdx !== -1 && sgEIdx !== -1) {
  const newSaveGuest = `async function saveGuest(){
  const g = S.guestDraft;
  const name = String(g.name||'').trim();
  const phone = String(g.phone||'').trim();
  const aadhaar = String(g.aadhaarNumber||'').replace(/\\D/g,'');
  const locType = g.assignedLocationType || 'room';
  const locNum = String(g.assignedLocationNumber||'').trim().toUpperCase();
  const roomTariff = parseFloat(g.roomTariff !== undefined ? g.roomTariff : 4500) || 0;
  
  const checkInVal = g.checkInDate 
    ? (typeof g.checkInDate === 'string' ? new Date(g.checkInDate).getTime() : Number(g.checkInDate))
    : Date.now();
  const expectedCheckOut = g.expectedCheckOutDate ? new Date(g.expectedCheckOutDate).getTime() : null;

  const street = String(g.street || '').trim();
  const city = String(g.city || '').trim();
  const state = String(g.state || 'Himachal Pradesh').trim();
  const country = String(g.country || 'India').trim();
  const pincode = String(g.pincode || '').replace(/\\D/g, '').slice(0, 6);
  const numberOfRooms = Math.max(1, parseInt(g.numberOfRooms || 1, 10));
  const adultsCount = Math.max(1, parseInt(g.adultsCount || 1, 10));
  const kidsCount = Math.max(0, parseInt(g.kidsCount || 0, 10));
  const numberOfPersons = Math.max(1, parseInt(g.numberOfPersons || (adultsCount + kidsCount), 10));
  const referralSourceId = g.referralSourceId || null;
  const referredBy = String(g.referredBy || 'Direct Walk-in').trim();

  // Auto-compose address if not explicitly set
  let address = String(g.address || '').trim();
  if (!address && (street || city || state)) {
    const parts = [street, city, state ? (state + (pincode ? ' - ' + pincode : '')) : pincode, country].filter(Boolean);
    address = parts.join(', ');
  }

  if(!name){ S.guestDraftErr = 'Enter guest full name.'; render(); return; }
  if(phone.length < 10){ S.guestDraftErr = 'Enter a valid 10-digit mobile number.'; render(); return; }
  if(aadhaar.length !== 12){ S.guestDraftErr = 'Enter a valid 12-digit Aadhaar Card number.'; render(); return; }
  if(!locNum){ S.guestDraftErr = \`Select at least one assigned \${locType}.\`; render(); return; }

  // Resolve assigned villas across multiple selected rooms
  const selectedNums = locNum.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  let assignedVilla = (g.assignedVilla || '').trim();
  if (!assignedVilla) {
    if (locType === 'villa') {
      assignedVilla = locNum;
    } else {
      const villas = [];
      selectedNums.forEach(num => {
        const locObj = (S.locations || []).find(l => String(l.number).toUpperCase() === num);
        if (locObj && locObj.parentVilla && !villas.includes(locObj.parentVilla)) {
          villas.push(locObj.parentVilla);
        }
      });
      assignedVilla = villas.length ? villas.join(', ') : 'Villa 1';
    }
  }

  const id = g._new ? ('gst_' + Date.now().toString(36) + uid(4)) : g.id;
  const doc = {
    name,
    phone,
    aadhaarNumber: aadhaar,
    address,
    street,
    city,
    state,
    country,
    pincode,
    numberOfRooms: Math.max(numberOfRooms, selectedNums.length || 1),
    numberOfPersons,
    adultsCount,
    kidsCount,
    referralSourceId,
    referredBy,
    assignedLocationType: locType,
    assignedLocationNumber: locNum,
    assignedVilla: assignedVilla || 'Villa 1',
    roomTariff,
    expectedCheckOutDate: expectedCheckOut,
    checkInDate: checkInVal,
    status: g.status || 'checked_in'
  };

  const ok = g._new ? await write(() => S.store.set('guests/' + id, doc)) : await write(() => S.store.update('guests/' + id, doc));
  if(ok){
    toast(g._new ? 'Guest Registered' : 'Guest Details Updated', \`\${name} assigned to \${locType.toUpperCase()} \${locNum}\`, 'new');
    S.guestDraft = null;
    S.guestDraftErr = '';
    render();
  }
}

`;

  html = html.substring(0, sgSIdx) + newSaveGuest + html.substring(sgEIdx);
  console.log('✓ Updated saveGuest() with multi-room parsing and checkInDate');
}

// 3. Update click event listener for toggle-loc-select and g-loctype
const oldClickGuestPage = "case 'guest-page': S.guestPage = Number(t.dataset.page) || 1; break;";
const oldClickGuestIndex = html.indexOf(oldClickGuestPage);

if (oldClickGuestIndex !== -1) {
  const newClickAddition = `case 'toggle-loc-select': {
      const num = String(t.dataset.num || '').trim().toUpperCase();
      if (!S.guestDraft) break;
      let current = String(S.guestDraft.assignedLocationNumber || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (current.includes(num)) {
        current = current.filter(x => x !== num);
      } else {
        current.push(num);
      }
      S.guestDraft.assignedLocationNumber = current.join(', ');
      if (current.length > 0) {
        S.guestDraft.numberOfRooms = current.length;
      }
      render();
      break;
    }
    `;
  html = html.substring(0, oldClickGuestIndex) + newClickAddition + html.substring(oldClickGuestIndex);
  console.log('✓ Added toggle-loc-select handler in click listener');
}

// Update g-loctype to reset location selection when type toggles
const oldGLocType = "case 'g-loctype': S.guestDraft.assignedLocationType=t.dataset.v; break;";
if (html.includes(oldGLocType)) {
  html = html.replace(oldGLocType, "case 'g-loctype': S.guestDraft.assignedLocationType=t.dataset.v; S.guestDraft.assignedLocationNumber=''; render(); break;");
  console.log('✓ Updated g-loctype click handler to reset location on type change');
}

// 4. Update input event listener for g.checkin
const oldTariffInput = "else if(k==='g.tariff'){if(S.guestDraft)S.guestDraft.roomTariff=t.value;}";
const tariffIdx = html.indexOf(oldTariffInput);

if (tariffIdx !== -1) {
  const checkinInputHandler = `else if(k==='g.checkin'){if(S.guestDraft)S.guestDraft.checkInDate=t.value ? new Date(t.value).getTime() : Date.now();}
  `;
  html = html.substring(0, tariffIdx) + checkinInputHandler + html.substring(tariffIdx);
  console.log('✓ Added g.checkin input listener');
}

// Write back to public/admin.html
fs.writeFileSync(targetFile, html, 'utf8');
console.log('[Update Guest Editor] Finished successfully! (Total length:', html.length, 'bytes)');
