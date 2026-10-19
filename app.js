/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          POS TIENDA — Backend Node.js / Express              ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  SETUP RÁPIDO:                                               ║
 * ║  1. npm install                                              ║
 * ║  2. Descarga serviceAccountKey.json desde Firebase Console   ║
 * ║     → Configuración del proyecto → Cuentas de servicio       ║
 * ║     → Generar nueva clave privada                            ║
 * ║  3. Coloca serviceAccountKey.json en esta misma carpeta      ║
 * ║  4. node app.js   (o: npm run dev  con nodemon)              ║
 * ║                                                              ║
 * ║  REGLAS FIRESTORE (copia en Firebase Console):               ║
 * ║  rules_version = '2';                                        ║
 * ║  service cloud.firestore {                                   ║
 * ║    match /databases/{db}/documents {                         ║
 * ║      match /products/{id} {                                  ║
 * ║        allow read: if true;                                  ║
 * ║        allow write: if request.auth != null;                 ║
 * ║      }                                                       ║
 * ║      match /sales/{id} {                                     ║
 * ║        allow read,create: if request.auth != null;           ║
 * ║        allow update,delete: if request.auth.uid ==           ║
 * ║          'XNFA7Wr5pPfmv9Rhlb9xQQV8Vii1';                    ║
 * ║      }                                                       ║
 * ║      match /users/{id} {                                     ║
 * ║        allow read: if request.auth != null;                  ║
 * ║        allow write: if request.auth.uid ==                   ║
 * ║          'XNFA7Wr5pPfmv9Rhlb9xQQV8Vii1';                    ║
 * ║      }                                                       ║
 * ║      match /terminals/{id} {                                 ║
 * ║        allow read, write: if true;                           ║
 * ║      }                                                       ║
 * ║    }                                                         ║
 * ║  }                                                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const admin   = require('firebase-admin');

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
const ADMIN_UID = 'XNFA7Wr5pPfmv9Rhlb9xQQV8Vii1';
const PORT      = process.env.PORT || 3000;

/* ─────────────────────────────────────────────────────────────
   FIREBASE ADMIN INIT
───────────────────────────────────────────────────────────── */
function initFirebaseAdmin() {
  // Option A: serviceAccountKey.json file (recommended for local dev)
  const keyPath = path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(keyPath)) {
    admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
    console.log('✅  Firebase Admin → serviceAccountKey.json');
    return;
  }

  // Option B: environment variable (useful for deploy en Railway/Render/etc.)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
      console.log('✅  Firebase Admin → variable de entorno');
      return;
    } catch (e) {
      console.error('❌  FIREBASE_SERVICE_ACCOUNT no es JSON válido:', e.message);
    }
  }

  console.error(`
❌  ERROR: No se encontró serviceAccountKey.json

   Pasos para obtenerlo:
   1. Ve a https://console.firebase.google.com
   2. Proyecto "tienda-2d9fe" → ⚙️ Configuración del proyecto
   3. Pestaña "Cuentas de servicio"
   4. Clic en "Generar nueva clave privada"
   5. Guarda el archivo como  serviceAccountKey.json  en esta carpeta

   O bien, define la variable de entorno FIREBASE_SERVICE_ACCOUNT
   con el contenido JSON del archivo.
`);
  process.exit(1);
}

initFirebaseAdmin();

const db   = admin.firestore();
const auth = admin.auth();

/* ─────────────────────────────────────────────────────────────
   EXPRESS APP
───────────────────────────────────────────────────────────── */
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Serve the frontend (index.html + static assets)
app.use(express.static(path.join(__dirname)));

