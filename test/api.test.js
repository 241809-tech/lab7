const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {createStore}=require('../server');
test('persistent store API and storefront',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'store-test-'));
 let server,base,cookie='';
 async function start(){server=createStore(path.join(dir,'test.sqlite'));await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;}
 async function stop(){await new Promise(r=>server.close(r));}
 async function request(route,method='GET',body,status=200){const r=await fetch(base+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});assert.equal(r.status,status,await r.clone().text());if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r.json();}
 try{
  await start();
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await fetch(base+'/assets/bootstrap/bootstrap.min.css')).status,200);
  assert.equal((await fetch(base+'/server.js')).status,404);
  await request('cart','GET',undefined,401);
  assert.equal((await request('products')).length,4);
  const p=await request('products','POST',{name:'Test product',description:'Persistent product',category:'Test',price:500,image:'images/bottle.svg'},201);
  await request('products/'+p.id,'PATCH',{price:-1},400);
  assert.equal((await request('products/'+p.id,'PATCH',{price:600})).price,600);
  await request('auth/signup','POST',{name:'Test User',email:'test@example.com',password:'sample-password'},201);
  await request('auth/signup','POST',{name:'Test User',email:'test@example.com',password:'sample-password'},409);
  await request('cart/items','POST',{productId:p.id,quantity:2},201);
  await request('cart/items/'+p.id,'PATCH',{quantity:0},400);
  assert.equal((await request('cart/items/'+p.id,'PATCH',{quantity:3})).total,2100);
  await stop();await start();
  assert.equal((await request('auth/me')).email,'test@example.com');
  assert.equal((await request('cart')).items[0].quantity,3);
  await request('orders','POST',{},400);
  const order=await request('orders','POST',{firstName:'Test',lastName:'User',email:'test@example.com',address:'Sample street',city:'Karachi',postalCode:'74000',total:1},201);
  assert.equal(order.total,2100);assert.equal((await request('cart')).items.length,0);
  await request('orders','POST',order.delivery,400);
  await request('products/'+p.id,'DELETE');
  await request('products/'+p.id,'GET',undefined,404);
  await stop();await start();
  assert.equal((await request('orders/'+order.id)).items[0].name,'Test product');
  await request('auth/logout','POST');
  await request('auth/login','POST',{email:'test@example.com',password:'wrong-password'},401);
  await request('auth/signup','POST',{name:'Other',email:'other@example.com',password:'sample-password'},201);
  await request('orders/'+order.id,'GET',undefined,404);
  await request('auth/logout','POST');
  await request('auth/login','POST',{email:'test@example.com',password:'sample-password'});
  await request('cart/items','POST',{productId:'headphones',quantity:1},201);
  assert.equal((await request('cart')).shipping,0);
  await request('cart/items/headphones','DELETE');
  assert.equal((await request('cart')).total,0);
 }finally{if(server?.listening)await stop();rmSync(dir,{recursive:true,force:true});}
});
