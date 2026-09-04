/**
 * TrajectoryAI — signup receiver.
 *
 * Takes the POST from signup.html, writes one row per person to a Google Sheet,
 * and emails you a readable copy. The form posts twice (step 1 banks the email,
 * step 2 adds the optional research answers), so this upserts on email rather
 * than appending — one person, one row.
 *
 * SETUP
 *   1. Open the Google Sheet you want to collect in → Extensions → Apps Script.
 *   2. Paste this file over Code.gs.
 *   3. Fill in CONFIG below (NOTIFY_EMAIL is the only required change).
 *   4. Run setup() once from the editor and approve the permission prompts.
 *   5. Deploy → New deployment → Web app.
 *        Execute as:      Me
 *        Who has access:  Anyone            ← must be "Anyone", not "Anyone with Google account"
 *   6. Copy the /exec URL into CONFIG.ENDPOINT in signup.html.
 *   7. Open the /exec URL in a browser — it should return {"ok":true,...}.
 */

const CONFIG = {
  // Where to email each signup. Comma-separate for several recipients.
  NOTIFY_EMAIL: 'you@example.com',

  // 'all'   — email on step 1 and again when the optional answers land
  // 'step1' — email only when someone first joins (half the volume)
  // 'none'  — sheet only
  NOTIFY_ON: 'all',

  // Auto-reply to the person who signed up. Off by default: signup.html
  // promises "one email, when your cohort opens", and an instant confirmation
  // would contradict that. Turn this on only if you change that copy too.
  SEND_CONFIRMATION: false,
  CONFIRMATION_SUBJECT: "You're on the TrajectoryAI list",

  /* Quality checks. These FLAG, they never reject — the response is already
     captured by the time this runs, and a corporate domain with unusual DNS
     shouldn't cost you a counselor. Filter the email_quality column instead. */
  CHECK_MX: true,          // does the domain actually accept mail?
  CHECK_DISPOSABLE: true,  // mailinator, temp-mail and friends
  CHECK_ROLE: true,        // info@, admin@, noreply@ — real, but not a person

  SHEET_NAME: 'Signups',

  // Leave blank to use the spreadsheet this script is bound to.
  SHEET_ID: ''
};

/** Column order. Add to the end — never reorder, or existing rows will shear. */
const COLUMNS = [
  'timestamp', 'email', 'email_normalized', 'email_quality', 'respondent_id', 'step2_at',
  // step 1
  'would_use', 'would_use_other', 'stage', 'age_band',
  // step 2
  'goal', 'blocker', 'today', 'wtp', 'recommend', 'send_to', 'comments', 'follow_up',
  // attribution
  'variant', 'cta', 'segment',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'ttclid', 'gclid', 'li_fat_id',
  'referrer', 'dwell_ms', 'viewport'
];

