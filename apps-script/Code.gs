/**
 * BANCO-MAM · Movimientos bancarios de Mary
 * Apps Script de la hoja "BANCO-MAM - Movimientos de Mary".
 *
 * - Lectura (familia): necesita CLAVE_LECTURA o CLAVE_ADMIN.
 * - Cargar resúmenes y cambiar nombres/categorías: solo CLAVE_ADMIN (Oscar).
 * - Los duplicados se descartan aquí, en el servidor, comparando
 *   fecha + descripción + débito + crédito + saldo.
 *
 * Para cambiar las claves, editá estas dos líneas y volvé a implementar
 * (Implementar → Gestionar implementaciones → editar → Nueva versión).
 */
const CLAVE_ADMIN   = 'CAMBIAR-CLAVE-ADMIN';
const CLAVE_LECTURA = 'CAMBIAR-CLAVE-FAMILIA';

const H_MOV = 'Movimientos', H_CP = 'Contrapartes', H_IMP = 'Importaciones', H_AJ = 'Ajustes';

function doGet(e) {
  const rol = rolDe((e && e.parameter && e.parameter.k) || '');
  if (!rol) return json({ ok: false, error: 'clave' });
  return json(Object.assign({ ok: true, rol: rol }, leerTodo()));
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'json' }); }
  const rol = rolDe(body.k || '');
  if (!rol) return json({ ok: false, error: 'clave' });
  if (rol !== 'admin') return json({ ok: false, error: 'solo_lectura' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let res;
    switch (body.accion) {
      case 'importar':    res = importar(body); break;
      case 'contraparte': res = guardarContraparte(body.clave, body.nombre, body.cat); break;
      case 'okDup':       res = marcarOkDup(body.gk, !!body.valor); break;
      case 'borrar':      res = borrarMovimiento(body.id); break;
      case 'borrarTodo':  res = borrarTodo(); break;
      default: return json({ ok: false, error: 'accion' });
    }
    return json(Object.assign({ ok: true }, res));
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- utilidades ---------- */
function rolDe(k) {
  if (k && k === CLAVE_ADMIN) return 'admin';
  if (k && k === CLAVE_LECTURA) return 'lectura';
  return null;
}
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function hoja(n) { return SpreadsheetApp.getActive().getSheetByName(n); }
function filas(n) {
  const h = hoja(n), last = h.getLastRow();
  if (last < 2) return [];
  return h.getRange(2, 1, last - 1, h.getLastColumn()).getValues();
}
function txt(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Argentina/Tucuman', 'yyyy-MM-dd');
  return String(v == null ? '' : v);
}
function num(v) { const n = Number(v); return isNaN(n) ? 0 : Math.round(n * 100) / 100; }
function claveLinea(r) {
  return [r.f, String(r.d).replace(/\s+/g, ' ').trim().toUpperCase(),
          num(r.deb).toFixed(2), num(r.cred).toFixed(2), num(r.saldo).toFixed(2)].join('|');
}
function ajustes() {
  const o = {};
  filas(H_AJ).forEach(function (r) { if (r[0]) o[txt(r[0])] = txt(r[1]); });
  return o;
}
function guardarAjuste(k, v) {
  const h = hoja(H_AJ), rows = filas(H_AJ);
  for (let i = 0; i < rows.length; i++) if (txt(rows[i][0]) === k) { h.getRange(i + 2, 2).setValue(v); return; }
  h.appendRow([k, v]);
}

/* ---------- lectura ---------- */
function leerTodo() {
  const rows = filas(H_MOV).filter(function (r) { return r[0]; }).map(function (r) {
    return { id: txt(r[0]), f: txt(r[1]), d: txt(r[2]), deb: num(r[3]), cred: num(r[4]), saldo: num(r[5]), imp: txt(r[6]), ord: Number(r[7]) || 0 };
  });
  const contrapartes = {};
  filas(H_CP).forEach(function (r) { if (r[0]) contrapartes[txt(r[0])] = { nombre: txt(r[1]), cat: txt(r[2]) }; });
  const imports = filas(H_IMP).filter(function (r) { return r[0]; }).map(function (r) {
    return { id: txt(r[0]), archivo: txt(r[1]), cuenta: txt(r[2]), saldosAl: txt(r[3]), desde: txt(r[4]), hasta: txt(r[5]),
             filas: Number(r[6]) || 0, nuevas: Number(r[7]) || 0, dup: Number(r[8]) || 0, saldoFinal: num(r[9]) };
  });
  const aj = ajustes();
  let okDup = {};
  try { okDup = JSON.parse(aj.okDup || '{}'); } catch (e) {}
  return { rows: rows, contrapartes: contrapartes, imports: imports, cuenta: aj.cuenta || '', okDup: okDup };
}

/* ---------- escritura (solo admin) ---------- */
function importar(b) {
  const nuevasFilas = (b.rows || []).filter(function (r) { return r && /^\d{4}-\d{2}-\d{2}$/.test(r.f); });
  if (!nuevasFilas.length) throw new Error('el archivo no trae movimientos');

  const aj = ajustes();
  if (aj.cuenta && b.cuenta && aj.cuenta !== b.cuenta) {
    return { rechazado: true, motivo: 'otra_cuenta', cuentaGuardada: aj.cuenta };
  }
  if (!aj.cuenta && b.cuenta) guardarAjuste('cuenta', b.cuenta);

  // cuántas veces existe ya cada línea idéntica
  const existe = {};
  let maxF = '', minF = '';
  filas(H_MOV).forEach(function (r) {
    if (!r[0]) return;
    const k = claveLinea({ f: txt(r[1]), d: r[2], deb: r[3], cred: r[4], saldo: r[5] });
    existe[k] = (existe[k] || 0) + 1;
    const f = txt(r[1]);
    if (!maxF || f > maxF) maxF = f;
    if (!minF || f < minF) minF = f;
  });

  const impId = new Date().toISOString();
  const vistos = {}, out = [];
  let dup = 0;
  nuevasFilas.forEach(function (r, i) {
    const k = claveLinea(r);
    vistos[k] = (vistos[k] || 0) + 1;
    if (vistos[k] <= (existe[k] || 0)) { dup++; return; }
    out.push([k + '#' + vistos[k], r.f, String(r.d), num(r.deb), num(r.cred), num(r.saldo), impId, i]);
  });
  if (out.length) {
    const h = hoja(H_MOV);
    h.getRange(h.getLastRow() + 1, 1, out.length, 8).setValues(out);
  }
  const fechas = nuevasFilas.map(function (r) { return r.f; }).sort();
  const desde = fechas[0], hasta = fechas[fechas.length - 1];
  hoja(H_IMP).appendRow([impId, String(b.archivo || ''), String(b.cuenta || ''), String(b.saldosAl || ''), desde, hasta,
                         nuevasFilas.length, out.length, dup, num(nuevasFilas[0].saldo)]);
  return { nuevas: out.length, dup: dup, desde: desde, hasta: hasta, antesMin: minF, antesMax: maxF };
}

function guardarContraparte(clave, nombre, cat) {
  if (!clave) throw new Error('falta la clave de contraparte');
  const h = hoja(H_CP), rows = filas(H_CP);
  for (let i = 0; i < rows.length; i++) {
    if (txt(rows[i][0]) === clave) { h.getRange(i + 2, 2, 1, 2).setValues([[nombre || '', cat || '']]); return {}; }
  }
  h.appendRow([clave, nombre || '', cat || '']);
  return {};
}

function marcarOkDup(gk, valor) {
  let o = {};
  try { o = JSON.parse(ajustes().okDup || '{}'); } catch (e) {}
  if (valor) o[gk] = true; else delete o[gk];
  guardarAjuste('okDup', JSON.stringify(o));
  return {};
}

function borrarMovimiento(id) {
  const h = hoja(H_MOV), rows = filas(H_MOV);
  for (let i = 0; i < rows.length; i++) if (txt(rows[i][0]) === id) { h.deleteRow(i + 2); return { borrado: true }; }
  return { borrado: false };
}

function borrarTodo() {
  [H_MOV, H_IMP].forEach(function (n) { const h = hoja(n); if (h.getLastRow() > 1) h.deleteRows(2, h.getLastRow() - 1); });
  guardarAjuste('cuenta', ''); guardarAjuste('okDup', '{}');
  return {};
}

/** Ejecutalo una vez desde el editor para dar permisos y comprobar que lee la hoja. */
function probar() {
  const d = leerTodo();
  Logger.log('Movimientos: ' + d.rows.length + ' · Contrapartes: ' + Object.keys(d.contrapartes).length);
}