/* ─────────────────────────────────────────────────────────────
   AUTH MIDDLEWARE
───────────────────────────────────────────────────────────── */
async function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticación requerido' });
  }
  try {
    req.user = await auth.verifyIdToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function verifyAdmin(req, res, next) {
  if (req.user.uid !== ADMIN_UID) {
    return res.status(403).json({ error: 'Se requieren permisos de administrador' });
  }
  next();
}

/* ─────────────────────────────────────────────────────────────
   ROUTES
───────────────────────────────────────────────────────────── */

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ═══════════════════════════════════════
// SELLERS
// ═══════════════════════════════════════

/** GET /api/sellers — listar todos los vendedores */
app.get('/api/sellers', verifyToken, verifyAdmin, async (_req, res) => {
  try {
    const snap    = await db.collection('users').where('role', '==', 'seller').get();
    const sellers = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    res.json({ sellers });
  } catch (err) {
    console.error('[GET /api/sellers]', err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/sellers — crear un nuevo vendedor */
app.post('/api/sellers', verifyToken, verifyAdmin, async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nombre, correo y contraseña son requeridos' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  try {
    // 1. Crear cuenta en Firebase Auth
    const userRecord = await auth.createUser({ email, password, displayName: name });

    // 2. Guardar perfil en Firestore
    await db.collection('users').doc(userRecord.uid).set({
      name, email, role: 'seller', active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).json({
      seller: { uid: userRecord.uid, name, email, role: 'seller', active: true },
      message: 'Vendedor creado exitosamente',
    });
  } catch (err) {
    console.error('[POST /api/sellers]', err);
    const errMap = {
      'auth/email-already-exists': 'Este correo ya está registrado',
      'auth/invalid-email':        'Correo electrónico inválido',
      'auth/weak-password':        'La contraseña es demasiado débil',
    };
    res.status(500).json({ error: errMap[err.code] || err.message });
  }
});

/** PATCH /api/sellers/:uid — activar / desactivar vendedor */
app.patch('/api/sellers/:uid', verifyToken, verifyAdmin, async (req, res) => {
  const { uid }    = req.params;
  const { active } = req.body;

  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: '"active" debe ser true o false' });
  }
  if (uid === ADMIN_UID) {
    return res.status(400).json({ error: 'No puedes modificar la cuenta del administrador' });
  }

  try {
    await auth.updateUser(uid, { disabled: !active });
    await db.collection('users').doc(uid).update({
      active,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true, message: `Vendedor ${active ? 'activado' : 'desactivado'}` });
  } catch (err) {
    console.error('[PATCH /api/sellers]', err);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/sellers/:uid — eliminar vendedor */
app.delete('/api/sellers/:uid', verifyToken, verifyAdmin, async (req, res) => {
  const { uid } = req.params;

  if (uid === ADMIN_UID) {
    return res.status(400).json({ error: 'No puedes eliminar la cuenta del administrador' });
  }

  try {
    await auth.deleteUser(uid);
    await db.collection('users').doc(uid).delete();
    res.json({ success: true, message: 'Vendedor eliminado permanentemente' });
  } catch (err) {
    console.error('[DELETE /api/sellers]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════
// METRICS
// ═══════════════════════════════════════

/**
 * GET /api/metrics?period=day|week|month|year
 * Devuelve KPIs, ventas por día, por vendedor y ranking de productos.
 */
app.get('/api/metrics', verifyToken, verifyAdmin, async (req, res) => {
  const { period = 'day' } = req.query;
  const now = new Date();

  const startMap = {
    day:   new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    week:  new Date(now - 7 * 24 * 60 * 60 * 1000),
    month: new Date(now.getFullYear(), now.getMonth(), 1),
    year:  new Date(now.getFullYear(), 0, 1),
  };
  const start = startMap[period] ?? startMap.day;

  try {
    const snap = await db.collection('sales')
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(start))
      .get();

    const sales = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    /* ── KPIs ─────────────────────────────────────────── */
    const totalSales  = sales.reduce((s, x) => s + (x.total || 0), 0);
    const totalCash   = sales.filter(x => x.payMethod === 'cash').reduce((s, x) => s + (x.total || 0), 0);
    const totalCard   = sales.filter(x => x.payMethod === 'card').reduce((s, x) => s + (x.total || 0), 0);
    const txCount     = sales.length;
    const avgTicket   = txCount ? totalSales / txCount : 0;

    /* ── Sales by date ────────────────────────────────── */
    const salesByDate = {};
    sales.forEach(s => {
      const d = s.timestamp?.toDate?.()?.toISOString?.()?.split('T')[0] || s.date;
      if (d) salesByDate[d] = (salesByDate[d] || 0) + (s.total || 0);
    });

    /* ── Sales by seller ──────────────────────────────── */
    const sellerMap = {};
    sales.forEach(s => {
      const sid = s.sellerId;
      if (!sid) return;
      if (!sellerMap[sid]) sellerMap[sid] = { name: s.sellerName || '(sin nombre)', total: 0, count: 0 };
      sellerMap[sid].total += s.total || 0;
      sellerMap[sid].count++;
    });
    const bySeller = Object.values(sellerMap).sort((a, b) => b.total - a.total);

    /* ── Sales by product ─────────────────────────────── */
    const productMap = {};
    sales.forEach(s => {
      (s.items || []).forEach(it => {
        if (!productMap[it.barcode]) {
          productMap[it.barcode] = { name: it.name || '(sin nombre)', qty: 0, revenue: 0 };
        }
        productMap[it.barcode].qty     += it.quantity || 0;
        productMap[it.barcode].revenue += it.subtotal || 0;
      });
    });
    const prodList = Object.entries(productMap)
      .map(([barcode, d]) => ({ barcode, ...d }))
      .sort((a, b) => b.qty - a.qty);

    res.json({
      period, totalSales, totalCash, totalCard, txCount, avgTicket,
      salesByDate, bySeller,
      topProducts:    prodList.slice(0, 10),
      bottomProducts: [...prodList].reverse().slice(0, 10),
    });
  } catch (err) {
    console.error('[GET /api/metrics]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════
// SALES HISTORY
// ═══════════════════════════════════════

/**
 * GET /api/sales?sellerId=&startDate=&endDate=&limit=100
 * Admin: puede ver todo. Vendedor: solo sus ventas.
 */
app.get('/api/sales', verifyToken, async (req, res) => {
  let { sellerId, startDate, endDate, limit: limitStr = '100' } = req.query;
  const limit = Math.min(parseInt(limitStr) || 100, 500);
  const isAdm = req.user.uid === ADMIN_UID;

  // Vendedor sin permisos de admin solo ve sus propias ventas
  if (!isAdm) {
    if (sellerId && sellerId !== req.user.uid) {
      return res.status(403).json({ error: 'Solo puedes ver tus propias ventas' });
    }
    sellerId = req.user.uid;
  }

  try {
    let q = sellerId
      ? db.collection('sales').where('sellerId', '==', sellerId)
      : db.collection('sales').orderBy('timestamp', 'desc');

    if (startDate) {
      q = q.where('timestamp', '>=', admin.firestore.Timestamp.fromDate(new Date(startDate)));
    }
    if (endDate) {
      q = q.where('timestamp', '<=', admin.firestore.Timestamp.fromDate(new Date(endDate + 'T23:59:59')));
    }

    const snap  = await q.limit(limit).get();
    const sales = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      timestamp: d.data().timestamp?.toDate?.()?.toISOString?.() ?? null,
    }));

    // Sort client-side (avoids composite index requirement when filtering by sellerId)
    sales.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

    res.json({ sales, count: sales.length });
  } catch (err) {
    console.error('[GET /api/sales]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════
// PRODUCTS (optional backend helpers)
// ═══════════════════════════════════════

/** GET /api/products — listar productos activos */
app.get('/api/products', async (_req, res) => {
  try {
    const snap     = await db.collection('products').where('active', '==', true).orderBy('name').get();
    const products = snap.docs.map(d => ({ barcode: d.id, ...d.data() }));
    res.json({ products, count: products.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/products/:barcode — buscar producto por código */
app.get('/api/products/:barcode', async (req, res) => {
  try {
    const doc = await db.collection('products').doc(req.params.barcode).get();
    if (!doc.exists) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ product: { barcode: doc.id, ...doc.data() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/products — crear o actualizar producto (admin) */
app.post('/api/products', verifyToken, verifyAdmin, async (req, res) => {
  const { barcode, name, price, stock = 0, category = 'General' } = req.body;
  if (!name || price == null) return res.status(400).json({ error: 'name y price requeridos' });
  const data = {
    name, price: parseFloat(price), stock: parseInt(stock),
    category, active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  try {
    if (barcode) {
      await db.collection('products').doc(barcode).set(data, { merge: true });
      res.json({ barcode, ...data });
    } else {
      data.createdAt = admin.firestore.FieldValue.serverTimestamp();
      const ref = await db.collection('products').add(data);
      res.json({ barcode: ref.id, ...data });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════
// REPORTS — Export CSV
// ═══════════════════════════════════════

/**
 * GET /api/reports/sales-csv?period=month
 * Descarga el historial de ventas como CSV.
 */
app.get('/api/reports/sales-csv', verifyToken, verifyAdmin, async (req, res) => {
  const { period = 'month' } = req.query;
  const now = new Date();
  const startMap = {
    day:   new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    week:  new Date(now - 7 * 24 * 60 * 60 * 1000),
    month: new Date(now.getFullYear(), now.getMonth(), 1),
    year:  new Date(now.getFullYear(), 0, 1),
  };

  try {
    const snap  = await db.collection('sales')
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(startMap[period] || startMap.month))
      .orderBy('timestamp', 'desc')
      .get();
    const sales = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const header = ['ID','Fecha','Vendedor','Total','Método','Items'];
    const rows   = sales.map(s => [
      s.id,
      s.timestamp?.toDate?.()?.toLocaleString('es-MX') || '',
      s.sellerName || '',
      s.total || 0,
      s.payMethod || '',
      (s.items || []).map(i => `${i.name}(x${i.quantity})`).join('; '),
    ]);

    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ventas_${period}_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send('\uFEFF' + csv); // BOM para Excel
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   CATCH-ALL → SPA frontend
───────────────────────────────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ─────────────────────────────────────────────────────────────
   START SERVER
───────────────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║       🏪  POS Tienda — Servidor          ║
╠══════════════════════════════════════════╣
║  URL:   http://localhost:${PORT}            ║
║                                          ║
║  Acceso Admin:   Ctrl + Shift + A        ║
║  Modo Escáner:   URL + ?scan=TERMINAL_ID ║
╚══════════════════════════════════════════╝
`);
});