/* ========================================================================== */

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // two people submitting at once must not race for the same row
    lock.waitLock(25000);

    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // email is optional on the form, so a respondent_id is the fallback key
    if (!data.email && !data.respondent_id) return json({ ok: false, error: 'no identifier' });

    const row = flatten(data);
    const result = upsert(row);

    const step = String(data.step || '1');
    if (CONFIG.NOTIFY_ON === 'all' || (CONFIG.NOTIFY_ON === 'step1' && step === '1')) {
      // notify from the merged record, not the incoming payload — step 2 alone
      // doesn't know who they are, and the email should show the whole person
      notify(result.record, step, result.action);
    }
    if (CONFIG.SEND_CONFIRMATION && step === '1' && result.action === 'created' && row.email) {
      confirm_(row.email);
    }
    return json({ ok: true, action: result.action, row: result.rowNumber });

  } catch (err) {
    // never fail silently — a lost signup is worse than a noisy log
    console.error(err);
    try { MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, 'TrajectoryAI signup FAILED', String(err)); } catch (_) {}
    return json({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/** Open the /exec URL in a browser to confirm the deployment is live. */
function doGet() {
  const sh = sheet();
  return json({
    ok: true,
    sheet: sh.getName(),
    rows: Math.max(0, sh.getLastRow() - 1),
    notify: CONFIG.NOTIFY_EMAIL
  });
}

/** Run once from the editor: creates the tab, writes headers, sends a test mail. */
function setup() {
  const sh = sheet();
  // run a check now so the UrlFetch permission is granted before real traffic
  const probe = CONFIG.CHECK_MX ? assessEmail('setup.probe@gmail.com') : 'skipped';
  Logger.log('MX check: ' + probe);
  MailApp.sendEmail(
    CONFIG.NOTIFY_EMAIL,
    'TrajectoryAI — webhook is live',
    'Setup ran. Signups will arrive here and in the "' + sh.getName() + '" tab of:\n\n' +
    spreadsheet().getUrl() + '\n\nEmail quality check: ' + probe
  );
  Logger.log('Ready. ' + sh.getLastRow() + ' row(s) including the header.');
}

/* ------------------------------------------------------------- email QC --- */

/* The 70 or so throwaway providers that account for nearly all real-world use.
   The long tail lives in community lists — the best-maintained is
   github.com/disposable-email-domains/disposable-email-domains, which requires
   evidence before a domain is added, so it produces few false positives.
   Paste extras into DISPOSABLE_EXTRA rather than editing this array. */
const DISPOSABLE = [
  'mailinator.com','guerrillamail.com','guerrillamail.net','guerrillamail.org','sharklasers.com',
  '10minutemail.com','10minutemail.net','20minutemail.com','tempmail.com','temp-mail.org',
  'temp-mail.io','tempmailo.com','tempr.email','tempmail.net','throwawaymail.com',
  'yopmail.com','yopmail.fr','yopmail.net','trashmail.com','trashmail.de','trashmail.net',
  'maildrop.cc','mailnesia.com','dispostable.com','fakeinbox.com','getnada.com','nada.email',
  'mohmal.com','emailondeck.com','mytemp.email','burnermail.io','spamgourmet.com',
  'mailcatch.com','inboxbear.com','mailde.de','mailde.info','discard.email','discardmail.com',
  'spam4.me','grr.la','pokemail.net','spambog.com','anonbox.net','fakemail.net',
  'mailexpire.com','mintemail.com','mt2015.com','moakt.com','tmpmail.org','tmpeml.com',
  'linshiyouxiang.net','1secmail.com','1secmail.net','1secmail.org','emltmp.com',
  'harakirimail.com','luxusmail.org','byom.de','einrot.com','cuvox.de','dayrep.com',
  'jourrapide.com','rhyta.com','superrito.com','teleworm.us','armyspy.com','gustr.com',
  'trbvm.com','wegwerfmail.de','wegwerfemail.de','spambox.us','tempinbox.com'
];
const DISPOSABLE_EXTRA = [];   // your own additions survive edits above

const ROLE_LOCALS = [
  'admin','administrator','info','contact','support','help','sales','billing','office',
  'noreply','no-reply','donotreply','postmaster','webmaster','hostmaster','abuse',
  'marketing','press','team','hello','mail','email','test','root'
];

/* Gmail ignores dots and anything after a +, so one person can produce endless
   distinct-looking addresses. Normalising means they land on one row. */
function normalizeEmail(email) {
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  let local = email.slice(0, at), domain = email.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('.').join('');
  return local + '@' + domain;
}

/* Does the domain accept mail at all? Answered over DNS-over-HTTPS, cached so a
   burst of signups from one domain costs one lookup. */
function hasMx(domain) {
  const cache = CacheService.getScriptCache();
  const key = 'mx:' + domain;
  const hit = cache.get(key);
  if (hit !== null) return hit === '1';

  function q(type) {
    const r = UrlFetchApp.fetch(
      'https://dns.google/resolve?name=' + encodeURIComponent(domain) + '&type=' + type,
      { muteHttpExceptions: true, followRedirects: true });
    return JSON.parse(r.getContentText());
  }
  try {
    const mx = q('MX');
    // NXDOMAIN (3) means the domain does not exist at all
    if (mx.Status === 3) { cache.put(key, '0', 21600); return false; }
    let ok = !!(mx.Answer && mx.Answer.some(function (a) { return a.type === 15; }));
    if (!ok) {
      // legal but rare: no MX, mail delivered to the A record
      const a = q('A');
      ok = !!(a.Answer && a.Answer.length);
    }
    cache.put(key, ok ? '1' : '0', 21600);   // 6 hours
    return ok;
  } catch (err) {
    return null;   // DNS trouble is our problem, not theirs — never downgrade on it
  }
}

/** 'ok' | 'no-mx' | 'disposable' | 'role' | 'unchecked' */
function assessEmail(email) {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at).toLowerCase();
  const domain = email.slice(at + 1).toLowerCase();

  if (CONFIG.CHECK_DISPOSABLE) {
    const bad = DISPOSABLE.concat(DISPOSABLE_EXTRA);
    // match the registrable domain too, so sub.mailinator.com is caught
    for (let i = 0; i < bad.length; i++) {
      if (domain === bad[i] || domain.slice(-(bad[i].length + 1)) === '.' + bad[i]) return 'disposable';
    }
  }
  if (CONFIG.CHECK_ROLE && ROLE_LOCALS.indexOf(local) !== -1) return 'role';
  if (CONFIG.CHECK_MX) {
    const mx = hasMx(domain);
    if (mx === false) return 'no-mx';
    if (mx === null)  return 'unchecked';
  }
  return 'ok';
}

/* ---------------------------------------------------------------- storage -- */

function spreadsheet() {
  return CONFIG.SHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet() {
  const ss = spreadsheet();
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) sh = ss.insertSheet(CONFIG.SHEET_NAME);

  if (sh.getLastRow() === 0) {
    sh.appendRow(COLUMNS);
    sh.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** The payload arrives nested (google:{...}); the sheet wants it flat. */
function flatten(d) {
  const out = {
    timestamp: new Date(),
    email: String(d.email || '').trim().toLowerCase()
  };
  if (out.email) {
    out.email_normalized = normalizeEmail(out.email);
    out.email_quality = assessEmail(out.email);
  } else {
    delete out.email;   // let '' stay blank rather than key on it
  }
  COLUMNS.forEach(function (k) {
    if (out[k] === undefined && d[k] !== undefined && d[k] !== null) out[k] = d[k];
  });
  if (String(d.step || '1') === '2') out.step2_at = new Date();
  return out;
}

/**
 * One row per person. Step 2 fills blanks left by step 1 without overwriting
 * anything already there, so a later partial submission can't erase good data.
 */
function upsert(row) {
  const sh = sheet();
  const last = sh.getLastRow();

  /* Match on email when there is one, otherwise on the browser-generated
     respondent_id. Matching on a blank email would fold every anonymous
     answer into a single row. */
  const key = row.email ? 'email_normalized' : 'respondent_id';
  const keyVal = String(row[key] || '').trim().toLowerCase();
  const keyCol = COLUMNS.indexOf(key) + 1;

  let target = 0;
  if (keyVal && last > 1) {
    const keys = sh.getRange(2, keyCol, last - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      const v = String(keys[i][0]).trim().toLowerCase();
      if (v && v === keyVal) { target = i + 2; break; }
    }
  }

  if (!target) {
    const fresh = COLUMNS.map(function (k) { return row[k] !== undefined ? row[k] : ''; });
    sh.appendRow(fresh);
    return { action: 'created', rowNumber: sh.getLastRow(), record: toObject(fresh) };
  }

  const range = sh.getRange(target, 1, 1, COLUMNS.length);
  const existing = range.getValues()[0];
  const merged = COLUMNS.map(function (k, i) {
    const incoming = row[k];
    if (incoming === undefined || incoming === '' || incoming === null) return existing[i];
    if (k === 'timestamp') return existing[i];        // keep when they first joined
    if (k === 'email') return existing[i] || incoming; // keep the address first given
    return incoming;
  });
  range.setValues([merged]);
  return { action: 'updated', rowNumber: target, record: toObject(merged) };
}

function toObject(values) {
  const o = {};
  COLUMNS.forEach(function (k, i) { o[k] = values[i]; });
  return o;
}

/* ------------------------------------------------------------------ email -- */

function notify(row, step, action) {
  const who = row.stage || 'unknown stage';
  const subject = '[TrajectoryAI] ' +
    (step === '2' ? 'Research answers' : 'New signup') + ' — ' +
    (row.email || 'no email') + ' (' + who + ')';

  const lines = [];
  const add = function (label, key) {
    if (row[key] !== undefined && row[key] !== '') lines.push(pad(label) + row[key]);
  };

  lines.push(action === 'created' ? 'NEW PERSON' : 'UPDATED EXISTING ROW');
  lines.push('');
  lines.push(pad('Email') + (row.email || '(left blank — cannot be contacted)'));
  if (row.email_quality && row.email_quality !== 'ok') {
    lines.push(pad('Email quality') + row.email_quality.toUpperCase() + '  <-- check this one');
  }
  lines.push('');
  add('Would use', 'would_use');
  add('  (other)', 'would_use_other');
  add('Stage', 'stage');
  add('Age band', 'age_band');
  lines.push('');
  add('Goal to map first', 'goal');
  add('Blocker', 'blocker');
  add('Solving it today via', 'today');
  add('Would pay', 'wtp');
  add('Would recommend', 'recommend');
  add('Would send to', 'send_to');
  add('Follow-up OK', 'follow_up');
  if (row.comments) { lines.push(''); lines.push('Comments:'); lines.push('  ' + row.comments); }

  lines.push('');
  lines.push('--- where they came from ---');
  add('Variant', 'variant');
  add('Button', 'cta');
  add('Segment', 'segment');
  add('Source', 'utm_source');
  add('Medium', 'utm_medium');
  add('Campaign', 'utm_campaign');
  add('Content', 'utm_content');
  add('Referrer', 'referrer');
  add('Time on page (ms)', 'dwell_ms');
  lines.push('');
  lines.push(spreadsheet().getUrl());

  const mail = { to: CONFIG.NOTIFY_EMAIL, subject: subject, body: lines.join('\n') };
  if (row.email) mail.replyTo = row.email;   // hit reply to talk to them directly
  MailApp.sendEmail(mail);
}

function confirm_(to) {
  MailApp.sendEmail({
    to: to,
    subject: CONFIG.CONFIRMATION_SUBJECT,
    body: "You're on the list.\n\n" +
          "We'll write once when your cohort opens — nothing before that.\n\n" +
          '— TrajectoryAI'
  });
}

/* ----------------------------------------------------------------- utils --- */

function pad(s) { return (s + ':').slice(0, 22).concat('                      ').slice(0, 22); }

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
