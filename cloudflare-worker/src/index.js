const responseJson = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8' } });

async function tg(env, method, payload) {
  const r = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error('Telegram API request failed: ' + method);
  return data.result;
}
const mainMenu = { keyboard: [[{text:'📝 Buyurtma berish'}],[{text:'📦 Buyurtmalarim'},{text:'💰 Narxlar'}],[{text:'💳 To‘lov haqida'},{text:'ℹ️ Yordam'}]], resize_keyboard:true };
const serviceMenu = { keyboard: [[{text:'Prezentatsiya'}],[{text:'Referat / hujjat'}],[{text:'Boshqa elektron ish'}],[{text:'❌ Bekor qilish'}]], resize_keyboard:true };
const price = (service, quantity) => { if (service !== 'Prezentatsiya') return 10000; const n = Number.parseInt(quantity, 10); if (!Number.isFinite(n) || n < 1) return 15000; return n <= 8 ? 5000 : n <= 20 ? 10000 : 15000; };
const priceText = '💰 Taxminiy narxlar\n\n• Prezentatsiya, 1–8 slayd: 5 000 so‘m\n• Prezentatsiya, 9–20 slayd: 10 000 so‘m\n• Prezentatsiya, 21+ slayd: 15 000 so‘mdan\n• Boshqa elektron ishlar: 10 000 so‘mdan\n\nYakuniy narx va muddat administrator bilan kelishiladi.';
async function send(env, chatId, text, extra) { return tg(env, 'sendMessage', Object.assign({chat_id:chatId, text:text}, extra || {})); }
async function session(env, id) { const row = await env.DB.prepare('SELECT state,data FROM sessions WHERE user_id=?').bind(id).first(); return row ? {state:row.state,data:JSON.parse(row.data || '{}')} : {state:'idle',data:{}}; }
async function saveSession(env,id,state,data) { await env.DB.prepare('INSERT INTO sessions(user_id,state,data) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,data=excluded.data,updated_at=CURRENT_TIMESTAMP').bind(id,state,JSON.stringify(data)).run(); }
async function clearSession(env,id) { await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run(); }
async function notifyAdmin(env,id) {
 const o = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first(); if (!o) return;
 const txt = '📥 Yangi buyurtma #' + o.id + '\nTalaba ID: ' + o.user_id + '\nXizmat: ' + o.service + '\nMavzu: ' + o.description + '\nHajm: ' + o.quantity + '\nMuddat: ' + o.deadline + '\nBudjet: ' + o.budget + '\nUstuvorlik: ' + o.priority + '\nTaxminiy narx: ' + Number(o.estimate).toLocaleString('uz-UZ') + ' so‘m';
 await send(env, Number(env.ADMIN_ID), txt, {reply_markup:{inline_keyboard:[[{text:'✅ Qabul qilish',callback_data:'status:'+id+':Qabul qilindi'},{text:'🛠 Jarayonda',callback_data:'status:'+id+':Jarayonda'}],[{text:'🏁 Bajarildi',callback_data:'status:'+id+':Bajarildi'},{text:'❌ Rad etish',callback_data:'status:'+id+':Rad etildi'}]]}});
}
async function handleCallback(env,q) {
 await tg(env,'answerCallbackQuery',{callback_query_id:q.id});
 if (String(q.from.id)!==String(env.ADMIN_ID) || !q.data || !q.data.startsWith('status:')) return;
 const parts=q.data.split(':'); const id=Number(parts[1]); const status=parts.slice(2).join(':');
 await env.DB.prepare('UPDATE orders SET status=? WHERE id=?').bind(status,id).run();
 const o=await env.DB.prepare('SELECT user_id FROM orders WHERE id=?').bind(id).first();
 if(o) await send(env,o.user_id,'Buyurtma #'+id+' holati: '+status);
 await send(env,Number(env.ADMIN_ID),'Buyurtma #'+id+' holati yangilandi: '+status);
}
async function handleMessage(env,m) {
 if(!m.from || !m.chat) return; const uid=m.from.id, chat=m.chat.id, text=(m.text||'').trim();
 if(text==='/start'){await clearSession(env,uid);return send(env,chat,'Assalomu alaykum! Student Assistant botiga xush kelibsiz.',{reply_markup:mainMenu});}
 if(text==='/cancel'||text==='❌ Bekor qilish'){await clearSession(env,uid);return send(env,chat,'Amal bekor qilindi.',{reply_markup:mainMenu});}
 if(text==='💰 Narxlar') return send(env,chat,priceText,{reply_markup:mainMenu});
 if(text==='💳 To‘lov haqida') return send(env,chat,env.PAYMENT_TEXT||'To‘lov rekvizitlarini administrator yuboradi.',{reply_markup:mainMenu});
 if(text==='ℹ️ Yordam') return send(env,chat,'Buyurtma qoldiring. Yakuniy narx va muddat administrator tomonidan tasdiqlanadi.',{reply_markup:mainMenu});
 if(text==='📦 Buyurtmalarim'){const rows=await env.DB.prepare('SELECT id,service,status,payment_status,created_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 10').bind(uid).all();if(!rows.results.length)return send(env,chat,'Hozircha buyurtma yo‘q.',{reply_markup:mainMenu});return send(env,chat,rows.results.map(o=>'#'+o.id+' '+o.service+'\nHolat: '+o.status+'\nTo‘lov: '+(o.payment_status||'Tekshirilmagan')).join('\n\n'),{reply_markup:mainMenu});}
 if(text==='📝 Buyurtma berish'){await saveSession(env,uid,'service',{});return send(env,chat,'Qaysi xizmat kerak?',{reply_markup:serviceMenu});}
 const s=await session(env,uid);
 if(s.state==='service'){if(!['Prezentatsiya','Referat / hujjat','Boshqa elektron ish'].includes(text))return send(env,chat,'Menyudan xizmat turini tanlang.',{reply_markup:serviceMenu});await saveSession(env,uid,'description',{service:text});return send(env,chat,'Topshiriq mavzusi va talablarini yozing:');}
 if(s.state==='description'){if(text.length<3)return send(env,chat,'Mavzu va talablarni batafsilroq yozing.');await saveSession(env,uid,'quantity',Object.assign({},s.data,{description:text}));return send(env,chat,s.data.service==='Prezentatsiya'?'Nechta slayd kerak?':'Hajmi (sahifa/so‘z)ni yozing:');}
 if(s.state==='quantity'){await saveSession(env,uid,'deadline',Object.assign({},s.data,{quantity:text}));return send(env,chat,'Qachongacha kerak? Masalan: 28-oktabr 18:00 yoki 3 kun ichida.');}
 if(s.state==='deadline'){await saveSession(env,uid,'budget',Object.assign({},s.data,{deadline:text}));return send(env,chat,'Budjetingiz qancha? Masalan: 20 000 so‘m yoki kelishamiz.');}
 if(s.state==='budget'){await saveSession(env,uid,'priority',Object.assign({},s.data,{budget:text}));return send(env,chat,'Qaysi biri muhimroq?',{reply_markup:{keyboard:[[{text:'💸 Arzonroq, ko‘proq vaqt'}],[{text:'⚖️ Muvozanatli'}],[{text:'⚡ Tezroq, sifat ustuvor'}],[{text:'❌ Bekor qilish'}]],resize_keyboard:true}});}
 if(s.state==='priority'){if(!['💸 Arzonroq, ko‘proq vaqt','⚖️ Muvozanatli','⚡ Tezroq, sifat ustuvor'].includes(text))return send(env,chat,'Variantlardan birini tanlang.');const d=Object.assign({},s.data,{priority:text});const estimate=price(d.service,d.quantity);const r=await env.DB.prepare('INSERT INTO orders(user_id,username,service,description,quantity,deadline,budget,priority,estimate,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(uid,m.from.username||'',d.service,d.description,d.quantity,d.deadline,d.budget,d.priority,estimate,new Date().toISOString()).run();const id=r.meta.last_row_id;await clearSession(env,uid);await send(env,chat,'Buyurtmangiz #'+id+' qabul qilindi.\nTaxminiy narx: '+estimate.toLocaleString('uz-UZ')+' so‘m.\nAdministrator yakuniy narx va muddatni tasdiqlaydi.',{reply_markup:mainMenu});return notifyAdmin(env,id);}
 if(m.photo||m.document)return send(env,chat,'Fayl biriktirish Cloudflare versiyasiga hali ulanmagan. Talablarni matn bilan yuboring.');
}
export default { async fetch(request,env) { const url=new URL(request.url); if(request.method==='GET'&&url.pathname==='/')return new Response('Student Assistant webhook worker'); if(request.method!=='POST'||url.pathname!=='/telegram')return new Response('Not found',{status:404}); if(env.WEBHOOK_SECRET && request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.WEBHOOK_SECRET)return responseJson({ok:false,error:'Unauthorized'},401); if(!env.BOT_TOKEN||!env.ADMIN_ID||!env.DB)return responseJson({ok:false,error:'Worker configuration missing'},500); try{const update=await request.json();if(update.callback_query)await handleCallback(env,update.callback_query);else if(update.message)await handleMessage(env,update.message);return responseJson({ok:true});}catch(e){return responseJson({ok:false,error:'Update handling failed'},500);} } };
