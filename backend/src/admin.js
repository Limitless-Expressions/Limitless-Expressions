export function adminPage() {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Limitless Expressions | Order Management</title>
<style>
body{font:16px system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;background:#f8f9fb;color:#171a20}
h1{font-size:1.6rem}main{background:white;padding:24px;border-radius:12px;border:1px solid #ddd}
input{padding:10px;width:min(100%,440px);box-sizing:border-box}button{padding:10px 16px;cursor:pointer}
table{width:100%;border-collapse:collapse;margin-top:20px}td,th{padding:12px 8px;text-align:left;border-bottom:1px solid #ddd}
small{color:#555}.error{color:#b42318}button:disabled{opacity:.5;cursor:not-allowed}
</style></head><body><main><h1>Limitless Expressions — Orders</h1>
<p>Administrator access only. Your token stays in this tab's memory and is not saved.</p>
<label for="token">Administrator token</label><div><input id="token" type="password" autocomplete="off" placeholder="Paste ADMIN_TOKEN"><button id="load">Load orders</button></div>
<p id="message" role="status"></p><div style="overflow:auto"><table><thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Status</th><th>Action</th></tr></thead><tbody id="orders"></tbody></table></div>
<p><small>Mark fulfilled only after an order has shipped. Artwork becomes eligible for deletion 90 days later.</small></p>
</main><script>
let token='';
const msg=document.getElementById('message'), body=document.getElementById('orders');
async function api(path, method='GET') {
  const res=await fetch(path,{method,headers:{Authorization:'Bearer '+token},cache:'no-store'});
  const data=await res.json();if(!res.ok)throw Error(data.error||'Request failed');return data;
}
async function load() {
  token=document.getElementById('token').value.trim();
  if(!token){msg.textContent='Enter the administrator token.';return}
  try {
    const orders=await api('/api/admin/orders');body.replaceChildren();
    for(const order of orders){
      const row=document.createElement('tr');
      for(const value of [order.id,order.customer_name,order.product+' × '+order.quantity,order.fulfilled_at?'Fulfilled':order.status]){
        const td=document.createElement('td');td.textContent=value;row.append(td);
      }
      const action=document.createElement('td');
      if(order.status==='paid'&&!order.fulfilled_at){
        const btn=document.createElement('button');btn.textContent='Mark fulfilled';
        btn.addEventListener('click',async()=>{
          if(!confirm('Confirm order '+order.id+' has shipped? This starts its 90-day artwork retention period.'))return;
          btn.disabled=true;try{await api('/api/admin/orders/'+encodeURIComponent(order.id)+'/fulfill','POST');msg.textContent='Order marked fulfilled.';await load()}catch(e){msg.textContent=e.message;btn.disabled=false}
        });action.append(btn)
      }else{action.textContent=order.fulfilled_at?'Complete':'Not paid'}
      row.append(action);body.append(row)
    }
    msg.textContent=orders.length+' orders loaded.';
  }catch(e){body.replaceChildren();msg.textContent=e.message;msg.className='error'}
}
document.getElementById('load').addEventListener('click',load);
</script></body></html>`;
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; referrer no-referrer",'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'}});
}
