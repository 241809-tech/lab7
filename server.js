const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function createStore(dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'store.sqlite')) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>0),image TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cart(user_id TEXT REFERENCES users(id),product_id TEXT REFERENCES products(id) ON DELETE CASCADE,quantity INTEGER NOT NULL,PRIMARY KEY(user_id,product_id));
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),created_at TEXT NOT NULL,delivery TEXT NOT NULL,items TEXT NOT NULL,subtotal INTEGER NOT NULL,shipping INTEGER NOT NULL,total INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  if (!db.prepare("SELECT 1 FROM settings WHERE key='seeded'").get()) {
    const insert = db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?)');
    for (const p of [ ['headphones','Studio Headphones','Over-ear comfort, rich sound, and a foldable design.','Audio',12900,'images/headphones.svg'], ['backpack','Everyday Backpack','A lightweight carry with a padded laptop sleeve.','Carry',8500,'images/backpack.svg'], ['lamp','Arc Desk Lamp','Warm light for focused evenings and quiet reading.','Workspace',6200,'images/lamp.svg'], ['bottle','Daily Steel Bottle','Reusable stainless steel for everyday adventures.','Lifestyle',3400,'images/bottle.svg'] ]) insert.run(...p);
    db.prepare("INSERT INTO settings VALUES('seeded','true')").run();
  }
  function fail(status, message) { throw Object.assign(new Error(message), { status }); }
  function string(value, field, max=200) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${field} is required (maximum ${max} characters).`); return value.trim(); }
  function product(body, old={}) {
    const p = { ...old, ...body };
    if (!Number.isSafeInteger(p.price) || p.price <= 0 || p.price > 100000000) fail(400,'price must be a positive whole number in PKR.');
    const image = string(p.image,'image');
    if (!/^images\/[a-zA-Z0-9_-]+\.svg$/.test(image)) fail(400,'image must be a local images/*.svg path.');
    return [string(p.name,'name'),string(p.description,'description',2000),string(p.category,'category'),p.price,image];
  }
  const cart = id => {
    const items = db.prepare('SELECT p.*,c.quantity,p.price*c.quantity AS lineTotal FROM cart c JOIN products p ON p.id=c.product_id WHERE c.user_id=?').all(id);
    const subtotal = items.reduce((sum,p)=>sum+p.lineTotal,0);
    const shipping = subtotal && subtotal <= 10000 ? 300 : 0;
    return {items,subtotal,shipping,total:subtotal+shipping};
  };
  const server = http.createServer(async (req,res) => {
    const send = (status,data,headers={}) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url,'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'api') {
        if (!['GET','HEAD'].includes(req.method)) return send(405,{error:'Method not allowed.'});
        let target;
        if (url.pathname === '/assets/bootstrap/bootstrap.min.css') target = path.resolve(__dirname,'assets/bootstrap/bootstrap.min.css');
        else {
          const name = decodeURIComponent(url.pathname).replace(/^\//,'') || 'index.html';
          if (!/^(?:[a-zA-Z0-9_-]+\.html|app\.js|theme\.css|images\/[a-zA-Z0-9_-]+\.svg)$/.test(name)) return send(404,{error:'Not found.'});
          target = path.join(__dirname,name);
        }
        if (!fs.existsSync(target)) return send(404,{error:'Not found.'});
        res.writeHead(200,{'Content-Type': ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.svg':'image/svg+xml'})[path.extname(target)],'X-Content-Type-Options':'nosniff'});
        return req.method==='HEAD' ? res.end() : fs.createReadStream(target).pipe(res);
      }
      let body={};
      if (['POST','PUT','PATCH'].includes(req.method)) {
        let raw='';
        for await (const chunk of req) { raw+=chunk; if (Buffer.byteLength(raw)>65536) fail(413,'Request too large.'); }
        try { body=JSON.parse(raw || '{}'); } catch { fail(400,'Invalid JSON.'); }
        if (!body || Array.isArray(body) || typeof body!=='object') fail(400,'Expected a JSON object.');
      }
      const token = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8);
      const user = token && db.prepare('SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(token,Date.now());
      const requireUser = () => { if (!user) fail(401,'Please log in first.'); return user; };
      const route=parts.slice(1).join('/');
      if (req.method==='POST' && ['auth/signup','auth/login'].includes(route)) {
        const email=string(body.email,'email').toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'Enter a valid email.');
        const password=string(body.password,'password',128);
        let account;
        if (route==='auth/signup') {
          if (password.length<8) fail(400,'Password must contain at least 8 characters.');
          const name=string(body.name,'name');
          if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409,'Email already registered.');
          const salt=randomBytes(16).toString('hex');
          account={id:randomUUID(),name,email};
          db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(account.id,name,email,`${salt}:${scryptSync(password,salt,64).toString('hex')}`);
        } else {
          account=db.prepare('SELECT * FROM users WHERE email=?').get(email);
          if (!account) fail(401,'Incorrect email or password.');
          const [salt,hash]=account.password.split(':');
          if (!timingSafeEqual(Buffer.from(hash,'hex'),scryptSync(password,salt,64))) fail(401,'Incorrect email or password.');
        }
        const session=randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(session,account.id,Date.now()+604800000);
        return send(route==='auth/signup'?201:200,{id:account.id,name:account.name,email:account.email},{'Set-Cookie':`session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`});
      }
      if (route==='auth/me' && req.method==='GET') return send(200,requireUser());
      if (route==='auth/logout' && req.method==='POST') { db.prepare('DELETE FROM sessions WHERE token=?').run(token || ''); return send(200,{message:'Logged out.'},{'Set-Cookie':'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}); }
      if (parts[1]==='products' && parts.length<=3) {
        const id=parts[2];
        const existing=id && db.prepare('SELECT * FROM products WHERE id=?').get(id);
        if (id && !existing) fail(404,'Product not found.');
        if (req.method==='GET') return send(200,id?existing:db.prepare('SELECT * FROM products').all());
        // Classroom catalog CRUD is public; add administrator roles before deployment.
        if (req.method==='POST' && !id) { const values=product(body); const newId=randomUUID(); db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?)').run(newId,...values); return send(201,db.prepare('SELECT * FROM products WHERE id=?').get(newId)); }
        if (['PUT','PATCH'].includes(req.method) && id) { const values=product(body,req.method==='PATCH'?existing:{}); db.prepare('UPDATE products SET name=?,description=?,category=?,price=?,image=? WHERE id=?').run(...values,id); return send(200,db.prepare('SELECT * FROM products WHERE id=?').get(id)); }
        if (req.method==='DELETE' && id) { db.prepare('DELETE FROM products WHERE id=?').run(id); return send(200,{message:'Product deleted.'}); }
      }
      if (parts[1]==='cart') {
        const {id}=requireUser();
        if (route==='cart' && req.method==='GET') return send(200,cart(id));
        if (route==='cart' && req.method==='DELETE') { db.prepare('DELETE FROM cart WHERE user_id=?').run(id); return send(200,cart(id)); }
        if (route==='cart/items' && req.method==='POST') {
          if (!db.prepare('SELECT id FROM products WHERE id=?').get(body.productId)) fail(404,'Product not found.');
          const q=body.quantity ?? 1;
          const old=db.prepare('SELECT quantity FROM cart WHERE user_id=? AND product_id=?').get(id,body.productId)?.quantity || 0;
          if (!Number.isInteger(q) || q<1 || q+old>99) fail(400,'Quantity must be between 1 and 99.');
          db.prepare('INSERT INTO cart VALUES(?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=excluded.quantity').run(id,body.productId,q+old);
          return send(201,cart(id));
        }
        if (parts[2]==='items' && parts.length===4) {
          if (!db.prepare('SELECT 1 FROM cart WHERE user_id=? AND product_id=?').get(id,parts[3])) fail(404,'Cart item not found.');
          if (req.method==='PATCH') { if (!Number.isInteger(body.quantity) || body.quantity<1 || body.quantity>99) fail(400,'Quantity must be between 1 and 99.'); db.prepare('UPDATE cart SET quantity=? WHERE user_id=? AND product_id=?').run(body.quantity,id,parts[3]); return send(200,cart(id)); }
          if (req.method==='DELETE') { db.prepare('DELETE FROM cart WHERE user_id=? AND product_id=?').run(id,parts[3]); return send(200,cart(id)); }
        }
      }
      if (parts[1]==='orders' && parts.length<=3) {
        const {id}=requireUser();
        const decode=o=>({...o,delivery:JSON.parse(o.delivery),items:JSON.parse(o.items)});
        if (req.method==='GET') { if (parts[2]) { const order=db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(parts[2],id); if (!order) fail(404,'Order not found.'); return send(200,decode(order)); } return send(200,db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC').all(id).map(decode)); }
        if (req.method==='POST' && !parts[2]) {
          const delivery=Object.fromEntries(['firstName','lastName','email','address','city','postalCode'].map(k=>[k,string(body[k],k)]));
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(delivery.email)) fail(400,'Enter a valid email.');
          db.exec('BEGIN IMMEDIATE');
          try {
            const summary=cart(id); if (!summary.items.length) fail(400,'Your cart is empty.');
            const orderId=randomUUID();
            db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?)').run(orderId,id,new Date().toISOString(),JSON.stringify(delivery),JSON.stringify(summary.items),summary.subtotal,summary.shipping,summary.total);
            db.prepare('DELETE FROM cart WHERE user_id=?').run(id);
            db.exec('COMMIT'); return send(201,decode(db.prepare('SELECT * FROM orders WHERE id=?').get(orderId)));
          } catch(e) { db.exec('ROLLBACK'); throw e; }
        }
      }
      send(404,{error:'Endpoint not found.'});
    } catch(e) { if (!e.status) console.error(e); if (!res.headersSent) send(e.status || 500,{error:e.status?e.message:'Internal server error.'}); else res.end(); }
  });
  server.on('close',()=>db.close());
  return server;
}
if (require.main===module) createStore().listen(process.env.PORT || 3000,'127.0.0.1',()=>console.log(`Store: http://localhost:${process.env.PORT || 3000}`));
module.exports={createStore};

