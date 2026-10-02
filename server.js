const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = 3000;
const HOST = "0.0.0.0";
const DATA = path.join(__dirname, "kadad-data.json");

const DEFAULT = {
  admin: { user: "admin", pass: "admin" },
  clientPass: "admin",
  links: [],
  clients: {},
  commands: []
};

function load() {
  if (!fs.existsSync(DATA)) return structured(DEFAULT);
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return structured(DEFAULT); }
}
function structured(x) { return JSON.parse(JSON.stringify(x)); }
let db = load();
function save() { fs.writeFileSync(DATA, JSON.stringify(db, null, 2)); }
function id() { return crypto.randomBytes(12).toString("hex"); }
function json(res, code, data) {
  const s = JSON.stringify(data);
  res.writeHead(code, {"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"});
  res.end(s);
}
function body(req) {
  return new Promise((resolve,reject)=>{
    let s=""; req.on("data",c=>s+=c); req.on("end",()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}}); req.on("error",reject);
  });
}
function cleanFolder(v) {
  return String(v||"").replace(/\\/g,"/").split("/").filter(x=>x && x!=="." && x!=="..").join("/");
}
function safeName(v) {
  return String(v||"download").replace(/[<>:"/\\|?*\x00-\x1F]/g,"_").trim() || "download";
}
function authAdmin(req) {
  return req.headers["x-admin-token"] && db.adminSessions && db.adminSessions[req.headers["x-admin-token"]];
}
function authClient(req) {
  return String(req.headers["x-client-password"]||"") === String(db.clientPass);
}
db.adminSessions ||= {};

const HTML = String.raw`<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kadad File Downloader</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap');
*{box-sizing:border-box}body{margin:0;font-family:Vazirmatn,sans-serif;color:#fff;background:radial-gradient(circle at 10% 10%,#203a62,transparent 35%),radial-gradient(circle at 90% 90%,#4b235f,transparent 35%),#080b12;min-height:100vh}
.wrap{width:min(1100px,calc(100% - 28px));margin:35px auto}.glass{background:#ffffff0d;border:1px solid #ffffff18;box-shadow:0 25px 80px #0007;backdrop-filter:blur(25px);border-radius:24px}.login{max-width:420px;margin:90px auto;padding:30px}
h1{margin:0 0 8px}h2{margin-top:0}.card{padding:24px;margin-top:18px}.head{padding:24px;display:flex;justify-content:space-between;align-items:center;gap:15px}
input{width:100%;padding:13px 15px;margin:6px 0;border:1px solid #ffffff18;border-radius:14px;background:#0005;color:#fff;font:inherit;outline:0}button{border:0;border-radius:13px;padding:10px 15px;color:#fff;background:#ffffff14;font:inherit;cursor:pointer}button:hover{background:#ffffff25}.primary{background:#2563eb}.danger{background:#b91c1c}.green{background:#15803d}.muted{opacity:.65;font-size:13px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.link{padding:17px;background:#0003;border-radius:18px;margin:10px 0}.grow{flex:1;min-width:220px}.url{direction:ltr;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.55;font-size:12px}.bar{height:8px;background:#ffffff15;border-radius:20px;overflow:hidden;width:180px}.fill{height:100%;background:#3b82f6}.hidden{display:none!important}.modal{position:fixed;inset:0;background:#000b;display:flex;align-items:center;justify-content:center;padding:18px}.modalbox{width:min(620px,100%);padding:24px;max-height:85vh;overflow:auto}.folders{max-height:390px;overflow:auto;margin:10px 0}.folder{padding:11px;border-radius:11px;cursor:pointer}.folder:hover,.folder.sel{background:#2563eb55}.tag{padding:5px 9px;border-radius:20px;background:#ffffff12;font-size:12px}
</style></head><body>
<div id="login" class="wrap"><div class="glass login"><h1>📦 Kadad File Downloader</h1><p class="muted">پنل مدیریت</p><input id="u" value="admin" placeholder="نام کاربری"><input id="p" type="password" placeholder="رمز عبور"><button class="primary" onclick="login()">ورود</button><p id="err"></p></div></div>
<div id="app" class="wrap hidden">
<div class="glass head"><div><h1>📦 Kadad File Downloader</h1><span id="status" class="muted">در حال بررسی کلاینت...</span></div><button onclick="logout()">خروج</button></div>
<div class="glass card"><h2>➕ اضافه کردن لینک</h2><div id="inputs"></div><div class="row"><button onclick="addInput()">+ اضافه لینک</button><button class="primary" onclick="addLinks()">افزودن لینک‌ها</button></div></div>
<div class="glass card"><h2>📥 صف دانلود</h2><div id="links"></div></div>
<div class="glass card"><h2>⚙️ رمزها</h2><input id="old" type="password" placeholder="رمز فعلی admin"><input id="newa" type="password" placeholder="رمز جدید admin"><input id="newc" type="password" placeholder="رمز جدید client"><button class="primary" onclick="passwords()">ذخیره</button></div>
</div>
<div id="modal" class="modal hidden"><div class="glass modalbox"><h2>📁 انتخاب فولدر</h2><div class="row"><button onclick="newFolder()">+ ساخت فولدر</button><button class="danger" onclick="deleteFolder()">حذف فولدر</button></div><div id="folders" class="folders"></div><div class="row"><button onclick="closeModal()">لغو</button><button class="primary" onclick="pickFolder()">انتخاب این فولدر</button></div></div></div>
<script>
let token=localStorage.kfd||"", pickedRow=null, currentFolder="";
const H=()=>({"Content-Type":"application/json","x-admin-token":token});
const esc=s=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
async function login(){let r=await fetch("/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({user:u.value,pass:p.value})}),d=await r.json();if(!r.ok){err.textContent="ورود ناموفق بود";return}token=d.token;localStorage.kfd=token;start()}
function start(){loginPage(false);load();setInterval(load,1000);setInterval(client,5000)}
function loginPage(x){document.getElementById("login").classList.toggle("hidden",!x);document.getElementById("app").classList.toggle("hidden",x)}
function addInput(){let d=document.createElement("div");d.className="row inputrow";d.dataset.folder="";d.style.marginTop="8px";d.innerHTML='<input class="grow urlin" placeholder="https://example.com/file.mp3"><button onclick="choose(this)">📁 انتخاب فولدر</button><span class="tag fld">received</span>';document.getElementById("inputs").appendChild(d)}
function init(){addInput()}
async function choose(b){pickedRow=b.closest(".inputrow");currentFolder=pickedRow.dataset.folder||"";await showFolders()}
async function showFolders(){let r=await fetch("/api/admin/folders",{headers:H()});if(!r.ok)return;let d=await r.json();folders.innerHTML="";let root=document.createElement("div");root.className="folder "+(!currentFolder?"sel":"");root.textContent="📁 received";root.onclick=()=>{currentFolder="";document.querySelectorAll(".folder").forEach(x=>x.classList.remove("sel"));root.classList.add("sel")};folders.appendChild(root);(d.folders||[]).forEach(f=>{let x=document.createElement("div");x.className="folder "+(f===currentFolder?"sel":"");x.textContent="📁 received/"+f;x.onclick=()=>{currentFolder=f;document.querySelectorAll(".folder").forEach(y=>y.classList.remove("sel"));x.classList.add("sel")};folders.appendChild(x)});modal.classList.remove("hidden")}
function closeModal(){modal.classList.add("hidden")}
function pickFolder(){if(pickedRow){pickedRow.dataset.folder=currentFolder;pickedRow.querySelector(".fld").textContent=currentFolder?"📁 "+currentFolder:"received"}closeModal()}
async function newFolder(){let n=prompt("نام فولدر جدید:");if(!n)return;await fetch("/api/admin/folders",{method:"POST",headers:H(),body:JSON.stringify({folder:(currentFolder?currentFolder+"/":"")+n})});await showFolders()}
async function deleteFolder(){if(!currentFolder)return alert("فولدر اصلی قابل حذف نیست");if(!confirm("حذف شود؟"))return;await fetch("/api/admin/folders",{method:"DELETE",headers:H(),body:JSON.stringify({folder:currentFolder})});currentFolder="";await showFolders()}
async function addLinks(){for(const r of document.querySelectorAll(".inputrow")){let url=r.querySelector(".urlin").value.trim();if(url)await fetch("/api/admin/links",{method:"POST",headers:H(),body:JSON.stringify({url,folder:r.dataset.folder||""})})}document.getElementById("inputs").innerHTML="";init();load()}
async function load(){let r=await fetch("/api/admin/links",{headers:H()});if(r.status===401)return logout();let a=await r.json();links.innerHTML=a.map(x=>{let s=x.status==="downloaded"?'<span style="color:#4ade80">دانلود شده</span>':x.status==="queued"||x.status==="downloading"?'<div class="bar"><div class="fill" style="width:'+x.progress+'%"></div></div> '+x.progress+'%':'<button class="primary" onclick="dl(\''+x.id+'\')">دانلود</button>';return '<div class="link"><div class="row"><div class="grow"><b>'+esc(x.name)+'</b><div class="url">'+esc(x.url)+'</div><div class="muted">📁 '+esc(x.folder||"received")+'</div></div><div>'+s+'</div><button class="danger" onclick="del(\''+x.id+'\')">حذف</button></div></div>'}).join("")}
async function dl(id){await fetch("/api/admin/links/"+id+"/download",{method:"POST",headers:H()});load()}
async function del(id){if(confirm("حذف شود؟")){await fetch("/api/admin/links/"+id,{method:"DELETE",headers:H()});load()}}
async function client(){let r=await fetch("/api/admin/client",{headers:H()});if(r.ok){let d=await r.json();status.textContent=d.online?"🟢 کلاینت متصل است":"🔴 کلاینت آفلاین"}}
async function passwords(){let r=await fetch("/api/admin/passwords",{method:"POST",headers:H(),body:JSON.stringify({old:old.value,admin:newa.value,client:newc.value})});alert(r.ok?"ذخیره شد":"رمز فعلی اشتباه است")}
async function logout(){localStorage.removeItem("kfd");location.reload()}
init();if(token)start();
</script></body></html>`;

function sendFile(res) { res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(HTML);}

const server=http.createServer(async(req,res)=>{
  try {
    const u=new URL(req.url,"http://localhost");
    if(req.method==="OPTIONS"){res.writeHead(204);return res.end();}
    if(req.method==="GET" && u.pathname==="/admin") return sendFile(res);

    if(req.method==="POST" && u.pathname==="/admin/login"){
      const b=await body(req);
      if(b.user===db.admin.user && b.pass===db.admin.pass){
        const t=id();db.adminSessions[t]=Date.now();save();return json(res,200,{token:t});
      }
      return json(res,401,{error:"invalid"});
    }
    if(req.method==="POST" && u.pathname==="/admin/logout"){return json(res,200,{ok:true});}
    if(u.pathname.startsWith("/api/admin") && !authAdmin(req)) return json(res,401,{error:"unauthorized"});

    if(req.method==="GET" && u.pathname==="/api/admin/links") return json(res,200,db.links);
    if(req.method==="GET" && u.pathname==="/api/admin/client"){
      const c=db.clients.main||{};return json(res,200,{online:!!c.lastSeen&&Date.now()-c.lastSeen<30000,lastSeen:c.lastSeen,folders:c.folders||[]});
    }
    if(req.method==="GET" && u.pathname==="/api/admin/folders"){
      return json(res,200,{folders:(db.clients.main&&db.clients.main.folders)||[]});
    }
    if(req.method==="POST" && u.pathname==="/api/admin/folders"){
      const b=await body(req), f=cleanFolder(b.folder); if(f&&!db.commands.find(x=>x.type==="mkdir"&&x.folder===f))db.commands.push({id:id(),type:"mkdir",folder:f});save();return json(res,200,{ok:true});
    }
    if(req.method==="DELETE" && u.pathname==="/api/admin/folders"){
      const b=await body(req),f=cleanFolder(b.folder);db.commands.push({id:id(),type:"rmdir",folder:f});save();return json(res,200,{ok:true});
    }
    if(req.method==="POST" && u.pathname==="/api/admin/links"){
      const b=await body(req);let url=String(b.url||"");try{let x=new URL(url);if(!["http:","https:"].includes(x.protocol))throw 0}catch{return json(res,400,{error:"bad url"})}
      let name=safeName(path.basename(new URL(url).pathname)||"download");
      db.links.push({id:id(),url,name,folder:cleanFolder(b.folder),status:"waiting",progress:0,error:null,createdAt:Date.now()});save();return json(res,200,{ok:true});
    }
    if(req.method==="POST" && u.pathname.match(/^\/api\/admin\/links\/[^/]+\/download$/)){
      const x=db.links.find(a=>a.id===u.pathname.split("/")[4]);if(!x)return json(res,404,{error:"not found"});x.status="queued";x.progress=0;x.error=null;save();return json(res,200,{ok:true});
    }
    if(req.method==="DELETE" && u.pathname.match(/^\/api\/admin\/links\/[^/]+$/)){
      const i=db.links.findIndex(a=>a.id===u.pathname.split("/")[4]);if(i<0)return json(res,404,{error:"not found"});db.links.splice(i,1);save();return json(res,200,{ok:true});
    }
    if(req.method==="POST" && u.pathname==="/api/admin/passwords"){
      const b=await body(req);if(b.old!==db.admin.pass)return json(res,400,{error:"bad password"});if(b.admin)db.admin.pass=String(b.admin);if(b.client)db.clientPass=String(b.client);save();return json(res,200,{ok:true});
    }

    if(u.pathname.startsWith("/api/v1") && !authClient(req)) return json(res,401,{error:"client unauthorized"});
    if(req.method==="GET" && u.pathname==="/api/v1"){
      db.clients.main ||= {};db.clients.main.lastSeen=Date.now();db.clients.main.folders||=[];
      const out=db.links.filter(x=>x.status==="queued"||x.status==="downloading").map(x=>({id:x.id,url:x.url,name:x.name,folder:x.folder}));
      save();return json(res,200,out);
    }
    if(req.method==="POST" && u.pathname==="/api/v1/heartbeat"){
      const b=await body(req);db.clients.main={lastSeen:Date.now(),folders:Array.isArray(b.folders)?b.folders:[]};save();return json(res,200,{ok:true,commands:db.commands});
    }
    if(req.method==="POST" && u.pathname==="/api/v1/command-done"){
      const b=await body(req);db.commands=db.commands.filter(x=>x.id!==b.id);save();return json(res,200,{ok:true});
    }
    if(req.method==="POST" && u.pathname==="/api/v1/progress"){
      const b=await body(req),x=db.links.find(a=>a.id===b.id);if(!x)return json(res,404,{error:"not found"});x.progress=Math.max(0,Math.min(100,Number(b.progress)||0));if(b.status)x.status=b.status;if(b.error)x.error=b.error;if(x.status==="downloaded")x.progress=100;save();return json(res,200,{ok:true});
    }
    return json(res,404,{error:"not found"});
  } catch(e){console.error(e);return json(res,500,{error:e.message});}
});
server.listen(PORT,HOST,()=>console.log("Kadad File Downloader: http://0.0.0.0:"+PORT+"/admin"));
