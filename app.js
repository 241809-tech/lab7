const money = n => `PKR ${n.toLocaleString('en-PK')}`;
const escapeHtml = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url, method='GET', body) {
  const response=await fetch(`/api/${url}`,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if (!response.ok) { if(response.status===401 && !url.startsWith('auth/')) location.href='login.html'; throw new Error(result.error); }
  return result;
}
function error(e) {
  let box=document.querySelector('#api-message');
  if(!box){box=document.createElement('div');box.id='api-message';box.className='container alert alert-danger mt-3';box.setAttribute('role','alert');document.querySelector('main').prepend(box);}
  box.textContent=e.message;
  box.scrollIntoView({block:'nearest'});
}
function summary(c) {return `<div class="card p-4 mt-4"><h2 class="h5">Order summary</h2><p>Subtotal: ${money(c.subtotal)}</p><p>Delivery: ${money(c.shipping)}</p><strong>Total: ${money(c.total)}</strong></div>`;}
async function renderCart(){
  const c=await api('cart'); const section=document.querySelector('main section');
  section.innerHTML='<h1>Your cart</h1>'+(c.items.length?c.items.map(p=>`<div class="bg-white border rounded p-3 my-3 d-flex flex-wrap align-items-center gap-3"><img src="${escapeHtml(p.image)}" width="96" alt=""><div class="flex-grow-1"><h2 class="h5">${escapeHtml(p.name)}</h2><p>${money(p.price)} each</p><label>Quantity <input class="form-control" type="number" min="1" max="99" value="${p.quantity}" data-quantity="${escapeHtml(p.id)}"></label></div><strong>${money(p.lineTotal)}</strong><button class="btn btn-outline-danger" data-remove="${escapeHtml(p.id)}">Remove</button></div>`).join('')+summary(c)+'<a class="btn btn-dark mt-3" href="checkout.html">Continue to checkout &rarr;</a>':'<p>Your cart is empty.</p>')+'<p class="mt-4"><a href="index.html#products">Continue shopping</a></p>';
  section.querySelectorAll('[data-quantity]').forEach(input=>input.onchange=async()=>{try{await api(`cart/items/${input.dataset.quantity}`,'PATCH',{quantity:Number(input.value)});await renderCart();}catch(e){error(e);}});
  section.querySelectorAll('[data-remove]').forEach(button=>button.onclick=async()=>{try{await api(`cart/items/${button.dataset.remove}`,'DELETE');await renderCart();}catch(e){error(e);}});
}
async function init(){
  const page=location.pathname.split('/').pop() || 'index.html';
  try {
    const user=await api('auth/me');
    const login=document.querySelector('nav a[href="login.html"]');
    if(login){login.textContent=`Log out (${user.name})`;login.href='#';login.onclick=async e=>{e.preventDefault();try{await api('auth/logout','POST');location.href='index.html';}catch(e){error(e);}};}
  } catch {} 
  if(page==='index.html'){
    const products=await api('products');
    document.querySelector('#products .row').innerHTML=products.map(p=>`<div class="col"><article class="card border-0 shadow-sm h-100 rounded-4 overflow-hidden"><img src="${escapeHtml(p.image)}" class="card-img-top" width="360" height="300" alt="${escapeHtml(p.name)}"><div class="card-body p-4 d-flex flex-column"><p class="small text-secondary">${escapeHtml(p.category)}</p><h3 class="h5">${escapeHtml(p.name)}</h3><p class="small text-secondary flex-grow-1">${escapeHtml(p.description)}</p><strong class="mb-3">${money(p.price)}</strong><button class="btn btn-dark" data-add="${escapeHtml(p.id)}">Add to cart +</button></div></article></div>`).join('');
    document.querySelector('#products > .small').textContent='Add your favorites to your saved cart. Log in to shop and place a classroom order.';
    document.querySelector('#products .d-flex > span').textContent=`${products.length} curated essentials`;
    document.querySelectorAll('[data-add]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await api('cart/items','POST',{productId:button.dataset.add,quantity:1});location.href='cart.html';}catch(e){error(e);button.disabled=false;}});
  }
  if(page==='login.html' || page==='signup.html'){
    const form=document.querySelector('form');
    form.previousElementSibling.textContent='Your account and cart are saved by the store API. Use fictional details for this classroom app.';
    form.removeAttribute('action');form.method='post';
    form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await api(page==='signup.html'?'auth/signup':'auth/login','POST',{name:document.querySelector('#fullName')?.value,email:document.querySelector('#email').value,password:document.querySelector('#password').value});location.href='index.html';}catch(e){error(e);button.disabled=false;}};
  }
  if(page==='cart.html') await renderCart();
  if(page==='checkout.html'){
    const c=await api('cart');if(!c.items.length){location.href='cart.html';return;}
    document.querySelector('aside').innerHTML=c.items.map(p=>`<p>${escapeHtml(p.name)} &times; ${p.quantity} � ${money(p.lineTotal)}</p>`).join('')+summary(c);
    const form=document.querySelector('form');form.removeAttribute('action');form.method='post';
    form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{const body=Object.fromEntries(['firstName','lastName','contactEmail','address','city','postalCode'].map(k=>[k==='contactEmail'?'email':k,document.getElementById(k).value]));const order=await api('orders','POST',body);location.href=`confirmation.html?id=${encodeURIComponent(order.id)}`;}catch(e){error(e);button.disabled=false;}};
  }
  if(page==='confirmation.html'){
    const id=new URLSearchParams(location.search).get('id');if(!id)throw new Error('Missing order ID.');
    const order=await api(`orders/${encodeURIComponent(id)}`);
    document.querySelector('main').innerHTML=`<section class="container py-5"><h1>Order saved</h1><p>Order reference: ${escapeHtml(order.id)}</p><p>Placed ${escapeHtml(new Date(order.created_at).toLocaleString())}</p><p>Thank you, ${escapeHtml(order.delivery.firstName)}. Your classroom order is saved. No payment is processed or shipment arranged.</p>${order.items.map(p=>`<p>${escapeHtml(p.name)} &times; ${p.quantity}: ${money(p.lineTotal)}</p>`).join('')}${summary(order)}<a class="btn btn-dark mt-4" href="index.html">Continue shopping</a></section>`;
  }
}
init().catch(error);
