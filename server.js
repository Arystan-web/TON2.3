const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const { Telegraf } = require('telegraf');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://ton2-2.onrender.com';
const PORT = process.env.PORT || 10000;

const DB_DIR = path.join(__dirname, 'db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);
const USERS_PATH = path.join(DB_DIR, 'users.json');
const WITHD_PATH = path.join(DB_DIR, 'withdraws.json');
if (!fs.existsSync(USERS_PATH)) fs.writeFileSync(USERS_PATH, JSON.stringify({ users: [] }, null, 2));
if (!fs.existsSync(WITHD_PATH)) fs.writeFileSync(WITHD_PATH, JSON.stringify({ withdraws: [] }, null, 2));

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
function readUsers(){ return JSON.parse(fs.readFileSync(USERS_PATH)); }
function writeUsers(data){ fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 2)); }

// Save user (from WebApp after wallet connect)
app.post('/api/save-user', (req, res) => {
  try {
    const { telegram_id, ton_address } = req.body || {};
    if (!telegram_id || !ton_address) return res.status(400).json({ ok:false, error:'telegram_id and ton_address required' });
    const db = readUsers();
    let user = db.users.find(u => u.telegram_id === String(telegram_id));
    if (!user) {
      user = { telegram_id: String(telegram_id), ton_address, balance: 0, miners: 0, ref_code: Math.random().toString(36).slice(2,9), created_at: new Date().toISOString(), last_mine: Math.floor(Date.now()/1000) };
      db.users.push(user);
    } else {
      user.ton_address = ton_address;
      user.updated_at = new Date().toISOString();
    }
    writeUsers(db);
    return res.json({ ok:true });
  } catch (e) { console.error(e); return res.status(500).json({ ok:false, error:'server error' }); }
});

// Get profile
app.get('/api/profile/:telegram_id', (req, res) => {
  const id = String(req.params.telegram_id);
  const db = readUsers();
  const user = db.users.find(u => u.telegram_id === id);
  if (!user) return res.status(404).json({ ok:false, error:'not found' });
  return res.json({ ok:true, user });
});

// Purchase miner (cost 1 TON)
app.post('/api/purchase', (req, res) => {
  try {
    const { telegram_id, price } = req.body || {};
    if (!telegram_id || price == null) return res.status(400).json({ ok:false });
    const db = readUsers();
    const user = db.users.find(u => u.telegram_id === String(telegram_id));
    if (!user) return res.status(404).json({ ok:false, error:'user not found' });
    if (user.balance < Number(price)) return res.status(400).json({ ok:false, error:'insufficient balance' });
    user.balance = Number(user.balance) - Number(price);
    user.miners = (user.miners || 0) + 1;
    writeUsers(db);
    return res.json({ ok:true, miners: user.miners, balance: user.balance });
  } catch (e) { console.error(e); return res.status(500).json({ ok:false }); }
});

// Withdraw request (creates record)
app.post('/api/withdraw', (req, res) => {
  try {
    const { telegram_id, amount, to_address } = req.body || {};
    if (!telegram_id || !amount || !to_address) return res.status(400).json({ ok:false });
    const db = readUsers();
    const user = db.users.find(u => u.telegram_id === String(telegram_id));
    if (!user) return res.status(404).json({ ok:false, error:'user not found' });
    if (user.balance < Number(amount)) return res.status(400).json({ ok:false, error:'insufficient balance' });
    user.balance = Number(user.balance) - Number(amount);
    writeUsers(db);
    const wdb = JSON.parse(fs.readFileSync(WITHD_PATH));
    const id = Date.now();
    wdb.withdraws.push({ id, telegram_id: String(telegram_id), amount: Number(amount), to_address, status:'pending', created_at: new Date().toISOString() });
    fs.writeFileSync(WITHD_PATH, JSON.stringify(wdb, null, 2));
    return res.json({ ok:true, withdraw_id: id });
  } catch (e) { console.error(e); return res.status(500).json({ ok:false }); }
});

// Mining tick: add 0.0001 TON per minute per miner, or at least base 0.0001 per minute
app.post('/api/mine-tick', (req, res) => {
  try {
    const { telegram_id } = req.body || {};
    if (!telegram_id) return res.status(400).json({ ok:false });
    const db = readUsers();
    const user = db.users.find(u => u.telegram_id === String(telegram_id));
    if (!user) return res.status(404).json({ ok:false, error:'user not found' });
    const now = Math.floor(Date.now()/1000);
    const last = user.last_mine || now;
    const seconds = Math.max(0, now - last);
    const minutes = Math.floor(seconds / 60);
    if (minutes <= 0) {
      return res.json({ ok:true, mined:0, balance: user.balance });
    }
    const perMinerPerMinute = 0.0001; // per minute
    const minersCount = Math.max(1, user.miners || 0); // at least 1 baseline
    const mined = minersCount * perMinerPerMinute * minutes;
    user.balance = Number(user.balance) + mined;
    user.last_mine = now;
    writeUsers(db);
    return res.json({ ok:true, mined, balance: user.balance });
  } catch (e) { console.error(e); return res.status(500).json({ ok:false }); }
});

// health
app.get('/health', (req, res) => res.send('TONMiner OK'));

// serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Telegram bot (webhook)
if (!BOT_TOKEN) {
  console.warn('BOT_TOKEN not set in env — bot will not run.');
} else {
  const bot = new Telegraf(BOT_TOKEN);
  bot.start((ctx) => {
    const tgid = String(ctx.from.id);
    const db = readUsers();
    if (!db.users.find(u=>u.telegram_id===tgid)) {
      db.users.push({ telegram_id: tgid, ton_address: null, balance: 0, miners: 0, ref_code: Math.random().toString(36).slice(2,9), created_at: new Date().toISOString(), last_mine: Math.floor(Date.now()/1000) });
      writeUsers(db);
    }
    ctx.reply('👋 Добро пожаловать в TONMiner!', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Запустить TONMiner', web_app: { url: WEB_APP_URL } }],
          [{ text: '📢 Профиль', callback_data: 'profile' }]
        ]
      }
    });
  });

  bot.action('profile', async (ctx) => {
    const tgid = String(ctx.from.id);
    const db = readUsers();
    const user = db.users.find(u=>u.telegram_id===tgid);
    if (!user) return ctx.reply('Профиль не найден.');
    await ctx.reply(`Профиль\nБаланс: ${Number(user.balance).toFixed(6)} TON\nМайнеры: ${user.miners}\nРеф: ${user.ref_code}`);
  });

  (async ()=>{
    try {
      const hook = `${WEB_APP_URL}/bot${BOT_TOKEN}`;
      await bot.telegram.setWebhook(hook);
      app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
      console.log('✅ Telegram webhook set to', hook);
    } catch (err) { console.error('Failed to set webhook', err); }
  })();
}

app.listen(PORT, ()=> console.log(`✅ Server running on port ${PORT}`));
