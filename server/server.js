const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOST = "0.0.0.0";
const PORT = 3000;
const DATA_FILE = path.join(__dirname, "kadad-data.json");

const DEFAULT_DB = {
  admin: { user: "admin", pass: "admin" },
  clientPass: "admin",
  adminSessions: {},
  links: [],
  folders: [],
  commands: [],
  clients: {}
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadDb() {
  if (!fs.existsSync(DATA_FILE)) return clone(DEFAULT_DB);
  try {
    const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    db.admin = db.admin || clone(DEFAULT_DB.admin);
    db.admin.user = db.admin.user || "admin";
    db.admin.pass = db.admin.pass || "admin";
    db.clientPass = db.clientPass || "admin";
    db.adminSessions = db.adminSessions || {};
    db.links = Array.isArray(db.links) ? db.links : [];
    db.folders = Array.isArray(db.folders) ? db.folders : [];
    db.commands = Array.isArray(db.commands) ? db.commands : [];
    db.clients = db.clients || {};
    return db;
  } catch {
    return clone(DEFAULT_DB);
  }
}

let db = loadDb();

function saveDb() {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function makeId() {
  return crypto.randomBytes(12).toString("hex");
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-token, x-client-password, x-client-id",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
  });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");

    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { statusCode: 400 }));
      }
    });

    req.on("error", reject);
  });
}

function cleanFolder(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(part => part && part !== "." && part !== "..")
    .join("/");
}

function safeFileName(value) {
  const name = String(value || "download")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .trim();
  return name || "download";
}

function adminAuth(req) {
  const token = String(req.headers["x-admin-token"] || "");
  return Boolean(token && db.adminSessions[token]);
}

function clientAuth(req) {
  return String(req.headers["x-client-password"] || "") === String(db.clientPass);
}

function allFolders() {
  const client = db.clients.main || {};
  const clientFolders = Array.isArray(client.folders) ? client.folders : [];
  return [...new Set([...db.folders, ...clientFolders])].sort();
}

const HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kadad File Downloader</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box}
body{margin:0;font-family:Vazirmatn,Arial,sans-serif;background:#0b1020;color:#eef2ff}
main{max-width:1100px;margin:auto;padding:28px}
.card{background:#121a2d;border:1px solid #26334f;border-radius:20px;padding:22px;margin-bottom:18px;box-shadow:0 14px 40px #0005}
h1,h2{margin-top:0}
input,button{font:inherit;border-radius:12px;padding:11px 13px;border:1px solid #34435f}
input{width:100%;background:#0b1020;color:white}
button{cursor:pointer;background:#315efb;color:white;border:0;font-weight:700}
button.danger{background:#c7354a}
button.secondary{background:#26334f}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.row>*{flex:1}
.small{color:#9aa8c7;font-size:13px}
.hidden{display:none}
.item{padding:15px;border:1px solid #293752;border-radius:15px;margin-top:10px}
.progress{height:8px;background:#27334b;border-radius:99px;overflow:hidden;margin-top:10px}
.progress>i{display:block;height:100%;background:#5b7cfa}
.badge{display:inline-block;padding:4px 9px;border-radius:999px;background:#26334f;font-size:12px}
.ok{background:#155c43}.bad{background:#71303d}
#toast{position:fixed;bottom:20px;left:20px;right:20px;text-align:center}
</style>
</head>
<body>
<main>
<section id="login" class="card">
<h1>📦 Kadad File Downloader</h1>
<p class="small">ورود مدیریت</p>
<div class="grid">
<input id="user" placeholder="نام کاربری" value="admin">
<input id="pass" type="password" placeholder="رمز عبور" value="admin">
</div>
<br><button onclick="login()">ورود</button>
</section>

<section id="app" class="hidden">
<div class="card">
<div class="row">
<div><h1>📦 Kadad File Downloader</h1><div class="small">مدیریت دانلودها و پوشه‌های Client</div></div>
<button class="secondary" onclick="logout()">خروج</button>
</div>
</div>

<div class="grid">
<section class="card">
<h2>🔗 افزودن لینک</h2>
<input id="url" placeholder="https://example.com/file.zip">
<br><br>
<input id="folder" list="folderList" placeholder="پوشه مقصد، مثال: Games/Updates">
<datalist id="folderList"></datalist>
<br><br>
<button onclick="addLink()">افزودن لینک</button>
</section>

<section class="card">
<h2>📁 پوشه‌ها</h2>
<input id="newFolder" placeholder="مثال: Games/Updates">
<br><br>
<div class="row">
<button onclick="createFolder()">ساخت پوشه</button>
<button class="danger" onclick="deleteFolder()">حذف پوشه</button>
</div>
<div id="folders"></div>
</section>

<section class="card">
<h2>🖥️ Client</h2>
<div id="clientStatus">در حال بررسی...</div>
<p class="small">Client پوشه‌های موجود خود را به سرور گزارش می‌کند.</p>
</section>

<section class="card">
<h2>🔐 رمزها</h2>
<input id="oldPass" type="password" placeholder="رمز فعلی">
<br><br>
<input id="adminPass" type="password" placeholder="رمز جدید Admin">
<br><br>
<input id="clientPass" type="password" placeholder="رمز جدید Client">
<br><br>
<button onclick="changePasswords()">ذخیره رمزها</button>
</section>
</div>

<section class="card">
<h2>📥 دانلودها</h2>
<div id="links"></div>
</section>
</section>
</main>
<div id="toast"></div>

<script>
const tokenKey="kfd_admin_token";
let token=localStorage.getItem(tokenKey);

function toast(message){
  document.getElementById("toast").textContent=message;
  setTimeout(()=>document.getElementById("toast").textContent="",2500);
}
async function api(url, options={}){
  options.headers=Object.assign({"Content-Type":"application/json","x-admin-token":token},options.headers||{});
  const r=await fetch(url,options);
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||data.message||"خطا");
  return data;
}
async function login(){
  try{
    const data=await api("/admin/login",{method:"POST",headers:{},body:JSON.stringify({
      user:document.getElementById("user").value,
      pass:document.getElementById("pass").value
    })});
    token=data.token;
    localStorage.setItem(tokenKey,token);
    showApp();
  }catch(e){toast("❌ "+e.message)}
}
function logout(){
  localStorage.removeItem(tokenKey);
  token=null;
  document.getElementById("app").classList.add("hidden");
  document.getElementById("login").classList.remove("hidden");
}
async function showApp(){
  document.getElementById("login").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  await refresh();
}
async function refresh(){
  try{
    const [links,folders,client]=await Promise.all([
      api("/api/admin/links"),
      api("/api/admin/folders"),
      api("/api/admin/client")
    ]);
    renderLinks(links);
    renderFolders(folders.folders);
    document.getElementById("clientStatus").innerHTML=client.online
      ? '<span class="badge ok">● آنلاین</span>'
      : '<span class="badge bad">● آفلاین</span>';
  }catch(e){
    if(e.message==="unauthorized") logout();
    else toast("❌ "+e.message);
  }
}
function renderFolders(list){
  const dl=document.getElementById("folderList");
  dl.innerHTML=list.map(x=>"<option value="+JSON.stringify(x)+">").join("");
  document.getElementById("folders").innerHTML=list.length
    ? list.map(x=>'<div class="item">📁 '+escapeHtml(x)+'</div>').join("")
    : '<p class="small">هنوز پوشه‌ای ثبت نشده.</p>';
}
function renderLinks(list){
  const box=document.getElementById("links");
  if(!list.length){box.innerHTML='<p class="small">هنوز لینکی اضافه نشده.</p>';return}
  box.innerHTML=list.slice().reverse().map(x=>{
    const pct=Number(x.progress||0);
    return '<div class="item"><b>'+escapeHtml(x.name)+'</b>'+
      '<div class="small">'+escapeHtml(x.url)+'</div>'+
      '<div class="small">📁 '+escapeHtml(x.folder||"/")+' — '+escapeHtml(x.status||"waiting")+'</div>'+
      '<div class="progress"><i style="width:'+pct+'%"></i></div>'+
      '<div class="row" style="margin-top:10px">'+
      '<button onclick="downloadLink(\''+x.id+'\')">شروع دانلود</button>'+
      '<button class="danger" onclick="deleteLink(\''+x.id+'\')">حذف</button>'+
      '</div></div>';
  }).join("");
}
function escapeHtml(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
async function addLink(){
  try{
    await api("/api/admin/links",{method:"POST",body:JSON.stringify({
      url:document.getElementById("url").value,
      folder:document.getElementById("folder").value
    })});
    document.getElementById("url").value="";
    toast("✅ لینک اضافه شد");
    refresh();
  }catch(e){toast("❌ "+e.message)}
}
async function downloadLink(id){
  try{
    await api("/api/admin/links/"+encodeURIComponent(id)+"/download",{method:"POST"});
    toast("✅ دانلود در صف قرار گرفت");
    refresh();
  }catch(e){toast("❌ "+e.message)}
}
async function deleteLink(id){
  try{
    await api("/api/admin/links/"+encodeURIComponent(id),{method:"DELETE"});
    refresh();
  }catch(e){toast("❌ "+e.message)}
}
async function createFolder(){
  try{
    await api("/api/admin/folders",{method:"POST",body:JSON.stringify({folder:document.getElementById("newFolder").value})});
    document.getElementById("newFolder").value="";
    toast("✅ دستور ساخت پوشه ارسال شد");
    refresh();
  }catch(e){toast("❌ "+e.message)}
}
async function deleteFolder(){
  try{
    await api("/api/admin/folders",{method:"DELETE",body:JSON.stringify({folder:document.getElementById("newFolder").value})});
    document.getElementById("newFolder").value="";
    toast("✅ دستور حذف پوشه ارسال شد");
    refresh();
  }catch(e){toast("❌ "+e.message)}
}
async function changePasswords(){
  try{
    await api("/api/admin/passwords",{method:"POST",body:JSON.stringify({
      old:document.getElementById("oldPass").value,
      admin:document.getElementById("adminPass").value,
      client:document.getElementById("clientPass").value
    })});
    toast("✅ رمزها تغییر کردند");
  }catch(e){toast("❌ "+e.message)}
}
function startAutoRefresh(){
  setInterval(()=>{if(token) refresh()},3000);
}
if(token) showApp(); else document.getElementById("login").classList.remove("hidden");
startAutoRefresh();
</script>
</body>
</html>`;

function sendHtml(res) {
  res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});
  res.end(HTML);
}

const server = http.createServer(async (req,res)=>{
  try{
    const url = new URL(req.url, "http://localhost");

    if(req.method==="OPTIONS"){
      res.writeHead(204);
      return res.end();
    }

    if(req.method==="GET" && url.pathname==="/admin") {
      return sendHtml(res);
    }

    if(req.method==="POST" && url.pathname==="/admin/login"){
      const b=await readJson(req);
      if(String(b.user||"")===db.admin.user && String(b.pass||"")===db.admin.pass){
        const token=makeId();
        db.adminSessions[token]=Date.now();
        saveDb();
        return sendJson(res,200,{token});
      }
      return sendJson(res,401,{error:"invalid"});
    }

    if(url.pathname.startsWith("/api/admin") && !adminAuth(req)){
      return sendJson(res,401,{error:"unauthorized"});
    }

    if(req.method==="GET" && url.pathname==="/api/admin/links"){
      return sendJson(res,200,db.links);
    }

    if(req.method==="GET" && url.pathname==="/api/admin/folders"){
      return sendJson(res,200,{folders:allFolders()});
    }

    if(req.method==="GET" && url.pathname==="/api/admin/client"){
      const c=db.clients.main||{};
      return sendJson(res,200,{
        online:Boolean(c.lastSeen && Date.now()-c.lastSeen<15000),
        lastSeen:c.lastSeen||null,
        folders:allFolders()
      });
    }

    if(req.method==="POST" && url.pathname==="/api/admin/folders"){
      const b=await readJson(req);
      const folder=cleanFolder(b.folder);
      if(!folder) return sendJson(res,400,{error:"invalid folder"});
      if(!db.folders.includes(folder)) db.folders.push(folder);
      if(!db.commands.some(x=>x.type==="mkdir" && x.folder===folder)){
        db.commands.push({id:makeId(),type:"mkdir",folder});
      }
      saveDb();
      return sendJson(res,200,{ok:true,folder});
    }

    if(req.method==="DELETE" && url.pathname==="/api/admin/folders"){
      const b=await readJson(req);
      const folder=cleanFolder(b.folder);
      if(!folder) return sendJson(res,400,{error:"invalid folder"});
      db.folders=db.folders.filter(x=>x!==folder && !x.startsWith(folder+"/"));
      db.commands=db.commands.filter(x=>!(x.folder===folder && (x.type==="mkdir"||x.type==="rmdir")));
      db.commands.push({id:makeId(),type:"rmdir",folder});
      saveDb();
      return sendJson(res,200,{ok:true,folder});
    }

    if(req.method==="POST" && url.pathname==="/api/admin/links"){
      const b=await readJson(req);
      const link=String(b.url||"").trim();
      let parsed;
      try{parsed=new URL(link)}catch{return sendJson(res,400,{error:"bad url"})}
      if(!["http:","https:"].includes(parsed.protocol)) return sendJson(res,400,{error:"bad url"});
      const name=safeFileName(path.basename(parsed.pathname)||"download");
      const item={
        id:makeId(),
        url:link,
        name,
        folder:cleanFolder(b.folder),
        status:"waiting",
        progress:0,
        error:null,
        createdAt:Date.now()
      };
      db.links.push(item);
      saveDb();
      return sendJson(res,200,{ok:true,link:item});
    }

    const downloadMatch=url.pathname.match(/^\/api\/admin\/links\/([^/]+)\/download$/);
    if(req.method==="POST" && downloadMatch){
      const item=db.links.find(x=>x.id===decodeURIComponent(downloadMatch[1]));
      if(!item) return sendJson(res,404,{error:"not found"});
      item.status="queued";
      item.progress=0;
      item.error=null;
      saveDb();
      return sendJson(res,200,{ok:true});
    }

    const deleteMatch=url.pathname.match(/^\/api\/admin\/links\/([^/]+)$/);
    if(req.method==="DELETE" && deleteMatch){
      const id=decodeURIComponent(deleteMatch[1]);
      const index=db.links.findIndex(x=>x.id===id);
      if(index<0) return sendJson(res,404,{error:"not found"});
      db.links.splice(index,1);
      saveDb();
      return sendJson(res,200,{ok:true});
    }

    if(req.method==="POST" && url.pathname==="/api/admin/passwords"){
      const b=await readJson(req);
      if(String(b.old||"")!==String(db.admin.pass)) return sendJson(res,400,{error:"bad password"});
      if(b.admin) db.admin.pass=String(b.admin);
      if(b.client) db.clientPass=String(b.client);
      saveDb();
      return sendJson(res,200,{ok:true});
    }

    if(url.pathname.startsWith("/api/v1") && !clientAuth(req)){
      return sendJson(res,401,{error:"client unauthorized"});
    }

    if(req.method==="GET" && url.pathname==="/api/v1"){
      const c=db.clients.main||{};
      c.lastSeen=Date.now();
      db.clients.main=c;
      const jobs=db.links.filter(x=>x.status==="queued"||x.status==="downloading")
        .map(x=>({id:x.id,url:x.url,name:x.name,folder:x.folder}));
      saveDb();
      return sendJson(res,200,jobs);
    }

    if(req.method==="POST" && url.pathname==="/api/v1/heartbeat"){
      const b=await readJson(req);
      db.clients.main={
        lastSeen:Date.now(),
        folders:Array.isArray(b.folders)?b.folders.map(cleanFolder).filter(Boolean):[]
      };
      saveDb();
      return sendJson(res,200,{ok:true,commands:db.commands});
    }

    if(req.method==="POST" && url.pathname==="/api/v1/command-done"){
      const b=await readJson(req);
      db.commands=db.commands.filter(x=>x.id!==String(b.id||""));
      saveDb();
      return sendJson(res,200,{ok:true});
    }

    if(req.method==="POST" && url.pathname==="/api/v1/progress"){
      const b=await readJson(req);
      const item=db.links.find(x=>x.id===String(b.id||""));
      if(!item) return sendJson(res,404,{error:"not found"});
      item.progress=Math.max(0,Math.min(100,Number(b.progress)||0));
      if(b.status) item.status=String(b.status);
      if(b.error) item.error=String(b.error);
      if(item.status==="downloaded") item.progress=100;
      saveDb();
      return sendJson(res,200,{ok:true});
    }

    return sendJson(res,404,{error:"not found"});
  }catch(err){
    console.error(err);
    return sendJson(res,err.statusCode||500,{error:err.statusCode===400?"invalid_json":"server_error",message:err.message});
  }
});

server.listen(PORT,HOST,()=>{
  console.log("Kadad File Downloader running on http://0.0.0.0:"+PORT+"/admin");
});
