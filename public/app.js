(function(){
  const tg = window.Telegram?.WebApp;
  if (tg) tg.expand();

  const connector = new TON_CONNECT.TonConnect({ manifestUrl: `${window.location.origin}/tonconnect-manifest.json` });

  const connectBtn = document.getElementById('connect');
  const balanceEl = document.getElementById('balance');
  const minersEl = document.getElementById('miners');
  const buyBtn = document.getElementById('buy');
  const withdrawBtn = document.getElementById('withdraw');
  let currentUser = null;

  try{ currentUser = String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id); }catch(e){ currentUser = null; }

  async function fetchProfile(){
    if (!currentUser) return;
    const res = await fetch(`/api/profile/${currentUser}`);
    if (!res.ok) return;
    const j = await res.json();
    if (j.ok){
      balanceEl.innerText = Number(j.user.balance || 0).toFixed(6);
      minersEl.innerText = j.user.miners || 0;
    }
  }

  async function saveUser(telegramId, tonAddress){
    await fetch('/api/save-user', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ telegram_id: telegramId, ton_address: tonAddress }) });
  }

  connectBtn.addEventListener('click', async ()=>{
    try {
      const wallets = await connector.getWallets();
      if (!wallets || wallets.length === 0) {
        await connector.connect();
      } else {
        await connector.connect({ universalLink: wallets[0].universalLink });
      }
    } catch(e){ console.error(e); alert('Ошибка подключения кошелька'); }
  });

  connector.onStatusChange(async (walletInfo)=>{
    if (!walletInfo) return;
    const address = walletInfo.account.address;
    if (currentUser) {
      await saveUser(currentUser, address);
      await fetchProfile();
      alert('Кошелёк подключён: ' + address);
    } else {
      alert('Откройте приложение через бота в Telegram, чтобы привязать профиль.');
    }
  });

  buyBtn.addEventListener('click', async ()=>{
    if (!currentUser){ alert('Откройте приложение через бота в Telegram.'); return; }
    const price = 1.0;
    const res = await fetch('/api/purchase', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ telegram_id: currentUser, price }) });
    const j = await res.json();
    if (j.ok){ alert('Куплено!'); fetchProfile(); } else { alert(j.error || 'Ошибка покупки'); }
  });

  withdrawBtn.addEventListener('click', async ()=>{
    if (!currentUser){ alert('Откройте приложение через бота in Telegram.'); return; }
    const amount = parseFloat(prompt('Сколько вывести (TON)?'));
    if (!amount || amount <= 0) return;
    const to = prompt('TON адрес для вывода');
    if (!to) return;
    const res = await fetch('/api/withdraw', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ telegram_id: currentUser, amount, to_address: to }) });
    const j = await res.json();
    if (j.ok){ alert('Заявка создана'); fetchProfile(); } else { alert(j.error || 'Ошибка вывода'); }
  });

  // mining tick every 60 seconds
  setInterval(()=>{
    if (!currentUser) return;
    fetch('/api/mine-tick', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ telegram_id: currentUser }) })
      .then(r=>r.json()).then(d=>{ if (d.ok) { balanceEl.innerText = Number(d.balance||0).toFixed(6); } });
  }, 60000);

  fetchProfile();
})();
