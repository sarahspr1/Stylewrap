import { useState, useRef, useEffect, Component } from "react";
import { analyseOutfit } from "./analyseOutfit.js";
import { createClient } from "@supabase/supabase-js";

const _sbUrl = import.meta.env.VITE_SUPABASE_URL || "";
const _sbKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(_sbUrl, _sbKey);

// One session ID per browser tab — resets when the tab is closed.
const _sessionId = (() => {
  const key = "sw_session_id";
  let id = sessionStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(key, id); }
  return id;
})();

// Sync an outfit and its items to the normalized outfits / wardrobe_items / outfit_items tables.
// Runs in the background after photo analysis — does not block the UI.
async function syncOutfit(userId, dateKey, photoUrl, style, season, items) {
  // 1. Upsert the outfit row (one per user per date)
  const { data: outfit, error: outfitErr } = await supabase
    .from("outfits")
    .upsert(
      { user_id: userId, date_key: dateKey, photo_url: photoUrl, occasion: style, weather: season },
      { onConflict: "user_id,date_key" }
    )
    .select("id")
    .single();
  if (outfitErr) { console.error("[syncOutfit]", outfitErr.message); return; }

  // 2. Upsert each clothing item into wardrobe_items
  //    Use a generated UUID per item based on user+name+category to avoid duplicates
  const itemRows = items.map(item => ({
    user_id: userId,
    category: item.category || "Other",
    color: item.color || null,
    photo_url: item.itemPhoto || null,
    thumbnail_url: item.itemPhoto || null,
    notes: item.name || null,
  }));

  const wardrobeIds = [];
  for (const row of itemRows) {
    const { data: wi, error: wiErr } = await supabase
      .from("wardrobe_items")
      .insert(row)
      .select("id")
      .single();
    if (wiErr) { console.error("[syncOutfit wardrobe_item]", wiErr.message); wardrobeIds.push(null); }
    else wardrobeIds.push(wi.id);
  }

  // 3. Delete existing outfit_items and re-insert with real wardrobe item IDs
  await supabase.from("outfit_items").delete().eq("outfit_id", outfit.id);
  const outfitItemRows = wardrobeIds
    .map((itemId, i) => itemId ? ({ outfit_id: outfit.id, item_id: itemId, crop_url: items[i]?.itemPhoto || null, position: i }) : null)
    .filter(Boolean);
  if (outfitItemRows.length > 0) {
    const { error: oiErr } = await supabase.from("outfit_items").insert(outfitItemRows);
    if (oiErr) console.error("[syncOutfit outfit_items]", oiErr.message);
  }
}

// Track a user event directly to Supabase user_events table.
async function track(eventName, properties = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const { error } = await supabase.from("user_events").insert({
    user_id: session.user.id,
    session_id: _sessionId,
    event_name: eventName,
    properties,
    platform: "web",
  });
  if (error) console.error("[track]", eventName, error.message);
}

// Remove background via remove.bg API, composite onto white canvas, return JPEG data-URL.
// Throws with a descriptive message on failure so the caller can show a toast.
async function removeBackground(base64){
  const key=import.meta.env.VITE_REMOVEBG_KEY;
  console.log("[removeBG] key present:", !!key);
  if(!key) throw new Error("No VITE_REMOVEBG_KEY set");
  const fd=new FormData();
  fd.append("image_file_b64",base64);
  fd.append("size","auto");
  fd.append("type","person");
  const res=await fetch("https://api.remove.bg/v1.0/removebg",{
    method:"POST",
    headers:{"X-Api-Key":key},
    body:fd,
  });
  console.log("[removeBG] status:", res.status);
  if(!res.ok){
    const body=await res.text().catch(()=>"");
    console.error("[removeBG] error body:", body);
    throw new Error(`remove.bg ${res.status}: ${body.slice(0,200)}`);
  }
  const blob=await res.blob();
  console.log("[removeBG] blob size:", blob.size, "type:", blob.type);
  // Use FileReader instead of createObjectURL for better mobile/browser compatibility
  const pngDataUrl=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=e=>resolve(e.target.result);
    reader.onerror=()=>reject(new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
  return await new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      const c=document.createElement("canvas");
      c.width=img.width; c.height=img.height;
      const ctx=c.getContext("2d");
      ctx.fillStyle="#FFFFFF";
      ctx.fillRect(0,0,c.width,c.height);
      ctx.drawImage(img,0,0);
      console.log("[removeBG] done, canvas size:", c.width, c.height);
      resolve(c.toDataURL("image/jpeg",0.92));
    };
    img.onerror=()=>reject(new Error("PNG image failed to load"));
    img.src=pngDataUrl;
  });
}

// Compress an image data-URL to a JPEG of max 800 px on the longest side.
// Reduces a typical phone photo from 3–8 MB down to ~50–150 KB.
function compressImage(dataUrl, maxPx=800, quality=0.75){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const ratio=Math.min(maxPx/img.width, maxPx/img.height, 1);
      const canvas=document.createElement("canvas");
      canvas.width=Math.round(img.width*ratio);
      canvas.height=Math.round(img.height*ratio);
      canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
      resolve(canvas.toDataURL("image/jpeg",quality));
    };
    img.src=dataUrl;
  });
}

// Upload a photo file to Supabase Storage and return its public URL.
// Photos are stored as files (not base64 in the DB), so they scale without limit.
async function uploadPhoto(blob, dateKey){
  const { data:{ session } } = await supabase.auth.getSession();
  if(!session) return null;
  const path = `${session.user.id}/${dateKey}.jpg`;
  const { error } = await supabase.storage
    .from("outfit-photos")
    .upload(path, blob, { upsert:true, contentType:"image/jpeg" });
  if(error){ console.error("[uploadPhoto]",error); return null; }
  return supabase.storage.from("outfit-photos").getPublicUrl(path).data.publicUrl;
}

// Crop a single clothing item from a bg-removed outfit image using AI-provided bbox.
// bbox: { x, y, w, h } — all fractions of image dimensions (0.0–1.0)
function cropItemPhoto(dataUrl, bbox) {
  if (!bbox || typeof bbox.x !== "number" || bbox.w <= 0.01 || bbox.h <= 0.01) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const pad = 0.04;
      const x = Math.max(0, bbox.x - pad) * img.width;
      const y = Math.max(0, bbox.y - pad) * img.height;
      const w = Math.min(img.width - x, (bbox.w + pad * 2) * img.width);
      const h = Math.min(img.height - y, (bbox.h + pad * 2) * img.height);
      if (w < 20 || h < 20) { resolve(null); return; }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// Upload a single cropped item photo to Supabase Storage.
async function uploadItemPhoto(dataUrl, dateKey, idx) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const blob = await fetch(dataUrl).then(r => r.blob());
  const path = `${session.user.id}/${dateKey}_item${idx}.jpg`;
  const { error } = await supabase.storage.from("outfit-photos").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) return null;
  return supabase.storage.from("outfit-photos").getPublicUrl(path).data.publicUrl + "?t=" + Date.now();
}

class ErrorBoundary extends Component {
  constructor(props){ super(props); this.state={ error:null }; }
  static getDerivedStateFromError(e){ return { error:e }; }
  render(){
    if(this.state.error) return (
      <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,background:"#fff" }}>
        <div style={{ fontSize:40,marginBottom:16 }}>⚠️</div>
        <div style={{ fontSize:16,fontWeight:700,color:"#3A4438",marginBottom:8,textAlign:"center" }}>Something went wrong</div>
        <div style={{ fontSize:13,color:"rgba(58,68,56,0.65)",textAlign:"center",marginBottom:24 }}>{""+this.state.error}</div>
        <button onClick={()=>this.setState({error:null})} style={{ padding:"10px 24px",borderRadius:0,border:"none",background:"#5E6A5C",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Try Again</button>
      </div>
    );
    return this.props.children;
  }
}
import { Home, Shirt, Calendar, CalendarDays, Heart, User, ChevronLeft, ChevronRight, ChevronDown, Camera, Plus, Trash2, Pencil, Search, TrendingUp, Palette, Layers, X, Bell, Shield, Phone, LogOut, Check, DollarSign, Tag, Wind, Gem, Waves, AtSign } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

function CatIcon({ cat, size=12, color="rgba(58,68,56,0.4)" }){
  const p={size,color,strokeWidth:1.5};
  if(cat==="Top")         return <Shirt {...p}/>;
  if(cat==="Bottom")      return <Layers {...p}/>;
  if(cat==="Outerwear")   return <Wind {...p}/>;
  if(cat==="Shoes")       return <Tag {...p}/>;
  if(cat==="Accessories") return <Gem {...p}/>;
  if(cat==="Dresses")     return <Shirt {...p}/>;
  if(cat==="Swimwear")    return <Waves {...p}/>;
  return <Shirt {...p}/>;
}

const C = {
  sage: "#5E6A5C", green: "#5E6A5C", blush: "#D3C2B2", blushD: "#B89A8A",
  surface: "#FFFFFF", white: "#FFFFFF", ink: "#3A4438", sub: "rgba(58,68,56,0.65)",
  border: "rgba(58,68,56,0.3)", red: "#E5635A",
};

const colorKeywords = { "Black":["black","dark","charcoal"],"White":["white","off-white","optic white"],"Cream":["cream","ivory","butter","ecru","eggshell","off white"],"Beige":["beige","khaki","sand","stone","oat","nude","taupe","camel","tan"],"Navy":["navy","dark blue","midnight blue"],"Blue":["blue","denim","teal","cobalt","sky blue","light blue"],"Gray":["gray","grey","slate","silver"],"Brown":["brown","chocolate","cognac","rust","terracotta"],"Green":["green","olive","sage","khaki green","forest","emerald"],"Red":["red","burgundy","wine","crimson","scarlet"],"Yellow":["yellow","gold","mustard","lemon","amber"],"Pink":["pink","blush","salmon","rose","hot pink","mauve"],"Purple":["purple","violet","lavender","lilac"] };
const colorHex = { "Black":"#1A1A1A","White":"#E8E8E8","Cream":"#F5F0E8","Beige":"#D4C5A9","Navy":"#1B2A4A","Blue":"#5E6A5C","Gray":"#9E9E9E","Brown":"#8B6347","Green":"#6B9B6B","Red":"#C45A5A","Yellow":"#D4B84A","Pink":"#D4888A","Purple":"#8A7AB5" };
const toColors = c => Array.isArray(c) ? c.filter(Boolean) : (c ? [c] : []);

// Map a free-form AI color string to the nearest known colorHex key.
// Returns null if nothing matches.
function normalizeAiColor(raw) {
  if (!raw || typeof raw !== "string") return null;
  const known = Object.keys(colorHex);
  // Exact match (case-insensitive)
  const lower = raw.toLowerCase().trim();
  const exact = known.find(k => k.toLowerCase() === lower);
  if (exact) return exact;
  // Keyword match against colorKeywords map
  for (const [colorName, keywords] of Object.entries(colorKeywords)) {
    if (keywords.some(kw => lower.includes(kw))) return colorName;
  }
  // Partial match: known color name appears inside the raw string
  const partial = known.find(k => lower.includes(k.toLowerCase()));
  if (partial) return partial;
  return null;
}

function CameraCapture({ onCapture, onClose }) {
  const videoRef=useRef(null);
  const [stream,setStream]=useState(null);
  const [facing,setFacing]=useState("environment");
  const [error,setError]=useState("");
  const [ready,setReady]=useState(false);

  useEffect(()=>{
    let s;
    setReady(false); setError("");
    navigator.mediaDevices.getUserMedia({ video:{ facingMode:facing },audio:false })
      .then(st=>{
        s=st; setStream(st);
        if(videoRef.current){ videoRef.current.srcObject=st; }
      })
      .catch(()=>setError("Could not access camera. Please allow camera access in your browser or device settings."));
    return ()=>{ s?.getTracks().forEach(t=>t.stop()); };
  },[facing]);

  const handleCapture=()=>{
    const video=videoRef.current;
    if(!video||!ready) return;
    const canvas=document.createElement("canvas");
    canvas.width=video.videoWidth; canvas.height=video.videoHeight;
    canvas.getContext("2d").drawImage(video,0,0);
    const dataUrl=canvas.toDataURL("image/jpeg",0.92);
    stream?.getTracks().forEach(t=>t.stop());
    onCapture(dataUrl);
  };

  return (
    <div style={{ position:"fixed",inset:0,background:"#000",zIndex:10000,display:"flex",flexDirection:"column" }}>
      {error?(
        <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32 }}>
          <div style={{ fontSize:48,marginBottom:16 }}>📷</div>
          <p style={{ color:"#fff",textAlign:"center",fontSize:15,lineHeight:1.6,marginBottom:28 }}>{error}</p>
          <button onClick={onClose} style={{ padding:"12px 32px",borderRadius:0,border:"none",background:C.sage,color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Go Back</button>
        </div>
      ):(
        <>
          <video ref={videoRef} autoPlay playsInline muted onCanPlay={()=>setReady(true)} style={{ flex:1,width:"100%",objectFit:"cover",background:"#000" }}/>
          <div style={{ background:"rgba(58,68,56,0.3)",padding:"20px 32px 36px",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
            <button onClick={onClose} style={{ width:52,height:52,borderRadius:"50%",background:"rgba(255,255,255,.15)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0 }}><X size={22} color="#fff"/></button>
            <button onClick={handleCapture} disabled={!ready} style={{ width:76,height:76,borderRadius:"50%",background:ready?"#fff":"#888",border:`4px solid ${ready?"rgba(255,255,255,.5)":"#666"}`,cursor:ready?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0 }}>
              <div style={{ width:60,height:60,borderRadius:"50%",background:ready?"#fff":"#888",border:"2.5px solid #ddd" }}/>
            </button>
            <button onClick={()=>{ stream?.getTracks().forEach(t=>t.stop()); setStream(null); setFacing(f=>f==="environment"?"user":"environment"); }} style={{ width:52,height:52,borderRadius:"50%",background:"rgba(255,255,255,.15)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:24,flexShrink:0 }}>🔄</button>
          </div>
        </>
      )}
    </div>
  );
}

function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"flex-end" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:0,width:"100%",maxHeight:"92vh",overflow:"auto",padding:"8px 20px 44px",animation:"slideUp .28s cubic-bezier(.32,.72,0,1)" }}>
        <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 16px" }} />
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
          <h2 style={{ fontSize:22,fontWeight:900,color:C.ink,margin:0,letterSpacing:"-0.02em" }}>{title}</h2>
          <button onClick={onClose} style={{ width:32,height:32,borderRadius:"50%",border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><X size={17} color={C.sub}/></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PrimaryBtn({ children, onClick, disabled, style:s={} }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ width:"100%",height:52,borderRadius:8,border:"none",background:disabled?C.border:C.ink,color:disabled?C.sub:"#fff",fontSize:16,fontWeight:600,cursor:disabled?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"inherit",...s }}>
      {children}
    </button>
  );
}

function DangerBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{ width:"100%",height:52,borderRadius:0,border:`2px solid ${C.red}`,background:"transparent",color:C.red,fontSize:16,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"inherit" }}>
      {children}
    </button>
  );
}

function StatCard({ icon, number, label, accent=C.sage, onClick }) {
  const El = onClick ? "button" : "div";
  return (
    <El onClick={onClick} style={{ flex:1,background:C.white,borderRadius:0,padding:16,border:`1px solid ${C.border}`,cursor:onClick?"pointer":"default",textAlign:"left",fontFamily:"inherit" }}>
      <div style={{ width:38,height:38,borderRadius:0,background:accent+"18",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:10 }}>{icon}</div>
      <div style={{ fontSize:26,fontWeight:900,color:C.ink,lineHeight:1,letterSpacing:"-0.02em" }}>{number}</div>
      <div style={{ fontSize:12,color:C.sub,marginTop:4 }}>{label}</div>
    </El>
  );
}


function TabBar({ active, onChange }) {
  const tabs=[{ id:"home",label:"Home",icon:Home },{ id:"wardrobe",label:"Wardrobe",icon:Shirt },{ id:"calendar",label:"Calendar",icon:CalendarDays },{ id:"favorites",label:"Favorites",icon:Heart },{ id:"profile",label:"Profile",icon:User }];
  return (
    <div style={{ height:83,background:C.white,borderTop:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-around",paddingBottom:20,flexShrink:0 }}>
      {tabs.map(({ id,label,icon:Icon })=>{
        const a=active===id;
        return <button key={id} onClick={()=>onChange(id)} style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:3,minWidth:56,border:"none",background:"transparent",cursor:"pointer",padding:"4px 2px",borderRadius:0 }}>
          {a
            ? <div style={{ display:"flex",alignItems:"center",gap:5,background:C.ink,borderRadius:99,padding:"5px 12px" }}><Icon size={16} color="#fff" strokeWidth={1.5}/><span style={{ fontSize:10,fontWeight:700,color:"#fff",letterSpacing:"0.05em",textTransform:"uppercase",whiteSpace:"nowrap" }}>{label}</span></div>
            : <><Icon size={20} color="rgba(58,68,56,0.4)" strokeWidth={1.5}/><span style={{ fontSize:10,fontWeight:600,color:"rgba(58,68,56,0.4)",letterSpacing:"0.05em",textTransform:"uppercase" }}>{label}</span></>
          }
        </button>;
      })}
    </div>
  );
}

function HomeScreen({ photoData={}, favourites=[], onShowAllItems, onGoToFavorites, onAddItem, userEmail="", username="" }) {
  const now=new Date();
  const dayName=now.toLocaleDateString("en-US",{weekday:"long"});
  const monthName=now.toLocaleDateString("en-US",{month:"short"});
  const dateLabel=`${dayName}, ${monthName} ${now.getDate()}`;
  const firstName=userEmail?(userEmail.split("@")[0].replace(/[._-]/g," ").replace(/\b\w/g,c=>c.toUpperCase()).split(" ")[0]):"";

  // Streak / last-logged
  const toKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const todayKey=toKey(now);
  const loggedToday=!!(photoData[todayKey]?.logged);
  const allLoggedKeys=Object.keys(photoData).filter(k=>photoData[k]?.logged).sort().reverse();
  const lastLoggedKey=allLoggedKeys[0];
  let streakLabel="";
  if(loggedToday){ streakLabel="Outfit logged today"; }
  else if(lastLoggedKey){
    const [y,m,d]=lastLoggedKey.split("-").map(Number);
    const diff=Math.round((now-new Date(y,m-1,d))/(1000*60*60*24));
    streakLabel=diff===1?"Last outfit: yesterday":`Last outfit: ${diff} days ago`;
  }

  // Compute most worn colour this month
  const curY=now.getFullYear(), curM=now.getMonth()+1;
  const monthItems=Object.entries(photoData)
    .filter(([key,e])=>{ if(!e?.logged) return false; const [y,m]=key.split("-").map(Number); return y===curY&&m===curM; })
    .flatMap(([,e])=>(e.items||[]).map(item=>typeof item==="object"?item:{ name:String(item||""),category:"Other" }).filter(item=>item&&item.name&&typeof item.name==="string"));
  const mColorCounts={};
  monthItems.forEach(item=>{ const cols=toColors(item.color).filter(c=>colorHex[c]); if(cols.length){ cols.forEach(c=>{ mColorCounts[c]=(mColorCounts[c]||0)+1; }); } else { let col=null; const n=(item.name||"").toLowerCase(); for(const [c,kws] of Object.entries(colorKeywords)){ if(kws.some(kw=>n.includes(kw))){ col=c; break; } } mColorCounts[col||"Other"]=(mColorCounts[col||"Other"]||0)+1; } });
  const top3Colors=Object.entries(mColorCounts).filter(([k])=>k!=="Other").sort((a,b)=>b[1]-a[1]).slice(0,3);

  const hasAnyOutfits=allLoggedKeys.length>0;

  return (
    <div style={{ flex:1,overflowY:"auto",background:"#fff" }}>
      {/* Header */}
      <div style={{ background:"#fff",padding:"28px 24px 20px" }}>
        <p style={{ fontSize:12,color:C.sub,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",margin:"0 0 8px" }}>{dateLabel}</p>
        <h1 style={{ fontSize:34,fontWeight:900,color:C.ink,margin:"0 0 8px",lineHeight:1.1,letterSpacing:"-0.03em" }}>Hello{username?`, ${username}`:firstName?`, ${firstName}`:""}!</h1>
        {streakLabel
          ? <div style={{ display:"inline-flex",alignItems:"center",gap:6 }}>
              {loggedToday?<Check size={14} color={C.sage} strokeWidth={2.5}/>:<CalendarDays size={14} color={C.sub} strokeWidth={1.5}/>}
              <span style={{ fontSize:13,fontWeight:600,color:loggedToday?C.sage:C.sub }}>{streakLabel}</span>
            </div>
          : <p style={{ fontSize:13,color:C.sub,margin:0 }}>Ready to plan today's look?</p>}
      </div>

      {/* Stats row */}
      <div style={{ borderTop:"1px solid rgba(58,68,56,0.3)",borderBottom:"1px solid rgba(58,68,56,0.3)" }}>
        {!hasAnyOutfits?(
          <div style={{ padding:"32px 24px",textAlign:"center" }}>
            <div style={{ display:"flex",justifyContent:"center",marginBottom:14 }}><Shirt size={44} color={C.sub} strokeWidth={1}/></div>
            <h2 style={{ fontSize:18,fontWeight:900,color:C.ink,margin:"0 0 6px",letterSpacing:"-0.02em" }}>Start tracking your style</h2>
            <p style={{ fontSize:13,color:C.sub,margin:"0 0 20px",lineHeight:1.6 }}>Log your first outfit to unlock wardrobe stats, colour trends, and cost-per-wear tracking.</p>
            <button onClick={onAddItem} style={{ height:48,padding:"0 24px",borderRadius:0,border:"none",background:C.ink,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Log First Outfit</button>
          </div>
        ):(
          <div style={{ display:"flex" }}>
            <div style={{ flex:1,padding:"20px 24px" }}>
              {top3Colors.length===0
                ? <div style={{ display:"flex",alignItems:"center",height:36,marginBottom:10 }}><Palette size={20} color={C.sub} strokeWidth={1.5}/></div>
                : <div style={{ display:"flex",gap:5,marginBottom:10 }}>
                    {top3Colors.map(([name])=>(
                      <div key={name} style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3 }}>
                        <div style={{ width:"100%",height:26,background:colorHex[name],border:(name==="White"||name==="Cream")?`1px solid ${C.border}`:"none" }}/>
                        <div style={{ fontSize:8,fontWeight:700,color:C.ink,textAlign:"center",lineHeight:1.2 }}>{name}</div>
                      </div>
                    ))}
                  </div>
              }
              <div style={{ fontSize:11,fontWeight:700,color:C.sub,letterSpacing:"0.06em",textTransform:"uppercase" }}>Palette of Month</div>
            </div>
            <div style={{ width:1,background:"rgba(58,68,56,0.3)",flexShrink:0 }}/>
            <button onClick={onGoToFavorites} style={{ flex:1,padding:"20px 24px",background:"transparent",border:"none",textAlign:"left",cursor:"pointer",fontFamily:"inherit" }}>
              <div style={{ fontSize:36,fontWeight:900,color:C.ink,letterSpacing:"-0.04em",lineHeight:1,marginBottom:6 }}>{favourites.length}</div>
              <div style={{ fontSize:11,fontWeight:700,color:C.sub,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:6 }}>Favourites</div>
              <div style={{ fontSize:12,fontWeight:700,color:C.ink,textDecoration:"underline",textUnderlineOffset:3 }}>View all →</div>
            </button>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div style={{ padding:"20px 24px",borderBottom:"1px solid rgba(58,68,56,0.3)" }}>
        <div style={{ fontSize:12,fontWeight:700,color:C.sub,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:14 }}>Quick Actions</div>
        <div style={{ display:"flex",gap:10 }}>
          <button onClick={onAddItem} style={{ flex:1,height:52,borderRadius:0,border:"1px solid rgba(58,68,56,0.3)",background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer",fontFamily:"inherit" }}><Camera size={16} color={C.ink} strokeWidth={1.5}/><span style={{ fontSize:14,fontWeight:700,color:C.ink }}>Log Outfit</span></button>
          <button onClick={onShowAllItems} style={{ flex:1,height:52,borderRadius:0,border:"1px solid rgba(58,68,56,0.3)",background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer",fontFamily:"inherit" }}><Layers size={16} color={C.ink} strokeWidth={1.5}/><span style={{ fontSize:14,fontWeight:700,color:C.ink }}>All Items</span></button>
        </div>
      </div>
    </div>
  );
}

const initialCPWPrices = {};

function WardrobeScreen({ photoData, currentUser, onBack, initialView="main", onAddItem }) {
  const [view,setView]=useState(initialView);
  const [selectedPiece,setSelectedPiece]=useState(null);
  const [cpwPrices,setCpwPrices]=useState(initialCPWPrices);
  const [cpwAddModal,setCpwAddModal]=useState(null);
  const [cpwEditItem,setCpwEditItem]=useState(null);
  const [cpwDeleteItem,setCpwDeleteItem]=useState(null);
  const [cpwPriceInput,setCpwPriceInput]=useState("");
  const [itemSearch,setItemSearch]=useState("");
  const [itemCatFilter,setItemCatFilter]=useState("All");
  const [itemSort,setItemSort]=useState("most");
  const [selectedWearItem,setSelectedWearItem]=useState(null);

  const loggedOutfits=Object.values(photoData).filter(e=>e&&e.logged);
  const totalOutfits=loggedOutfits.length;
  // Total item instances across all outfits (any valid object counts)
  const totalItemsCount=loggedOutfits.reduce((sum,e)=>sum+(e.items||[]).filter(i=>i&&typeof i==="object").length,0);
  // Named items only — used for wear counts, color distribution, most/least worn
  const allLoggedObjs=loggedOutfits.flatMap(e=>(e.items||[]).map(item=>typeof item==="object"?item:{ name:String(item||""),category:"Other" }).filter(item=>item&&item.name&&typeof item.name==="string"));
  const wearCounts={};
  allLoggedObjs.forEach(item=>{ const k=(item.name||"").toLowerCase().trim(); if(!k) return; if(!wearCounts[k]) wearCounts[k]={ name:item.name,category:item.category||"Other",count:0 }; wearCounts[k].count+=1; });
  // Map each item name → { photo, dateKey } from its most recent logged outfit
  const itemLastInfo={};
  Object.entries(photoData).sort(([a],[b])=>b.localeCompare(a)).forEach(([dateKey,entry])=>{ if(!entry?.logged) return; (entry.items||[]).forEach(item=>{ if(!item||typeof item!=="object") return; const k=(item.name||"").trim().toLowerCase(); if(!k) return; if(!itemLastInfo[k]) itemLastInfo[k]={ photo:entry.photo||null, dateKey, itemPhoto:item.itemPhoto||null, brand:null, price:null, color:null }; if(item.brand&&!itemLastInfo[k].brand) itemLastInfo[k].brand=toCanonicalBrand(item.brand); if(item.price!=null&&itemLastInfo[k].price==null){ const p=parseFloat(item.price); if(!isNaN(p)) itemLastInfo[k].price=p; } if(item.color&&!itemLastInfo[k].color) itemLastInfo[k].color=item.color; }); });
  const getItemPhoto=(key)=>{ const info=itemLastInfo[key]; if(!info) return null; if(info.itemPhoto) return info.itemPhoto; if(info.photo) return info.photo; if(currentUser&&info.dateKey) return supabase.storage.from("outfit-photos").getPublicUrl(`${currentUser}/${info.dateKey}.jpg`).data.publicUrl; return null; };
  const wearArr=Object.values(wearCounts).map(w=>{ const k=w.name.toLowerCase().trim(); const meta=itemLastInfo[k]||{}; return {...w,lastPhoto:getItemPhoto(k),brand:meta.brand||null,price:meta.price??null,color:meta.color||null}; }).sort((a,b)=>b.count-a.count);
  const totalWears=wearArr.reduce((s,p)=>s+p.count,0);
  const catIcon=()=><Shirt size={22} color={C.sub} strokeWidth={1.5}/>;
  const computedMostWorn=wearArr.slice(0,5).map(p=>({ name:p.name,wears:p.count,category:p.category,image:catIcon() }));
  const computedLeastWorn=[...wearArr].reverse().slice(0,5).map(p=>({ name:p.name,wears:p.count,category:p.category,image:catIcon() }));

  const colorCounts={};
  loggedOutfits.forEach(e=>{ (e.items||[]).forEach(item=>{ if(!item||typeof item!=="object") return; const cols=toColors(item.color).filter(c=>colorHex[c]); if(cols.length){ cols.forEach(c=>{ colorCounts[c]=(colorCounts[c]||0)+1; }); } else if(item.name&&typeof item.name==="string"){ let col=null; const n=item.name.toLowerCase(); for(const [c,kws] of Object.entries(colorKeywords)){ if(kws.some(kw=>n.includes(kw))){ col=c; break; } } colorCounts[col||"Other"]=(colorCounts[col||"Other"]||0)+1; } }); });
  const totalCI=Object.values(colorCounts).reduce((s,v)=>s+v,0)||1;
  const computedColorData=Object.entries(colorCounts).filter(([n])=>n!=="Other").sort((a,b)=>b[1]-a[1]).concat(colorCounts["Other"]?[["Other",colorCounts["Other"]]]:[]).map(([name,count])=>({ name,value:Math.round(count/totalCI*100),color:colorHex[name]||"#B0B0A8" }));

  // Detailed palette from AI (new {name,hex} format + backward compat with old string format)
  const paletteMap={};
  loggedOutfits.forEach(e=>{ (e.colorPalette||[]).forEach(c=>{ if(c&&typeof c==="object"&&c.hex){ const k=c.hex.toLowerCase(); if(!paletteMap[k]) paletteMap[k]={name:c.name,hex:c.hex,count:0}; paletteMap[k].count+=1; } else if(typeof c==="string"&&c){ const k=c.toLowerCase(); if(!paletteMap[k]) paletteMap[k]={name:c,hex:colorHex[c]||"#B0B0A8",count:0}; paletteMap[k].count+=1; } }); });
  const detailedPalette=Object.values(paletteMap).sort((a,b)=>b.count-a.count).slice(0,12);

  const getStyle=items=>{ try { const names=(items||[]).map(i=>((typeof i==="object"?i.name:i)||"").toString().toLowerCase()).join(" "); const cats=(items||[]).map(i=>((typeof i==="object"?i.category:i)||"").toString().toLowerCase()).join(" "); if(cats.includes("activewear")||/gym|sport|athletic|yoga|running|workout|leggings|jogger/.test(names)) return "Activewear"; if(/blazer|suit|dress shirt|slacks|oxford|loafer|trousers|button-up|button up|formal|professional/.test(names)) return "Professional"; if(/dress|heels|jumpsuit|going out|club|evening|sequin|satin/.test(names)) return "Going Out"; return "Everyday"; } catch { return "Everyday"; } };
  const styleCounts={ Everyday:0,"Going Out":0,Activewear:0,Professional:0 };
  Object.values(photoData).forEach(entry=>{ if(entry?.logged){ const s=entry.style&&styleCounts.hasOwnProperty(entry.style)?entry.style:getStyle(entry.items); styleCounts[s]+=1; } });
  const styleColors={ "Everyday":"#5E6A5C","Going Out":"#3A4438","Activewear":"#8A9688","Professional":"#B0B8AE" };
  const totalStyleOutfits=Object.values(styleCounts).reduce((s,v)=>s+v,0)||1;
  const computedStyleData=Object.entries(styleCounts).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({ name,value:Math.round(count/totalStyleOutfits*100),color:styleColors[name]||"#B0B0A8" }));

  // Build item stats (wears + price) in a single pass over all logged outfits
  // Key = name+color so two items with the same name but different colours are tracked separately
  const cpwKey=(name,color)=>`${(name||"").trim().toLowerCase()}|${(Array.isArray(color)?color.join(","):color||"").toLowerCase()}`;
  const itemStatsMap={};
  loggedOutfits.forEach(e=>{ (e.items||[]).forEach(item=>{ if(!item||typeof item!=="object") return; const name=(item.name||"").trim(); if(!name) return; const key=cpwKey(name,item.color); if(!itemStatsMap[key]) itemStatsMap[key]={name,color:item.color||null,category:item.category||"Other",wears:0,price:null}; itemStatsMap[key].wears+=1; if(item.category&&item.category!=="Other") itemStatsMap[key].category=item.category; const p=parseFloat(item.price); if(!isNaN(p)&&p>0) itemStatsMap[key].price=p; }); });
  // Build display labels — append (Color) when two entries share the same name
  const nameCounts={};
  Object.values(itemStatsMap).forEach(s=>{ nameCounts[s.name.toLowerCase()]=(nameCounts[s.name.toLowerCase()]||0)+1; });
  // cpwPrices (set directly in wardrobe CPW section) override calendar prices
  const cpwList=Object.values(itemStatsMap).map(s=>{ const key=cpwKey(s.name,s.color); const price=cpwPrices[key]!=null?cpwPrices[key]:s.price; const cpw=price!=null&&s.wears>0?price/s.wears:null; const label=nameCounts[s.name.toLowerCase()]>1&&s.color?`${s.name} (${s.color})`:s.name; return {name:s.name,color:s.color,label,category:s.category,wears:s.wears,price,cpw,key}; }).sort((a,b)=>b.wears-a.wears);
  const pricedItems=cpwList.filter(i=>i.price!==null);
  const avgCPW=pricedItems.length>0?(pricedItems.reduce((s,i)=>s+i.cpw,0)/pricedItems.length).toFixed(2):"—";

  const SectionHeader=({ title,back })=>(
    <div style={{ background:C.white,padding:"16px 20px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0 }}>
      {back&&<button onClick={back} style={{ width:36,height:36,borderRadius:0,border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={20} color={C.sage}/></button>}
      <h1 style={{ fontSize:22,fontWeight:900,color:C.ink,margin:0,letterSpacing:"-0.02em" }}>{title}</h1>
    </div>
  );

  if(view==="items"){
    const allCategories=["All",...[...new Set(wearArr.map(i=>i.category))].sort()];
    const filteredItems=wearArr.filter(i=>{
      const matchesCat=itemCatFilter==="All"||i.category===itemCatFilter;
      const matchesSearch=i.name.toLowerCase().includes(itemSearch.toLowerCase());
      return matchesCat&&matchesSearch;
    });
    const sortedItems=[...filteredItems].sort((a,b)=>{
      if(itemSort==="least") return a.count-b.count;
      if(itemSort==="az") return a.name.localeCompare(b.name);
      return b.count-a.count;
    });
    const datesWorn=selectedWearItem?Object.entries(photoData)
      .filter(([,e])=>e?.logged&&(e.items||[]).some(i=>(i.name||"").trim().toLowerCase()===(selectedWearItem.name||"").trim().toLowerCase()))
      .map(([k])=>k).sort().reverse():[];
    return (
      <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
        <div style={{ background:C.white,padding:"16px 16px 0",borderBottom:`1px solid ${C.border}`,flexShrink:0 }}>
          <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:12 }}>
            <button onClick={()=>setView("main")} style={{ width:36,height:36,borderRadius:0,border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0 }}><ChevronLeft size={20} color={C.sage}/></button>
            <div style={{ flex:1 }}><h1 style={{ fontSize:22,fontWeight:900,color:C.ink,margin:0,letterSpacing:"-0.02em" }}>All Items</h1><p style={{ fontSize:12,color:C.sub,margin:0 }}>{sortedItems.length} of {wearArr.length}</p></div>
          </div>
          <div style={{ position:"relative",marginBottom:10 }}>
            <Search size={16} color={C.sub} style={{ position:"absolute",left:12,top:"50%",transform:"translateY(-50%)" }}/>
            <input value={itemSearch} onChange={e=>setItemSearch(e.target.value)} placeholder="Search items…" style={{ width:"100%",height:38,paddingLeft:36,paddingRight:12,borderRadius:0,border:`1.5px solid ${C.border}`,background:C.surface,fontSize:14,color:C.ink,outline:"none",boxSizing:"border-box",fontFamily:"inherit" }} onFocus={e=>e.target.style.borderColor=C.sage} onBlur={e=>e.target.style.borderColor=C.border}/>
          </div>
          <div style={{ display:"flex",gap:8,overflowX:"auto",paddingBottom:8,scrollbarWidth:"none" }}>
            {allCategories.map(c=><button key={c} onClick={()=>setItemCatFilter(c)} style={{ flexShrink:0,height:30,padding:"0 12px",borderRadius:0,border:itemCatFilter===c?"none":`1.5px solid ${C.border}`,background:itemCatFilter===c?C.sage:C.white,color:itemCatFilter===c?"#fff":C.sub,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{c}</button>)}
          </div>
          <div style={{ display:"flex",gap:6,paddingBottom:12 }}>
            {[{id:"most",label:"Most Worn"},{id:"least",label:"Least Worn"},{id:"az",label:"A–Z"}].map(s=>(
              <button key={s.id} onClick={()=>setItemSort(s.id)} style={{ height:26,padding:"0 10px",borderRadius:0,border:itemSort===s.id?"none":`1px solid ${C.border}`,background:itemSort===s.id?"#5E6A5C":"transparent",color:itemSort===s.id?"#fff":C.sub,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>{s.label}</button>
            ))}
          </div>
        </div>
        <div style={{ flex:1,overflowY:"auto",padding:16,paddingBottom:32 }}>
          {wearArr.length===0
            ? <div style={{ textAlign:"center",padding:"48px 24px" }}><div style={{ width:72,height:72,borderRadius:16,background:"rgba(58,68,56,0.07)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px" }}><Shirt size={36} color={C.ink} strokeWidth={1.5}/></div><div style={{ fontSize:16,fontWeight:700,color:C.ink,marginBottom:6 }}>No items yet</div><div style={{ fontSize:13,color:C.sub }}>Log an outfit on the Calendar screen to see your items here.</div></div>
            : sortedItems.length===0
              ? <div style={{ textAlign:"center",padding:"40px 24px" }}><div style={{ fontSize:32,marginBottom:10 }}>🔍</div><div style={{ fontSize:15,fontWeight:700,color:C.ink,marginBottom:4 }}>No items match</div><div style={{ fontSize:13,color:C.sub }}>Try a different search or category</div></div>
              : sortedItems.map((item,idx)=>(
                  <button key={idx} onClick={()=>setSelectedWearItem(item)} style={{ width:"100%",background:C.white,borderRadius:0,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12,border:`1px solid ${C.border}`,cursor:"pointer",textAlign:"left",fontFamily:"inherit" }}>
                    <div style={{ width:44,height:44,borderRadius:0,background:"#fff",border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,overflow:"hidden" }}>{item.lastPhoto?<img src={item.lastPhoto} alt={item.name} style={{ width:"100%",height:"100%",objectFit:"contain" }}/>:catEmoji(item.category)}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:14,fontWeight:600,color:C.ink }}>{item.name}</div>
                      <div style={{ fontSize:12,color:C.sub,marginTop:2 }}>{item.count} {item.count===1?"wear":"wears"}</div>
                    </div>
                    <span style={{ fontSize:11,fontWeight:700,color:C.sage,background:C.sage+"14",padding:"3px 10px",borderRadius:0 }}>{item.category}</span>
                    <ChevronRight size={14} color={C.border}/>
                  </button>
                ))
          }
        </div>
        {selectedWearItem&&(
          <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",flexDirection:"column",justifyContent:"flex-end" }} onClick={()=>setSelectedWearItem(null)}>
            <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:0,padding:"8px 20px 44px",maxHeight:"70vh",display:"flex",flexDirection:"column" }}>
              <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 16px",flexShrink:0 }}/>
              <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:20,flexShrink:0 }}>
                <div style={{ width:52,height:52,borderRadius:0,background:"#fff",border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0,overflow:"hidden" }}>{selectedWearItem.lastPhoto?<img src={selectedWearItem.lastPhoto} alt={selectedWearItem.name} style={{ width:"100%",height:"100%",objectFit:"contain" }}/>:catEmoji(selectedWearItem.category)}</div>
                <div><div style={{ fontSize:18,fontWeight:900,color:C.ink,letterSpacing:"-0.02em" }}>{selectedWearItem.name}</div><div style={{ fontSize:13,color:C.sub }}>{selectedWearItem.category} · {selectedWearItem.count} {selectedWearItem.count===1?"wear":"wears"}</div></div>
              </div>
              {(selectedWearItem.brand||selectedWearItem.price!=null||selectedWearItem.color)&&(
                <div style={{ display:"flex",gap:8,marginBottom:16,flexShrink:0,flexWrap:"wrap" }}>
                  {toColors(selectedWearItem.color).length>0&&<div style={{ background:C.surface,border:`1px solid ${C.border}`,padding:"6px 12px",display:"flex",alignItems:"center",gap:8 }}><div style={{ display:"flex",gap:4 }}>{toColors(selectedWearItem.color).map(c=><div key={c} style={{ width:12,height:12,borderRadius:"50%",background:colorHex[c]||"#B0B0A8",border:(c==="White"||c==="Cream")?`1px solid ${C.border}`:"none",flexShrink:0 }}/>)}</div><div><div style={{ fontSize:10,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2 }}>Colour</div><div style={{ fontSize:13,fontWeight:700,color:C.ink }}>{toColors(selectedWearItem.color).join(", ")}</div></div></div>}
                  {selectedWearItem.brand&&<div style={{ background:C.surface,border:`1px solid ${C.border}`,padding:"6px 12px" }}><div style={{ fontSize:10,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2 }}>Brand</div><div style={{ fontSize:13,fontWeight:700,color:C.ink }}>{selectedWearItem.brand}</div></div>}
                  {selectedWearItem.price!=null&&<div style={{ background:C.surface,border:`1px solid ${C.border}`,padding:"6px 12px" }}><div style={{ fontSize:10,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2 }}>Price</div><div style={{ fontSize:13,fontWeight:700,color:C.ink }}>${selectedWearItem.price.toFixed(2)}</div></div>}
                  {selectedWearItem.price!=null&&<div style={{ background:C.sage+"14",border:`1px solid ${C.sage}44`,padding:"6px 12px" }}><div style={{ fontSize:10,fontWeight:700,color:C.sage,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2 }}>Cost / Wear</div><div style={{ fontSize:13,fontWeight:700,color:C.sage }}>${(selectedWearItem.price/selectedWearItem.count).toFixed(2)}</div></div>}
                </div>
              )}
              <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"0 0 10px",flexShrink:0 }}>Worn on</p>
              <div style={{ overflowY:"auto",flex:1 }}>
                {datesWorn.length===0
                  ? <div style={{ textAlign:"center",padding:20,color:C.sub,fontSize:13 }}>No dates found</div>
                  : datesWorn.map((key,i)=>{
                      const [y,m,d]=key.split("-").map(Number);
                      const label=new Date(y,m-1,d).toLocaleDateString("en-US",{weekday:"short",month:"long",day:"numeric",year:"numeric"});
                      return <div key={i} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:i<datesWorn.length-1?`1px solid ${C.border}`:"none" }}><Calendar size={14} color={C.sage}/><span style={{ fontSize:14,color:C.ink }}>{label}</span></div>;
                    })
                }
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if(view==="piece"&&selectedPiece){
    const pct=totalWears>0?((selectedPiece.wears/totalWears)*100).toFixed(1):0;
    return (
      <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
        <SectionHeader title={selectedPiece.name} back={()=>setView("main")}/>
        <div style={{ flex:1,overflowY:"auto",padding:16 }}>
          <div style={{ background:C.white,borderRadius:0,padding:20,marginBottom:12,display:"flex",alignItems:"center",gap:16 }}>
            <div style={{ fontSize:44 }}>{selectedPiece.image}</div>
            <div><div style={{ fontSize:26,fontWeight:900,color:C.ink,letterSpacing:"-0.03em" }}>{selectedPiece.wears} wears</div><div style={{ fontSize:13,color:C.sub }}>{pct}% of outfit appearances</div></div>
          </div>
          <div style={{ background:C.white,borderRadius:0,padding:16,border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:13,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8 }}>Category</div>
            <span style={{ fontSize:14,fontWeight:700,color:C.sage,background:C.sage+"14",padding:"6px 14px",borderRadius:0 }}>{selectedPiece.category}</span>
          </div>
        </div>
      </div>
    );
  }

  if(view==="cpw"){
    const unpriced=cpwList.filter(i=>i.price===null);
    const priced=cpwList.filter(i=>i.price!==null).sort((a,b)=>a.cpw-b.cpw);
    const maxWears=Math.max(...cpwList.map(x=>x.wears),1);
    return (
      <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
        <SectionHeader title="Cost Per Wear" back={()=>setView("main")}/>
        <div style={{ flex:1,overflowY:"auto",padding:16,paddingBottom:40 }}>
          {pricedItems.length>0&&(
            <div style={{ background:C.ink,borderRadius:0,padding:"16px 20px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:12,color:"rgba(255,255,255,.8)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em" }}>Average Cost / Wear</div>
                <div style={{ fontSize:36,fontWeight:900,color:"#fff",lineHeight:1.1,marginTop:4,letterSpacing:"-0.03em" }}>${avgCPW}</div>
                <div style={{ fontSize:12,color:"rgba(255,255,255,.7)",marginTop:2 }}>{pricedItems.length} items tracked</div>
              </div>
              <DollarSign size={44} color="rgba(255,255,255,.8)" strokeWidth={1.5}/>
            </div>
          )}
          {priced.length>0&&(
            <div style={{ marginBottom:16 }}>
              <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10 }}>Tracked Items</p>
              {priced.map((item,i)=>(
                <div key={i} style={{ background:C.white,borderRadius:0,padding:"14px 16px",marginBottom:10,border:`1px solid ${C.border}` }}>
                  <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:10 }}>
                    <div style={{ width:42,height:42,borderRadius:0,background:C.sage+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>{catEmoji(item.category)}</div>
                    <div style={{ flex:1 }}><div style={{ fontSize:14,fontWeight:700,color:C.ink }}>{item.label}</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>${item.price.toFixed(2)} · {item.wears} wear{item.wears!==1?"s":""}</div></div>
                    <div style={{ textAlign:"right" }}><div style={{ fontSize:20,fontWeight:900,color:C.sage,letterSpacing:"-0.02em" }}>${item.cpw.toFixed(2)}</div><div style={{ fontSize:10,color:C.sub }}>per wear</div></div>
                  </div>
                  <div style={{ height:4,borderRadius:99,background:C.border,marginBottom:10,overflow:"hidden" }}><div style={{ height:"100%",width:`${Math.min((item.wears/maxWears)*100,100)}%`,background:C.sage,borderRadius:99 }}/></div>
                  <div style={{ display:"flex",gap:8 }}>
                    <button onClick={()=>{ setCpwEditItem(item); setCpwPriceInput(item.price.toString()); }} style={{ flex:1,height:34,borderRadius:0,border:`1px solid ${C.border}`,background:C.surface,color:C.sage,fontWeight:600,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6,fontFamily:"inherit" }}><Pencil size={13}/> Edit Price</button>
                    <button onClick={()=>setCpwDeleteItem(item.key)} style={{ flex:1,height:34,borderRadius:0,border:`1px solid ${C.border}`,background:C.surface,color:C.red,fontWeight:600,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6,fontFamily:"inherit" }}><Trash2 size={13}/> Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {unpriced.length>0&&(
            <div>
              <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10 }}>Add Price to Track ({unpriced.length} items)</p>
              {unpriced.map((item,i)=>(
                <button key={i} onClick={()=>{ setCpwAddModal(item); setCpwPriceInput(""); }} style={{ width:"100%",background:C.white,borderRadius:0,padding:"14px 16px",marginBottom:10,border:`1.5px dashed ${C.border}`,cursor:"pointer",textAlign:"left",fontFamily:"inherit",display:"flex",alignItems:"center",gap:12 }}>
                  <div style={{ width:42,height:42,borderRadius:0,background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>{catEmoji(item.category)}</div>
                  <div style={{ flex:1 }}><div style={{ fontSize:14,fontWeight:600,color:C.ink }}>{item.label}</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>{item.wears} wear{item.wears!==1?"s":""} · tap to add price</div></div>
                  <div style={{ width:28,height:28,borderRadius:"50%",background:C.sage+"18",display:"flex",alignItems:"center",justifyContent:"center" }}><Plus size={15} color={C.sage}/></div>
                </button>
              ))}
            </div>
          )}
          {cpwList.length===0&&<div style={{ textAlign:"center",padding:40,color:C.sub }}><div style={{ fontSize:40,marginBottom:12 }}>💸</div><p>Log outfits to track cost per wear</p></div>}
        </div>
        {cpwAddModal&&(
          <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"flex-end" }} onClick={()=>setCpwAddModal(null)}>
            <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:0,width:"100%",padding:"8px 20px 44px" }}>
              <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
              <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:20 }}>
                <div style={{ width:46,height:46,borderRadius:0,background:C.sage+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22 }}>{catEmoji(cpwAddModal.category)}</div>
                <div><div style={{ fontSize:16,fontWeight:700,color:C.ink }}>{cpwAddModal.label}</div><div style={{ fontSize:13,color:C.sub }}>{cpwAddModal.wears} wears logged</div></div>
              </div>
              <label style={{ display:"block",fontSize:13,fontWeight:700,color:C.sub,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em" }}>Item Price ($)</label>
              <input type="number" value={cpwPriceInput} onChange={e=>setCpwPriceInput(e.target.value)} placeholder="0.00" style={{ width:"100%",height:52,padding:"0 16px",borderRadius:0,border:`1.5px solid ${C.border}`,background:C.surface,fontSize:18,fontWeight:700,color:C.ink,outline:"none",boxSizing:"border-box",fontFamily:"inherit",marginBottom:16 }} onFocus={e=>e.target.style.borderColor=C.sage} onBlur={e=>e.target.style.borderColor=C.border}/>
              {cpwPriceInput&&parseFloat(cpwPriceInput)>0&&<div style={{ background:C.sage+"14",borderRadius:0,padding:"10px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center" }}><span style={{ fontSize:13,color:C.sub }}>Cost per wear</span><span style={{ fontSize:22,fontWeight:800,color:C.sage }}>${(parseFloat(cpwPriceInput)/cpwAddModal.wears).toFixed(2)}</span></div>}
              <button onClick={()=>{ if(!cpwPriceInput||parseFloat(cpwPriceInput)<=0) return; setCpwPrices(p=>({...p,[cpwAddModal.key]:parseFloat(cpwPriceInput)})); setCpwAddModal(null); }} style={{ width:"100%",height:52,borderRadius:0,border:"none",background:!cpwPriceInput||parseFloat(cpwPriceInput)<=0?C.border:C.sage,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Save Price</button>
            </div>
          </div>
        )}
        {cpwEditItem&&(
          <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"flex-end" }} onClick={()=>setCpwEditItem(null)}>
            <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:0,width:"100%",padding:"8px 20px 44px" }}>
              <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
              <h2 style={{ fontSize:20,fontWeight:800,color:C.ink,marginBottom:6 }}>Edit Price</h2>
              <p style={{ fontSize:14,color:C.sub,marginBottom:20 }}>{cpwEditItem.label}</p>
              <input type="number" value={cpwPriceInput} onChange={e=>setCpwPriceInput(e.target.value)} style={{ width:"100%",height:52,padding:"0 16px",borderRadius:0,border:`1.5px solid ${C.border}`,background:C.surface,fontSize:18,fontWeight:700,color:C.ink,outline:"none",boxSizing:"border-box",fontFamily:"inherit",marginBottom:16 }} onFocus={e=>e.target.style.borderColor=C.sage} onBlur={e=>e.target.style.borderColor=C.border}/>
              {cpwPriceInput&&parseFloat(cpwPriceInput)>0&&<div style={{ background:C.sage+"14",borderRadius:0,padding:"10px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center" }}><span style={{ fontSize:13,color:C.sub }}>New cost per wear</span><span style={{ fontSize:22,fontWeight:800,color:C.sage }}>${(parseFloat(cpwPriceInput)/cpwEditItem.wears).toFixed(2)}</span></div>}
              <button onClick={()=>{ setCpwPrices(p=>({...p,[cpwEditItem.key]:parseFloat(cpwPriceInput)})); setCpwEditItem(null); }} style={{ width:"100%",height:52,borderRadius:0,border:"none",background:C.sage,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Update Price</button>
            </div>
          </div>
        )}
        {cpwDeleteItem&&(
          <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:24 }} onClick={()=>setCpwDeleteItem(null)}>
            <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:0,padding:28,width:"100%",maxWidth:340 }}>
              <div style={{ fontSize:36,textAlign:"center",marginBottom:12 }}>🗑️</div>
              <h2 style={{ fontSize:18,fontWeight:800,color:C.ink,textAlign:"center",margin:"0 0 8px" }}>Remove price?</h2>
              <p style={{ fontSize:14,color:C.sub,textAlign:"center",margin:"0 0 24px" }}>Item stays in wardrobe but won't be cost-tracked.</p>
              <button onClick={()=>{ setCpwPrices(p=>{ const n={...p}; delete n[cpwDeleteItem]; return n; }); setCpwDeleteItem(null); }} style={{ width:"100%",height:50,borderRadius:0,border:"none",background:C.red,color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:10 }}>Remove</button>
              <button onClick={()=>setCpwDeleteItem(null)} style={{ width:"100%",height:50,borderRadius:0,border:"none",background:C.surface,color:C.sub,fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const D = "1px solid rgba(58,68,56,0.3)"; // section divider
  const iconBox = { width:44,height:44,borderRadius:12,background:"rgba(58,68,56,0.07)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 };

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"#fff" }}>
      {/* Header */}
      <div style={{ padding:"28px 24px 20px",background:"#fff",flexShrink:0,display:"flex",alignItems:"flex-start",justifyContent:"space-between" }}>
        <div>
          {onBack&&<button onClick={onBack} style={{ display:"flex",alignItems:"center",gap:4,border:"none",background:"transparent",color:C.sub,fontSize:13,cursor:"pointer",padding:"0 0 10px",fontFamily:"inherit" }}><ChevronLeft size={15} color={C.sub} strokeWidth={2}/>Back</button>}
          <h1 style={{ fontSize:34,fontWeight:700,color:C.ink,margin:0,letterSpacing:"-0.03em",lineHeight:1 }}>Analytics</h1>
          <p style={{ fontSize:13,color:C.sub,margin:"5px 0 0",fontWeight:400 }}>Your wardrobe insights</p>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:6,border:`1px solid ${C.border}`,borderRadius:99,padding:"8px 16px",fontSize:13,fontWeight:500,color:C.ink,marginTop:4,flexShrink:0 }}>
          <Calendar size={13} color={C.ink} strokeWidth={1.5}/>
          <span>This Month</span>
          <ChevronDown size={13} color={C.ink} strokeWidth={1.5}/>
        </div>
      </div>

      <div style={{ flex:1,overflowY:"auto",background:"#fff" }}>
        {/* Stat row: Total Outfits | Total Items — always visible */}
        <div style={{ borderTop:D,borderBottom:D,display:"flex" }}>
          <div style={{ flex:1,padding:"20px 24px" }}>
            <div style={iconBox}><CalendarDays size={20} color={C.ink} strokeWidth={1.5}/></div>
            <div style={{ fontSize:36,fontWeight:700,color:C.ink,letterSpacing:"-0.04em",lineHeight:1,marginTop:16 }}>{totalOutfits}</div>
            <div style={{ fontSize:13,color:C.sub,marginTop:5,fontWeight:400 }}>Total Outfits</div>
          </div>
          <div style={{ width:1,background:"rgba(58,68,56,0.15)",flexShrink:0 }}/>
          <button onClick={()=>totalOutfits>0&&setView("items")} style={{ flex:1,padding:"20px 24px",background:"transparent",border:"none",textAlign:"left",cursor:totalOutfits>0?"pointer":"default",fontFamily:"inherit" }}>
            <div style={iconBox}><Shirt size={20} color={C.ink} strokeWidth={1.5}/></div>
            <div style={{ fontSize:36,fontWeight:700,color:C.ink,letterSpacing:"-0.04em",lineHeight:1,marginTop:16 }}>{totalItemsCount}</div>
            <div style={{ fontSize:13,color:C.sub,marginTop:5,fontWeight:400 }}>Total Items</div>
            {totalOutfits>0&&<div style={{ fontSize:12,fontWeight:600,color:C.ink,marginTop:8 }}>Tap to view →</div>}
          </button>
        </div>

        {/* Avg Cost/Wear row */}
        <button onClick={()=>totalOutfits>0&&setView("cpw")} style={{ width:"100%",borderTop:"none",borderLeft:"none",borderRight:"none",borderBottom:D,padding:"18px 24px",background:"transparent",textAlign:"left",cursor:totalOutfits>0?"pointer":"default",fontFamily:"inherit",display:"flex",alignItems:"center",gap:14,boxSizing:"border-box" }}>
          <div style={iconBox}><DollarSign size={20} color={C.ink} strokeWidth={1.5}/></div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13,color:C.sub,fontWeight:500,marginBottom:4 }}>Avg Cost/Wear</div>
            <div style={{ fontSize:22,fontWeight:700,color:C.ink,letterSpacing:"-0.02em",lineHeight:1 }}>{avgCPW==="—"?"—":`$${avgCPW}`}</div>
          </div>
          {totalOutfits>0&&<span style={{ fontSize:13,fontWeight:500,color:C.ink,whiteSpace:"nowrap" }}>Tap to manage →</span>}
        </button>

        {/* Most Worn Pieces */}
        <div style={{ borderBottom:D,padding:"18px 24px" }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:totalOutfits>0?18:0 }}>
            <div style={{ display:"flex",alignItems:"center",gap:12 }}>
              <div style={iconBox}><TrendingUp size={20} color={C.ink} strokeWidth={1.5}/></div>
              <span style={{ fontSize:15,fontWeight:600,color:C.ink }}>Most Worn Pieces</span>
            </div>
            {totalOutfits>0&&<button onClick={()=>setView("items")} style={{ background:"none",border:"none",fontSize:13,fontWeight:500,color:C.ink,cursor:"pointer",fontFamily:"inherit",padding:0 }}>View All →</button>}
          </div>
          {totalOutfits===0 ? (
            <div style={{ padding:"36px 0 8px",display:"flex",flexDirection:"column",alignItems:"center",gap:10 }}>
              <div style={{ width:72,height:72,borderRadius:"50%",background:"rgba(58,68,56,0.07)",display:"flex",alignItems:"center",justifyContent:"center" }}><Shirt size={30} color={C.sub} strokeWidth={1}/></div>
              <div style={{ fontSize:16,fontWeight:600,color:C.ink,marginTop:4 }}>No outfits logged yet</div>
              <div style={{ fontSize:13,color:C.sub,textAlign:"center",lineHeight:1.6 }}>Start logging your outfits to see your insights</div>
              {onAddItem&&<button onClick={onAddItem} style={{ marginTop:12,height:50,padding:"0 32px",border:"none",background:C.ink,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit",borderRadius:8 }}>Log Your First Outfit</button>}
            </div>
          ) : computedMostWorn.map((p,i)=>(
            <button key={i} onClick={()=>{ setSelectedPiece(p); setView("piece"); }} style={{ width:"100%",background:"transparent",border:"none",borderBottom:i<computedMostWorn.length-1?`1px solid ${C.border}`:"none",padding:"12px 0",display:"flex",alignItems:"center",gap:12,cursor:"pointer",textAlign:"left",fontFamily:"inherit" }}>
              <div style={{ width:44,height:44,background:"rgba(58,68,56,0.07)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,overflow:"hidden" }}>{p.image}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14,fontWeight:600,color:C.ink }}>{p.name}</div>
                <div style={{ fontSize:12,color:C.sub,marginTop:3 }}>{p.wears} wear{p.wears!==1?"s":""}{totalWears>0?` · ${((p.wears/totalWears)*100).toFixed(0)}%`:""}</div>
              </div>
              <ChevronRight size={15} color={C.sub}/>
            </button>
          ))}
        </div>

        {totalOutfits>0&&<>
          {/* Least Worn Pieces */}
          <div style={{ borderBottom:D,padding:"18px 24px" }}>
            <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:18 }}>
              <div style={iconBox}><TrendingUp size={20} color={C.ink} strokeWidth={1.5} style={{ transform:"rotate(180deg)" }}/></div>
              <div>
                <div style={{ fontSize:15,fontWeight:600,color:C.ink }}>Least Worn Pieces</div>
                <div style={{ fontSize:12,color:C.sub,marginTop:2 }}>Items that need more love</div>
              </div>
            </div>
            {computedLeastWorn.map((p,i)=>(
              <button key={i} onClick={()=>{ setSelectedPiece(p); setView("piece"); }} style={{ width:"100%",background:"transparent",border:"none",borderBottom:i<computedLeastWorn.length-1?`1px solid ${C.border}`:"none",padding:"12px 0",display:"flex",alignItems:"center",gap:12,cursor:"pointer",textAlign:"left",fontFamily:"inherit" }}>
                <div style={{ width:44,height:44,background:"rgba(58,68,56,0.07)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,overflow:"hidden" }}>{p.image}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14,fontWeight:600,color:C.ink }}>{p.name}</div>
                  <div style={{ fontSize:12,color:C.sub,marginTop:3 }}>{p.wears} wear{p.wears!==1?"s":""}{totalWears>0?` · ${((p.wears/totalWears)*100).toFixed(0)}%`:""}</div>
                </div>
                <ChevronRight size={15} color={C.sub}/>
              </button>
            ))}
          </div>

          {/* Colour Palette */}
          <div style={{ borderBottom:D,padding:"18px 24px" }}>
            <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:18 }}>
              <div style={iconBox}><Palette size={20} color={C.ink} strokeWidth={1.5}/></div>
              <span style={{ fontSize:15,fontWeight:600,color:C.ink }}>Colour Palette</span>
            </div>
            {computedColorData.length>0?(
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart><Pie data={computedColorData} cx="50%" cy="50%" innerRadius={55} outerRadius={82} paddingAngle={3} dataKey="value">{computedColorData.map((e,i)=><Cell key={i} fill={e.color} stroke={e.color==="#E8E8E8"||e.color==="#B0B0A8"?C.border:"none"}/>)}</Pie></PieChart>
                </ResponsiveContainer>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px 8px",marginTop:16 }}>
                  {computedColorData.map((e,i)=>(
                    <div key={i} style={{ display:"flex",alignItems:"center",gap:8 }}>
                      <div style={{ width:13,height:13,borderRadius:"50%",background:e.color,border:e.color==="#E8E8E8"||e.color==="#B0B0A8"?`1px solid ${C.border}`:"none",flexShrink:0 }}/>
                      <span style={{ fontSize:13,color:C.ink,flex:1 }}>{e.name}</span>
                      <span style={{ fontSize:13,fontWeight:600,color:C.ink }}>{e.value}%</span>
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex",gap:6,marginTop:20,width:"50%" }}>
                  {computedColorData.slice(0,5).map((e,i)=>(
                    <div key={i} style={{ flex:1,border:`1px solid ${C.border}`,overflow:"hidden",borderRadius:4 }}>
                      <div style={{ height:32,background:e.color }}/>
                      <div style={{ padding:"4px 5px" }}>
                        <div style={{ fontSize:9,fontWeight:600,color:C.ink,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{e.name}</div>
                        <div style={{ fontSize:8,color:C.sub,fontFamily:"monospace" }}>{e.color.toUpperCase()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ):<div style={{ fontSize:13,color:C.sub,padding:"8px 0" }}>No colour data yet</div>}
          </div>

          {/* Style Distribution */}
          <div style={{ padding:"18px 24px",paddingBottom:48 }}>
            <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:18 }}>
              <div style={iconBox}><Layers size={20} color={C.ink} strokeWidth={1.5}/></div>
              <span style={{ fontSize:15,fontWeight:600,color:C.ink }}>Style Distribution</span>
            </div>
            {computedStyleData.length>0?(
              <div style={{ display:"flex",alignItems:"flex-end",gap:10 }}>
                {computedStyleData.map((e,i)=>(
                  <div key={i} style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:6 }}>
                    <span style={{ fontSize:12,fontWeight:600,color:C.ink }}>{e.value}%</span>
                    <div style={{ width:"100%",height:120,display:"flex",alignItems:"flex-end" }}>
                      <div style={{ width:"100%",height:`${Math.max(e.value,4)}%`,background:e.color,borderRadius:"3px 3px 0 0" }}/>
                    </div>
                    <span style={{ fontSize:10,fontWeight:500,color:C.sub,textAlign:"center",lineHeight:1.3 }}>{e.name}</span>
                  </div>
                ))}
              </div>
            ):<div style={{ fontSize:13,color:C.sub,padding:"8px 0" }}>No style data yet</div>}
          </div>
        </>}
      </div>
    </div>
  );
}


const BRANDS = [
  // High street
  "& Other Stories","Arket","ASOS","Bershka","COS","H&M","Mango","Marks & Spencer",
  "Massimo Dutti","Monki","New Look","Next","Primark","Pull&Bear","River Island",
  "Stradivarius","Topshop","Uniqlo","Weekday","Zara",
  // Luxury
  "Alexander McQueen","Balenciaga","Bottega Veneta","Burberry","Celine","Chanel",
  "Fendi","Givenchy","Gucci","Jacquemus","Loewe","Louis Vuitton","Prada",
  "Saint Laurent","Stella McCartney","Valentino","Versace",
  // Contemporary / mid-market
  "APC","ba&sh","Frame","Ganni","Isabel Marant","Maje","Reformation","Rouje",
  "Rotate","Sandro","Self-Portrait","Sézane","Staud",
  // Denim
  "7 For All Mankind","AG Jeans","Agolde","Citizens of Humanity","Levi's","Madewell","Paige",
  // Sportswear
  "Adidas","Fabletics","Gymshark","HOKA","Lululemon","New Balance","Nike",
  "On Running","Reebok","Sweaty Betty","Under Armour",
  // American / preppy
  "Anthropologie","Calvin Klein","Coach","Free People","J.Crew","Kate Spade",
  "Michael Kors","Ralph Lauren","Tommy Hilfiger","Tory Burch",
].sort((a,b)=>a.localeCompare(b));

// Normalise a brand string to canonical casing — matches against BRANDS list first, then title-cases
const toCanonicalBrand=n=>{ if(!n||typeof n!=="string") return n; const l=n.toLowerCase().trim(); return BRANDS.find(b=>b.toLowerCase()===l)||n.trim().replace(/\b\w/g,c=>c.toUpperCase()); };

// Module-level brand cache — loaded once per session, shared across all BrandPicker instances
let _brandsCache=null;

const loadBrands=async()=>{
  if(_brandsCache!==null) return _brandsCache;
  const {data}=await supabase.from("brands").select("name").order("name");
  // Normalise each custom brand: prefer canonical casing from BRANDS list, else title-case it
  const custom=(data||[]).map(r=>toCanonicalBrand(r.name));
  // Deduplicate case-insensitively, BRANDS entries take precedence
  const seen=new Set();
  _brandsCache=[...BRANDS,...custom].filter(b=>{ const k=b.toLowerCase().trim(); if(seen.has(k)) return false; seen.add(k); return true; }).sort((a,b)=>a.localeCompare(b));
  return _brandsCache;
};

const saveCustomBrand=async(name)=>{
  // Skip if already in the predefined list (case-insensitive)
  if(BRANDS.some(b=>b.replace(/\s+/g," ").toLowerCase()===name.replace(/\s+/g," ").toLowerCase())) return;
  await supabase.from("brands").upsert({name},{onConflict:"name"});
  // Update cache immediately — deduplicate case-insensitively
  if(_brandsCache&&!_brandsCache.some(b=>b.toLowerCase()===name.toLowerCase())){
    _brandsCache=[..._brandsCache,name].sort((a,b)=>a.localeCompare(b));
  }
};

function BrandPicker({ value, onChange }) {
  const [query,setQuery]=useState(value||"");
  const [open,setOpen]=useState(false);
  const [allBrands,setAllBrands]=useState(BRANDS);
  const ref=useRef(null);

  useEffect(()=>{ loadBrands().then(setAllBrands); },[]);
  useEffect(()=>{ setQuery(value||""); },[value]);

  useEffect(()=>{
    if(!open) return;
    const handler=e=>{ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",handler);
    return ()=>document.removeEventListener("mousedown",handler);
  },[open]);

  const normalize=val=>{
    const trimmed=val.trim().replace(/\s+/g," ");
    if(!trimmed) return "";
    const canonical=allBrands.find(b=>b.replace(/\s+/g," ").toLowerCase()===trimmed.toLowerCase());
    if(canonical) return canonical;
    return toCanonicalBrand(trimmed);
  };

  const q=query.trim().replace(/\s+/g," ").toLowerCase();
  const matches=q.length===0
    ? allBrands.slice(0,8)
    : allBrands.filter(b=>b.replace(/\s+/g," ").toLowerCase().includes(q)).slice(0,8);
  const exactMatch=allBrands.some(b=>b.replace(/\s+/g," ").toLowerCase()===q);
  const showAdd=query.trim().length>0&&!exactMatch;

  const commit=raw=>{
    const normalized=normalize(raw);
    setQuery(normalized);
    onChange(normalized);
    setOpen(false);
    if(normalized) saveCustomBrand(normalized).then(()=>loadBrands().then(setAllBrands));
  };
  const select=brand=>commit(brand);

  return (
    <div ref={ref} style={{ position:"relative",flex:1,height:"100%" }}>
      <input
        value={query}
        onChange={e=>{ setQuery(e.target.value); setOpen(true); }}
        onFocus={()=>setOpen(true)}
        onBlur={()=>{ if(!open) commit(query); }}
        placeholder="e.g. Zara"
        style={{ width:"100%",height:"100%",padding:"0 10px",border:"none",background:"transparent",fontSize:13,color:C.ink,outline:"none",fontFamily:"inherit",boxSizing:"border-box" }}
      />
      {open&&(matches.length>0||showAdd)&&(
        <div style={{ position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:C.white,border:`1.5px solid ${C.border}`,borderRadius:0,boxShadow:"0 4px 16px rgba(0,0,0,.1)",zIndex:1000,overflow:"hidden" }}>
          {matches.map((b,idx)=>(
            <button key={idx} onMouseDown={()=>select(b)} style={{ display:"block",width:"100%",padding:"10px 12px",textAlign:"left",background:"none",border:"none",borderBottom:idx<matches.length-1||showAdd?`1px solid ${C.border}`:"none",fontSize:13,color:C.ink,cursor:"pointer",fontFamily:"inherit" }}>
              {b}
            </button>
          ))}
          {showAdd&&(
            <button onMouseDown={()=>commit(query)} style={{ display:"block",width:"100%",padding:"10px 12px",textAlign:"left",background:C.sage+"12",border:"none",fontSize:13,color:C.sage,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>
              + Add "{normalize(query)}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CalendarScreen({ photoData, setPhotoData, favourites=[], onToggleFavourite, onBack, initialDate=null, onClearInitialDate, cameraEnabled=false }) {
  const [selectedDate,setSelectedDate]=useState(null);
  const [showModal,setShowModal]=useState(false);
  const [showSourcePicker,setShowSourcePicker]=useState(false);
  const [editMode,setEditMode]=useState(false);
  const [editEntry,setEditEntry]=useState(null);
  const [selectedItemIdxs,setSelectedItemIdxs]=useState(new Set());
  const [toast,setToast]=useState(null);
  const [showCamera,setShowCamera]=useState(false);
  const [photoUploading,setPhotoUploading]=useState(false);
  const [calMonth,setCalMonth]=useState(()=>new Date().getMonth());
  const [calYear,setCalYear]=useState(()=>new Date().getFullYear());
  const calCameraRef=useRef(null);

  useEffect(()=>{
    if(!initialDate) return;
    const [y,m,d]=initialDate.split("-").map(Number);
    setSelectedDate(new Date(y,m-1,d));
    setShowModal(true);
    onClearInitialDate&&onClearInitialDate();
  },[initialDate]);
  const months=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const today=new Date();
  const toKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  // Build lookup of all previously logged items by name (latest entry wins for each field)
  const knownItems={};
  Object.values(photoData).forEach(e=>{ if(!e?.logged) return; (e.items||[]).forEach(item=>{ if(!item||typeof item!=="object") return; const name=(item.name||"").trim().toLowerCase(); if(!name) return; if(!knownItems[name]) knownItems[name]={category:item.category||"Top",color:item.color||"Black",price:null,count:0}; knownItems[name].count+=1; if(item.category&&item.category!=="Other") knownItems[name].category=item.category; if(item.color) knownItems[name].color=item.color; const p=parseFloat(item.price); if(!isNaN(p)&&p>0) knownItems[name].price=String(p); }); });

  const handleCameraCapture=async(dataUrl)=>{
    setShowCamera(false);
    setShowSourcePicker(false);
    const fakeFile={ type:"image/jpeg" };
    const r=new FileReader();
    const blob=await fetch(dataUrl).then(res=>res.blob());
    const file=new File([blob],"camera.jpg",{ type:"image/jpeg" });
    handlePhotoUpload(file);
  };

  const handlePhotoUpload=(file)=>{
    if(!file) return;
    setShowSourcePicker(false);
    setPhotoUploading(true);
    const r=new FileReader();
    r.onload=async(ev)=>{
      const compressed=await compressImage(ev.target.result);
      let finalCompressed=compressed;
      try{ finalCompressed=await removeBackground(compressed.split(",")[1])||compressed; }
      catch(e){ setToast("BG removal: "+(e.message||String(e))); setTimeout(()=>setToast(null),15000); }
      setPhotoUploading(false);
      const base64=finalCompressed.split(",")[1];
      const dateKey=toKey(selectedDate);
      setPhotoData(p=>({...p,[dateKey]:{ logged:true,photo:finalCompressed,items:[],style:null,analysing:true }}));
      setShowModal(true);
      const knownItemsList=Object.entries(knownItems).map(([name,v])=>({name,category:v.category,color:v.color,price:v.price?parseFloat(v.price):null}));
      // Convert bg-removed data-URL to a Blob for storage upload
      const blob=await fetch(finalCompressed).then(r=>r.blob());
      // Upload photo and run AI analysis in parallel
      let _analysisErr=null;
      const [photoUrl,parsed]=await Promise.all([
        uploadPhoto(blob,dateKey),
        analyseOutfit(base64,"image/jpeg",knownItemsList).catch(e=>{ _analysisErr=e; return null; }),
      ]);
      if(_analysisErr){ setToast("AI error: "+(_analysisErr.message||String(_analysisErr))); setTimeout(()=>setToast(null),30000); track("ai_analysis_failed", { error: _analysisErr.message||String(_analysisErr), date_key: dateKey }); }
      // Append cache-buster so the browser always loads the fresh photo after re-upload on the same date
      const finalPhoto=photoUrl?(photoUrl+"?t="+Date.now()):finalCompressed;
      if(parsed){
        const rawItems=parsed.clothing_items||[];
        const items=rawItems.map(item=>{const key=(item.name||"").trim().toLowerCase();const known=knownItems[key];const normColor=normalizeAiColor(item.color);const normBrand=toCanonicalBrand(item.brand||null);const base={...item,color:normColor,brand:normBrand};if(known){return {...base,price:known.price??item.price,_recognized:true,_wearCount:known.count};}return base;});
        const style=parsed.style_category||null;
        const formalityLevel=parsed.formality_level||null;
        const season=parsed.season||null;
        const colorPalette=parsed.color_palette||[];
        // Crop each item: try per-item bg removal for clean product photo; fall back to crop from already-bg-removed outfit
        const itemsWithPhotos=[];
        for(let idx=0;idx<items.length;idx++){
          const item=items[idx];
          const {bbox,...itemData}=item;
          if(!bbox){ itemsWithPhotos.push(itemData); continue; }
          const fallbackCrop=await cropItemPhoto(finalCompressed,bbox);
          const rawCrop=await cropItemPhoto(compressed,bbox);
          let cleanCrop=fallbackCrop;
          if(rawCrop){ try{ cleanCrop=await removeBackground(rawCrop.split(",")[1])||fallbackCrop; }catch(e){} }
          const source=cleanCrop||fallbackCrop;
          if(!source){ itemsWithPhotos.push(itemData); continue; }
          const itemPhotoUrl=await uploadItemPhoto(source,dateKey,idx);
          itemsWithPhotos.push(itemPhotoUrl?{...itemData,itemPhoto:itemPhotoUrl}:itemData);
        }
        setPhotoData(p=>({...p,[dateKey]:{logged:true,photo:finalPhoto,items:itemsWithPhotos,style,formalityLevel,season,colorPalette,analysing:false}}));
        setEditEntry({style,formalityLevel,season,items:itemsWithPhotos.map(item=>({...item}))});
        track("outfit_created", { date_key: dateKey, items_count: items.length, style, season });
        // onboarding_completed fires only on the very first outfit
        if(Object.keys(photoData).length===0) track("onboarding_completed", { items_count: items.length });
        supabase.auth.getSession().then(({data:{session}})=>{
          if(session) syncOutfit(session.user.id, dateKey, finalPhoto, style, season, itemsWithPhotos);
        });
        setToast(`Outfit analysed — ${items.length} item${items.length!==1?"s":""} found`);
        setTimeout(()=>setToast(null),3000);
      }else{
        setPhotoData(p=>({...p,[dateKey]:{...p[dateKey],photo:finalPhoto,analysing:false}}));
        setEditEntry({style:null,formalityLevel:null,season:null,items:[]});
        setToast("Analysis complete — review and add items manually");
        setTimeout(()=>setToast(null),3000);
      }
      setEditMode(true);
    };
    r.readAsDataURL(file);
  };

  const renderMonth=(mIdx,yr)=>{
    const year=yr??today.getFullYear(),days=new Date(year,mIdx+1,0).getDate(),first=new Date(year,mIdx,1).getDay();
    const cells=[];
    for(let i=0;i<first;i++) cells.push(<div key={`e${i}`}/>);
    for(let d=1;d<=days;d++){
      const date=new Date(year,mIdx,d),key=toKey(date);
      const isToday=date.toDateString()===today.toDateString(),hasPhoto=!!(photoData[key]?.logged);
      cells.push(<button key={d} onClick={()=>{ setSelectedDate(date); setShowModal(true); setEditMode(false); setEditEntry(null); setSelectedItemIdxs(new Set()); }} style={{ aspectRatio:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",border:"none",background:"transparent",cursor:"pointer",padding:0,gap:2 }}>
        <span style={{ width:30,height:30,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:isToday?700:hasPhoto?600:400,background:"transparent",border:isToday?`1px solid #888`:hasPhoto?`1px solid transparent`:"none",borderBottom:isToday?`1px solid transparent`:"",color:isToday?C.ink:hasPhoto?C.ink:C.sub }}>{d}</span>
        {hasPhoto&&!isToday&&<div style={{ width:5,height:5,borderRadius:"50%",background:C.green }}/>}
      </button>);
    }
    return cells;
  };

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"#fff",position:"relative" }}>
      {toast&&<div style={{ position:"fixed",top:16,left:12,right:12,zIndex:99999,background:toast.startsWith("AI error")?"#E5635A":C.sage,color:"#fff",borderRadius:0,padding:"10px 14px",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:8,boxShadow:"0 4px 16px rgba(0,0,0,.18)" }}><Check size={15} color="#fff"/>{toast}</div>}
      <div style={{ background:"#fff",padding:"28px 24px 20px",flexShrink:0 }}>
        {onBack&&<button onClick={onBack} style={{ display:"flex",alignItems:"center",gap:4,border:"none",background:"transparent",color:C.sub,fontSize:13,cursor:"pointer",padding:"0 0 10px",fontFamily:"inherit" }}><ChevronLeft size={15} color={C.sub} strokeWidth={2}/>Back</button>}
        <h1 style={{ fontSize:34,fontWeight:900,color:C.ink,margin:0,letterSpacing:"-0.03em",lineHeight:1 }}>Outfit Calendar</h1>
        <p style={{ fontSize:13,color:C.sub,margin:"5px 0 0" }}>Track your daily outfits</p>
      </div>
      <div style={{ flex:1,overflowY:"auto" }}>
        <div style={{ borderTop:"1px solid rgba(58,68,56,0.3)",padding:"20px 16px 32px" }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
            <button onClick={()=>{ if(calMonth===0){ setCalMonth(11); setCalYear(y=>y-1); } else setCalMonth(m=>m-1); }} style={{ width:36,height:36,borderRadius:0,border:"1px solid rgba(58,68,56,0.3)",background:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={18} color={C.ink}/></button>
            <div style={{ textAlign:"center" }}>
              <h2 style={{ fontSize:18,fontWeight:800,color:C.ink,margin:0,letterSpacing:"-0.02em" }}>{months[calMonth]} {calYear}</h2>
              {(calMonth!==today.getMonth()||calYear!==today.getFullYear())&&<button onClick={()=>{ setCalMonth(today.getMonth()); setCalYear(today.getFullYear()); }} style={{ fontSize:11,color:C.sub,background:"none",border:"none",cursor:"pointer",fontWeight:600,fontFamily:"inherit",padding:"2px 0",textDecoration:"underline",textUnderlineOffset:2 }}>Today</button>}
            </div>
            <button onClick={()=>{ if(calMonth===11){ setCalMonth(0); setCalYear(y=>y+1); } else setCalMonth(m=>m+1); }} style={{ width:36,height:36,borderRadius:0,border:"1px solid rgba(58,68,56,0.3)",background:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronRight size={18} color={C.ink}/></button>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4 }}>
            {["S","M","T","W","T","F","S"].map((d,i)=><div key={i} style={{ display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:C.sub,height:24 }}>{d}</div>)}
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2 }}>{renderMonth(calMonth,calYear)}</div>
        </div>
      </div>
      {showCamera&&<CameraCapture onCapture={handleCameraCapture} onClose={()=>setShowCamera(false)}/>}
      <Modal isOpen={showModal&&!!selectedDate} onClose={()=>{ setShowModal(false); setShowSourcePicker(false); setEditMode(false); setEditEntry(null); setSelectedItemIdxs(new Set()); }} title={selectedDate?selectedDate.toLocaleDateString("en-US",{ weekday:"long",month:"long",day:"numeric" }):""}>
        {selectedDate&&(()=>{
          const entry=photoData[toKey(selectedDate)];
          if(entry?.logged){
            const STYLES=["Everyday","Going Out","Activewear","Professional"];
            const FORMALITY=["Casual","Smart Casual","Formal","Sporty"];
            const SEASONS=["Spring","Summer","Autumn","Winter","All Season"];
            const CATS=["Top","Bottom","Outerwear","Shoes","Accessories","Dresses","Swimwear"];
            const COLORS=["Black","White","Cream","Beige","Navy","Blue","Gray","Brown","Green","Red","Yellow","Pink","Purple"];
            const catEmojis={ Top:"👕",Bottom:"👖",Outerwear:"🧥",Shoes:"👟",Accessories:"💍",Dresses:"👗",Swimwear:"👙",Other:"👔" };
            const ORDER=["Top","Bottom","Outerwear","Shoes","Accessories","Dresses","Swimwear"];

            // ── Edit mode ──
            if(editMode&&editEntry) {
              const updateItem=(i,key,val)=>setEditEntry(e=>{ const items=[...e.items]; items[i]={...items[i],[key]:val}; return {...e,items}; });
              const removeItem=(i)=>setEditEntry(e=>({...e,items:e.items.filter((_,idx)=>idx!==i)}));
              const addItem=()=>setEditEntry(e=>({...e,items:[...e.items,{category:"Top",name:"",color:"Black",_isNew:true}]}));
              const applyKnown=(i,nameVal)=>{ const key=nameVal.trim().toLowerCase(); if(!key||!knownItems[key]) return; setEditEntry(prev=>{ const items=[...prev.items]; const cur=items[i]; if(!cur._isNew) return prev; const known=knownItems[key]; items[i]={...cur,category:known.category,color:known.color,price:known.price!=null?known.price:cur.price,_isNew:false,_recognized:true,_wearCount:known.count}; return {...prev,items}; }); };
              const saveEdit=()=>{ const cleanItems=editEntry.items.map(({_isNew,_recognized,_wearCount,_showColorPicker,...rest})=>rest); setPhotoData(p=>({...p,[toKey(selectedDate)]:{...p[toKey(selectedDate)],style:editEntry.style,formalityLevel:editEntry.formalityLevel,season:editEntry.season,notes:editEntry.notes||"",items:cleanItems}})); setEditMode(false); setEditEntry(null); };
              return (<>
                <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10 }}>Style</p>
                <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:16 }}>
                  {STYLES.map(s=><button key={s} onClick={()=>setEditEntry(e=>({...e,style:s}))} style={{ padding:"6px 14px",borderRadius:0,border:editEntry.style===s?"none":`1.5px solid ${C.border}`,background:editEntry.style===s?C.sage:C.white,color:editEntry.style===s?"#fff":C.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{s}</button>)}
                </div>
                <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10 }}>Formality</p>
                <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:16 }}>
                  {FORMALITY.map(f=><button key={f} onClick={()=>setEditEntry(e=>({...e,formalityLevel:f}))} style={{ padding:"6px 14px",borderRadius:0,border:editEntry.formalityLevel===f?"none":`1.5px solid ${C.border}`,background:editEntry.formalityLevel===f?"#5E6A5C":C.white,color:editEntry.formalityLevel===f?"#fff":C.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{f}</button>)}
                </div>
                <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10 }}>Season</p>
                <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:20 }}>
                  {SEASONS.map(s=><button key={s} onClick={()=>setEditEntry(e=>({...e,season:s}))} style={{ padding:"6px 14px",borderRadius:0,border:editEntry.season===s?"none":`1.5px solid ${C.border}`,background:editEntry.season===s?"#5E6A5C":C.white,color:editEntry.season===s?"#fff":C.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{s}</button>)}
                </div>
                <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10 }}>Items</p>
                {editEntry.items.map((item,i)=>(
                  <div key={i} style={{ background:"rgba(58,68,56,0.04)",borderRadius:0,padding:12,marginBottom:10,border:`1px solid rgba(58,68,56,0.15)` }}>
                    <div style={{ display:"flex",alignItems:"center",marginBottom:8,gap:8 }}>
                      <input value={item.name} onChange={e=>updateItem(i,"name",e.target.value)} onBlur={e=>applyKnown(i,e.target.value)} placeholder="Item name" style={{ flex:1,height:36,padding:"0 10px",borderRadius:0,border:`1.5px solid ${item._recognized?C.sage:C.border}`,background:C.white,fontSize:13,color:C.ink,outline:"none",fontFamily:"inherit" }}/>
                      <button onClick={()=>removeItem(i)} style={{ width:32,height:32,borderRadius:0,border:"none",background:"#FEF0EF",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0 }}><Trash2 size={14} color={C.red}/></button>
                    </div>
                    {item._recognized&&<div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:8 }}><span style={{ fontSize:11,fontWeight:700,color:C.sage }}>✓ Recognised</span><span style={{ fontSize:11,fontWeight:600,color:C.white,background:C.sage,borderRadius:0,padding:"1px 8px" }}>worn {item._wearCount} time{item._wearCount!==1?"s":""} before</span></div>}
                    <div style={{ display:"flex",gap:5,flexWrap:"wrap",marginBottom:8 }}>
                      {CATS.map(c=><button key={c} onClick={()=>updateItem(i,"category",c)} style={{ height:24,padding:"0 8px",borderRadius:0,border:"none",background:item.category===c?C.sage+"28":"transparent",color:item.category===c?C.sage:C.sub,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:4 }}><CatIcon cat={c} size={11} color={item.category===c?C.sage:C.sub}/>{c}</button>)}
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap" }}>
                      {toColors(item.color).filter(c=>colorHex[c]).map(c=><div key={c} style={{ display:"flex",alignItems:"center",gap:6,padding:"5px 10px",border:`1px solid ${C.border}`,background:C.white }}><div style={{ width:12,height:12,background:colorHex[c],border:(c==="White"||c==="Cream")?`1px solid ${C.border}`:"none",flexShrink:0 }}/><span style={{ fontSize:12,fontWeight:700,color:C.ink }}>{c}</span></div>)}
                      <button onClick={()=>updateItem(i,"_showColorPicker",!item._showColorPicker)} style={{ fontSize:12,fontWeight:600,color:C.sage,background:"none",border:`1px solid ${C.sage}`,padding:"5px 12px",cursor:"pointer",fontFamily:"inherit",borderRadius:0 }}>{item._showColorPicker?"Close":"Edit colour"}</button>
                    </div>
                    {item._showColorPicker&&<div style={{ display:"flex",gap:5,flexWrap:"wrap",marginBottom:8 }}>{COLORS.map(col=>{ const sel=toColors(item.color).includes(col); return <button key={col} onClick={()=>{ const cur=toColors(item.color); const nxt=sel?cur.filter(c=>c!==col):[...cur,col]; updateItem(i,"color",nxt.length===0?null:nxt.length===1?nxt[0]:nxt); }} title={col} style={{ width:52,border:sel?`2px solid ${C.sage}`:(col==="White"||col==="Cream")?`1px solid ${C.border}`:`1px solid transparent`,cursor:"pointer",padding:0,background:"transparent",flexShrink:0,overflow:"hidden" }}><div style={{ width:"100%",height:32,background:colorHex[col] }}/><div style={{ padding:"3px 4px",background:C.white,textAlign:"left" }}><div style={{ fontSize:9,fontWeight:700,color:C.ink,lineHeight:1.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{col}</div><div style={{ fontSize:8,color:C.sub,fontFamily:"monospace",lineHeight:1.3 }}>{colorHex[col]}</div></div></button>; })}</div>}
                    <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6 }}>
                      <span style={{ fontSize:12,fontWeight:700,color:C.sub }}>Price</span>
                      <div style={{ display:"flex",alignItems:"center",flex:1,height:34,borderRadius:0,border:`1.5px solid ${C.border}`,background:C.white,overflow:"hidden" }}>
                        <span style={{ padding:"0 8px",fontSize:13,color:C.sub,borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center" }}>£</span>
                        <input type="number" min="0" step="0.01" value={item.price||""} onChange={e=>updateItem(i,"price",e.target.value)} placeholder="0.00" style={{ flex:1,height:"100%",padding:"0 10px",border:"none",background:"transparent",fontSize:13,color:C.ink,outline:"none",fontFamily:"inherit" }}/>
                      </div>
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                      <span style={{ fontSize:12,fontWeight:700,color:C.sub }}>Brand</span>
                      <div style={{ display:"flex",alignItems:"center",flex:1,height:34,borderRadius:0,border:`1.5px solid ${C.border}`,background:C.white,overflow:"visible" }}>
                        <BrandPicker value={item.brand||""} onChange={v=>updateItem(i,"brand",v)}/>
                      </div>
                    </div>
                  </div>
                ))}
                <button onClick={addItem} style={{ width:"100%",height:44,borderRadius:0,border:`1.5px dashed ${C.border}`,background:"transparent",color:C.sub,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:16 }}><Plus size={16}/>Add Item</button>
                <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8 }}>Notes</p>
                <textarea value={editEntry.notes||""} onChange={e=>setEditEntry(prev=>({...prev,notes:e.target.value}))} placeholder="Any notes about this outfit…" style={{ width:"100%",minHeight:72,padding:"10px 14px",borderRadius:0,border:`1.5px solid ${C.border}`,background:C.surface,fontSize:14,color:C.ink,outline:"none",resize:"none",fontFamily:"inherit",boxSizing:"border-box",marginBottom:16 }} onFocus={e=>e.target.style.borderColor=C.sage} onBlur={e=>e.target.style.borderColor=C.border}/>
                <PrimaryBtn onClick={saveEdit} style={{ marginBottom:10 }}>Save Changes</PrimaryBtn>
                <button onClick={()=>{ setEditMode(false); setEditEntry(null); }} style={{ width:"100%",height:48,borderRadius:0,border:"none",background:C.surface,color:C.sub,fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
              </>);
            }

            // ── View mode ──
            const grouped={};
            (entry.items||[]).forEach((item,idx)=>{ const obj=typeof item==="object"&&item?item:{ name:String(item||""),category:"Other" }; const cat=obj.category||"Other"; if(!grouped[cat]) grouped[cat]=[]; grouped[cat].push({...obj,_idx:idx}); });
            const cats=[...ORDER.filter(c=>grouped[c]),...Object.keys(grouped).filter(c=>!ORDER.includes(c))];
            const toggleItem=(idx)=>setSelectedItemIdxs(prev=>{ const next=new Set(prev); if(next.has(idx)) next.delete(idx); else next.add(idx); return next; });
            const removeSelected=()=>{ const newItems=(entry.items||[]).filter((_,i)=>!selectedItemIdxs.has(i)); setPhotoData(p=>({...p,[toKey(selectedDate)]:{...p[toKey(selectedDate)],items:newItems}})); setSelectedItemIdxs(new Set()); };
            return (<>
              {entry.photo?<div style={{ display:"flex",justifyContent:"center",marginBottom:entry.style?10:14 }}><div style={{ width:"55%",borderRadius:0,overflow:"hidden",aspectRatio:"3/4" }}><img src={entry.photo} alt="Outfit" style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }}/></div></div>:<div style={{ background:C.sage+"14",borderRadius:0,padding:16,textAlign:"center",marginBottom:entry.style?10:14 }}><div style={{ fontSize:32 }}>👔</div><div style={{ fontSize:13,fontWeight:600,color:C.sage,marginTop:4 }}>Outfit logged</div></div>}
              {(entry.style||entry.formalityLevel||entry.season)&&<div style={{ display:"flex",justifyContent:"center",flexWrap:"wrap",gap:6,marginBottom:14 }}>{entry.style&&<span style={{ fontSize:12,fontWeight:700,color:C.sage,background:C.sage+"18",padding:"5px 14px",borderRadius:0,border:`1px solid ${C.sage}30` }}>{entry.style}</span>}{entry.formalityLevel&&<span style={{ fontSize:12,fontWeight:700,color:"#fff",background:"#5E6A5C",padding:"5px 14px",borderRadius:0 }}>{entry.formalityLevel}</span>}{entry.season&&<span style={{ fontSize:12,fontWeight:700,color:"#fff",background:"#5E6A5C",padding:"5px 14px",borderRadius:0 }}>{entry.season}</span>}</div>}
              {entry.notes&&<div style={{ background:C.surface,borderRadius:0,padding:"10px 14px",border:`1px solid ${C.border}`,marginBottom:14 }}><p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"0 0 4px" }}>Notes</p><p style={{ fontSize:13,color:C.ink,margin:0,lineHeight:1.5 }}>{entry.notes}</p></div>}
              <div style={{ marginBottom:16 }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
                  <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:0 }}>What I wore</p>
                  {selectedItemIdxs.size>0&&<button onClick={removeSelected} style={{ fontSize:12,fontWeight:700,color:C.red,background:"#FEF0EF",border:"none",borderRadius:0,padding:"4px 12px",cursor:"pointer",fontFamily:"inherit" }}>Remove {selectedItemIdxs.size} selected</button>}
                </div>
                {entry.analysing?(<div style={{background:C.surface,borderRadius:0,padding:20,display:"flex",flexDirection:"column",alignItems:"center",gap:10,border:`1px solid ${C.border}`}}><div style={{width:24,height:24,borderRadius:"50%",border:`2.5px solid ${C.sage}`,borderTopColor:"transparent",animation:"spin .7s linear infinite"}}/><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style><span style={{fontSize:13,color:C.sub,fontWeight:600}}>Analysing outfit with AI…</span></div>):cats.length>0?<div style={{ display:"flex",flexDirection:"column",gap:12 }}>{cats.map(cat=>(<div key={cat}><div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:6 }}><CatIcon cat={cat} size={13} color={C.sub}/><span style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em" }}>{cat}</span></div>{grouped[cat].map((item,i)=>{ const hex=item.color&&colorHex[item.color]?colorHex[item.color]:null; const isSel=selectedItemIdxs.has(item._idx); const isFav=favourites.some(f=>(f.name||"").trim().toLowerCase()===(item.name||"").trim().toLowerCase()); const wearCount=knownItems[(item.name||"").trim().toLowerCase()]?.count;
return <div key={i} style={{ width:"100%",background:isSel?C.sage+"14":C.surface,borderRadius:0,padding:"9px 12px",marginBottom:4,border:isSel?`1.5px solid ${C.sage}`:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:8 }}><div onClick={()=>toggleItem(item._idx)} style={{ width:18,height:18,borderRadius:"50%",border:isSel?"none":`1.5px solid ${C.border}`,background:isSel?C.sage:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer" }}>{isSel&&<span style={{ color:"#fff",fontSize:11,lineHeight:1 }}>✓</span>}</div>{hex&&<div style={{ width:12,height:12,background:hex,flexShrink:0,border:item.color==="White"?`1px solid ${C.border}`:"none" }}/>}<span onClick={()=>toggleItem(item._idx)} style={{ fontSize:13,color:C.ink,fontWeight:500,flex:1,cursor:"pointer" }}>{item.name||String(item)}</span>{wearCount>1&&<span style={{ fontSize:10,fontWeight:700,color:C.sage,background:C.sage+"18",borderRadius:0,padding:"2px 7px",flexShrink:0 }}>{wearCount}x</span>}{item.color&&<span style={{ fontSize:11,color:C.sub }}>{item.color}</span>}<button onClick={e=>{ e.stopPropagation(); onToggleFavourite&&onToggleFavourite(item); }} style={{ background:"none",border:"none",cursor:"pointer",padding:4,flexShrink:0,display:"flex",alignItems:"center" }}><Heart size={16} color={isFav?C.red:"#ccc"} fill={isFav?C.red:"none"}/></button></div>; })}</div>))}</div>:<div style={{ background:C.surface,borderRadius:0,padding:"10px 14px",border:`1px solid ${C.border}` }}><span style={{ fontSize:13,color:C.sub }}>No items added yet — tap Edit Outfit to add what you wore</span></div>}
              </div>
              <button onClick={()=>{ setEditEntry({ style:entry.style||null, formalityLevel:entry.formalityLevel||null, season:entry.season||null, notes:entry.notes||"", items:(entry.items||[]).map(item=>typeof item==="object"&&item?{...item}:{ name:String(item||""),category:"Other",color:null }) }); setEditMode(true); setSelectedItemIdxs(new Set()); }} style={{ width:"100%",height:50,borderRadius:0,border:`1.5px solid ${C.border}`,background:C.white,color:C.ink,fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:10 }}><Pencil size={16} color={C.sage}/>Edit Outfit</button>
              <DangerBtn onClick={()=>{ const dk=toKey(selectedDate); track("outfit_deleted",{date_key:dk}); setPhotoData(p=>{ const n={...p}; delete n[dk]; return n; }); setShowModal(false); }}>Remove Outfit Log</DangerBtn>
            </>);
          }
          return (<>
            <div style={{ background:C.surface,borderRadius:0,padding:20,textAlign:"center",marginBottom:16 }}><Camera size={32} color={C.sub}/><div style={{ fontSize:14,color:C.sub,marginTop:8 }}>No outfit logged for this day</div></div>
            <PrimaryBtn onClick={()=>{ if(!photoUploading) setShowSourcePicker(true); }}>{photoUploading?"Processing…":<><Camera size={16}/> Log Outfit</>}</PrimaryBtn>
            {showSourcePicker&&<div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",flexDirection:"column",justifyContent:"flex-end" }} onClick={()=>setShowSourcePicker(false)}>
              <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:0,padding:"8px 16px 40px" }}>
                <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
                <p style={{ fontSize:13,fontWeight:700,color:C.sub,textAlign:"center",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:16 }}>Add Outfit Photo</p>
                {cameraEnabled
                  ? <button onClick={()=>{ setShowSourcePicker(false); setShowCamera(true); }} style={{ width:"100%",height:56,borderRadius:0,border:"none",background:C.sage+"14",display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:10,cursor:"pointer",fontFamily:"inherit" }}><Camera size={20} color={C.sage}/><span style={{ fontSize:16,fontWeight:700,color:C.sage }}>Camera</span></button>
                  : <div style={{ width:"100%",height:48,borderRadius:0,background:C.border,display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10,opacity:.5 }}><Camera size={18} color={C.sub}/><span style={{ fontSize:14,fontWeight:600,color:C.sub }}>Camera (enable in Privacy)</span></div>
                }
                <label style={{ display:"block",cursor:"pointer" }}><input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>handlePhotoUpload(e.target.files[0])}/><div style={{ width:"100%",height:56,borderRadius:0,background:C.surface,border:`1.5px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:10 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span style={{ fontSize:16,fontWeight:700,color:C.ink }}>Camera Roll</span></div></label>
                <button onClick={()=>setShowSourcePicker(false)} style={{ width:"100%",height:52,borderRadius:0,border:"none",background:C.surface,color:C.sub,fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
              </div>
            </div>}
          </>);
        })()}
      </Modal>
    </div>
  );
}

function FavoritesScreen({ onBack, favourites=[], setFavourites, photoData={}, onGoToDate }) {
  const catEmoji=cat=>cat==="Top"?"👕":cat==="Bottom"?"👖":cat==="Shoes"?"👟":cat==="Outerwear"?"🧥":cat==="Accessories"?"💍":cat==="Dresses"?"👗":cat==="Swimwear"?"👙":"👔";
  const removeFav=(name)=>setFavourites(prev=>prev.filter(f=>(f.name||"").trim().toLowerCase()!==(name||"").trim().toLowerCase()));
  const [swipedFav,setSwipedFav]=useState(null);
  const touchStartX=useRef(null);

  // For each fav, find the most recent date it was worn
  const lastWornDate=(favName)=>{
    const key=(favName||"").trim().toLowerCase();
    const dates=Object.entries(photoData)
      .filter(([,e])=>e?.logged&&(e.items||[]).some(i=>(i.name||"").trim().toLowerCase()===key))
      .map(([d])=>d).sort().reverse();
    if(!dates[0]) return null;
    const [y,m,d]=dates[0].split("-").map(Number);
    return { key:dates[0], label:new Date(y,m-1,d).toLocaleDateString("en-US",{month:"short",day:"numeric"}) };
  };

  const favHeader = (count) => (
    <div style={{ background:"#fff",padding:"28px 24px 20px",flexShrink:0 }}>
      {onBack&&<button onClick={onBack} style={{ display:"flex",alignItems:"center",gap:4,border:"none",background:"transparent",color:C.sub,fontSize:13,cursor:"pointer",padding:"0 0 10px",fontFamily:"inherit" }}><ChevronLeft size={15} color={C.sub} strokeWidth={2}/>Back</button>}
      <div style={{ display:"flex",alignItems:"flex-end",justifyContent:"space-between" }}>
        <div>
          <h1 style={{ fontSize:34,fontWeight:900,color:C.ink,margin:0,letterSpacing:"-0.03em",lineHeight:1 }}>Favourites</h1>
          <p style={{ fontSize:13,color:C.sub,margin:"5px 0 0" }}>Your saved pieces</p>
        </div>
        {count>0&&<span style={{ fontSize:13,fontWeight:700,color:C.sub,marginBottom:2 }}>{count} item{count!==1?"s":""}</span>}
      </div>
    </div>
  );

  if(favourites.length===0) return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",background:"#fff" }}>
      {favHeader(0)}
      <div style={{ borderTop:"1px solid rgba(58,68,56,0.3)",flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32 }}>
        <Heart size={52} color={C.sub} strokeWidth={1} style={{ marginBottom:16 }}/>
        <h2 style={{ fontSize:18,fontWeight:900,color:C.ink,margin:"0 0 8px",letterSpacing:"-0.01em" }}>No Favourites Yet</h2>
        <p style={{ fontSize:13,color:C.sub,textAlign:"center",margin:0,lineHeight:1.6 }}>Tap the heart on any item in your calendar outfit log to save it here.</p>
      </div>
    </div>
  );
  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"#fff" }}>
      {favHeader(favourites.length)}
      <div style={{ flex:1,overflowY:"auto",borderTop:"1px solid rgba(58,68,56,0.3)" }}>
        {favourites.map((fav,i)=>{
          const favColors=toColors(fav.color).filter(c=>colorHex[c]);
          const worn=lastWornDate(fav.name);
          const favItemPhoto=(()=>{ const k=(fav.name||"").trim().toLowerCase(); const sorted=Object.entries(photoData).sort(([a],[b])=>b.localeCompare(a)); for(const [,entry] of sorted){ if(!entry?.logged) continue; const match=(entry.items||[]).find(item=>item&&typeof item==="object"&&(item.name||"").trim().toLowerCase()===k); if(match) return match.itemPhoto||entry.photo||null; } return null; })();
          return (
            <div key={i} style={{ position:"relative",overflow:"hidden",borderBottom:"1px solid rgba(58,68,56,0.3)" }}>
              <button onClick={()=>{ removeFav(fav.name); setSwipedFav(null); }} style={{ position:"absolute",right:0,top:0,bottom:0,width:80,background:C.red,display:"flex",alignItems:"center",justifyContent:"center",border:"none",cursor:"pointer" }}><Trash2 size={20} color="#fff"/></button>
              <div
                onTouchStart={e=>{ touchStartX.current=e.touches[0].clientX; }}
                onTouchEnd={e=>{ const dx=e.changedTouches[0].clientX-(touchStartX.current||0); if(dx<-50) setSwipedFav(fav.name); else if(dx>20) setSwipedFav(null); }}
                style={{ background:"#fff",padding:"16px 24px",transform:swipedFav===fav.name?"translateX(-80px)":"translateX(0)",transition:"transform .2s ease",position:"relative" }}
              >
              <div style={{ display:"flex",alignItems:"center",gap:14 }}>
                <div style={{ width:50,height:50,background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,overflow:"hidden" }}>{favItemPhoto?<img src={favItemPhoto} alt={fav.name} style={{ width:"100%",height:"100%",objectFit:"contain" }}/>:catEmoji(fav.category)}</div>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontSize:15,fontWeight:700,color:C.ink,marginBottom:4 }}>{fav.name}</div>
                  <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
                    <span style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.06em" }}>{fav.category}</span>
                    {favColors.length>0&&<div style={{ display:"flex",gap:3 }}>{favColors.map(c=><div key={c} style={{ width:10,height:10,borderRadius:"50%",background:colorHex[c],border:(c==="White"||c==="Cream")?`1px solid ${C.border}`:"none" }}/>)}</div>}
                    {fav.price&&<span style={{ fontSize:11,color:C.sub }}>£{fav.price}</span>}
                  </div>
                </div>
                <button onClick={()=>removeFav(fav.name)} style={{ background:"none",border:"none",cursor:"pointer",padding:6,flexShrink:0 }}><Heart size={20} color={C.red} fill={C.red}/></button>
              </div>
              {worn&&onGoToDate&&(
                <button onClick={()=>onGoToDate(worn.key)} style={{ marginTop:12,width:"100%",height:34,borderRadius:0,border:"1px solid rgba(58,68,56,0.3)",background:"transparent",color:C.ink,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
                  <Calendar size={12} color={C.ink}/>Last worn {worn.label} — tap to view
                </button>
              )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function AuthScreen({ onAuth, initialView="landing" }) {
  const [view, setView] = useState(initialView); // "landing" | "signin" | "signup" | "forgot" | "forgot-sent"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");
  const [recoverEmail, setRecoverEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const inputStyle = { width:"100%",height:52,padding:"0 16px",borderRadius:0,border:`1.5px solid ${C.border}`,background:C.white,fontSize:15,color:C.ink,outline:"none",boxSizing:"border-box",fontFamily:"inherit" };
  const focusStyle = (e) => e.target.style.borderColor = C.sage;
  const blurStyle  = (e) => e.target.style.borderColor = C.border;

  const Logo = () => (
    <div style={{ width:72,height:72,borderRadius:16,background:C.ink,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px" }}><Shirt size={36} color="#FFFFFF" strokeWidth={1.5}/></div>
  );

  const ErrorMsg = () => error ? (
    <div style={{ background:"#FEF0EF",border:"1px solid #F4C5C0",borderRadius:0,padding:"10px 14px",fontSize:13,color:"#C0392B",marginBottom:16,textAlign:"center" }}>{error}</div>
  ) : null;

  const friendlyAuthError = (msg="") => {
    const m = msg.toLowerCase();
    if (m.includes("user already registered") || m.includes("already been registered")) return "An account with this email already exists. Try signing in instead.";
    if (m.includes("invalid login credentials") || m.includes("invalid credentials")) return "Incorrect email or password.";
    if (m.includes("email not confirmed")) return "Please confirm your email address before signing in. Check your inbox.";
    if (m.includes("invalid email") || m.includes("unable to validate email") || m.includes("valid email")) return "Please enter a valid email address.";
    if (m.includes("password should be at least") || m.includes("password must be")) return "Password must be at least 6 characters.";
    if (m.includes("weak password") || m.includes("should be stronger")) return "Password is too weak. Try adding numbers or symbols.";
    if (m.includes("rate limit") || m.includes("too many requests") || m.includes("email rate")) return "Too many attempts. Please wait a moment and try again.";
    if (m.includes("network") || m.includes("fetch")) return "Network error. Please check your connection and try again.";
    return msg || "Something went wrong. Please try again.";
  };

  const handleSignIn = async () => {
    setError("");
    if (!email || !password) { setError("Please fill in all fields."); return; }
    setLoading(true);
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setLoading(false);
      setError(friendlyAuthError(authError.message));
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("photo_data,favourites,Username").eq("id", data.user.id).maybeSingle();
    if (!profile) {
      // First sign-in after email confirmation — create profile using username stored in metadata
      const uname = data.user.user_metadata?.username || "";
      await supabase.from("profiles").insert({ id: data.user.id, photo_data:{}, favourites:[], Username: uname });
      setLoading(false);
      onAuth(data.user.email, {}, [], data.user.id, uname);
      return;
    }
    setLoading(false);
    await track("user_signed_in");
    onAuth(data.user.email, profile?.photo_data||{}, profile?.favourites||[], data.user.id, profile?.Username||data.user.user_metadata?.username||"");
  };

  const handleSignUp = async () => {
    setError("");
    if (!username || !email || !password || !confirmPassword) { setError("Please fill in all fields."); return; }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) { setError("Username must be 3–20 characters and contain only lowercase letters, numbers, and underscores."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    const { data: taken } = await supabase.from("profiles").select("id").eq("Username", username).maybeSingle();
    if (taken) { setLoading(false); setError("That username is already taken. Please choose another."); return; }
    const { data, error: authError } = await supabase.auth.signUp({ email, password, options:{ emailRedirectTo: window.location.origin, data:{ username } } });
    if (authError) { setLoading(false); setError(friendlyAuthError(authError.message)); return; }
    if (!data.session) { setLoading(false); setView("confirm-email"); return; }
    await supabase.from("profiles").insert({ id: data.user.id, photo_data:{}, favourites:[], Username: username });
    await track("user_signed_up", { username });
    setLoading(false);
    onAuth(data.user.email, {}, [], data.user.id, username);
  };

  // ── Landing ──────────────────────────────────────────────────────────────
  if (view === "landing") return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:C.surface,padding:32 }}>
      <Logo/>
      <h1 style={{ fontSize:32,fontWeight:900,color:C.ink,margin:"0 0 8px",textAlign:"center",letterSpacing:"-0.03em" }}>Stylewrap</h1>
      <p style={{ fontSize:15,color:C.sub,margin:"0 0 40px",textAlign:"center" }}>Your personal style companion</p>
      <button onClick={()=>{ setError(""); setEmail(""); setPassword(""); setView("signin"); }} style={{ width:"100%",height:54,borderRadius:0,border:"none",background:C.ink,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:12 }}>Sign In</button>
      <button onClick={()=>{ setError(""); setEmail(""); setPassword(""); setConfirmPassword(""); setView("signup"); }} style={{ width:"100%",height:54,borderRadius:0,border:`2px solid ${C.ink}`,background:"transparent",color:C.ink,fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Sign Up</button>
    </div>
  );

  // ── Sign Up form ──────────────────────────────────────────────────────────
  if (view === "signup") return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",background:C.surface,padding:32,overflowY:"auto" }}>
      <button onClick={()=>setView("landing")} style={{ alignSelf:"flex-start",width:36,height:36,borderRadius:0,border:`1px solid ${C.border}`,background:C.white,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",marginBottom:28 }}><ChevronLeft size={20} color={C.ink}/></button>
      <Logo/>
      <h2 style={{ fontSize:26,fontWeight:900,color:C.ink,margin:"0 0 6px",textAlign:"center",letterSpacing:"-0.03em" }}>Create account</h2>
      <p style={{ fontSize:14,color:C.sub,margin:"0 0 24px",textAlign:"center" }}>Start tracking your outfits</p>

      <ErrorMsg/>

      <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"0 0 8px" }}>Username</p>
      <div style={{ position:"relative" }}>
        <span style={{ position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",fontSize:15,color:C.sub,fontWeight:600,pointerEvents:"none",userSelect:"none" }}>@</span>
        <input value={username} onChange={e=>setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,""))} placeholder="yourname" maxLength={20} style={{...inputStyle,paddingLeft:32}} onFocus={focusStyle} onBlur={blurStyle}/>
      </div>
      <p style={{ fontSize:11,color:C.sub,margin:"6px 0 0",lineHeight:1.5 }}>3–20 characters · letters, numbers, underscores · cannot be changed later</p>

      <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"18px 0 8px" }}>Email Address</p>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle}/>

      <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"18px 0 8px" }}>Password</p>
      <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle}/>

      <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"18px 0 8px" }}>Confirm Password</p>
      <input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="••••••••" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} onKeyDown={e=>e.key==="Enter"&&handleSignUp()}/>

      <button onClick={handleSignUp} disabled={loading} style={{ width:"100%",height:54,borderRadius:0,border:"none",background:C.ink,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginTop:28,opacity:loading?0.7:1 }}>{loading?"Creating account…":"Create Account"}</button>

      <p style={{ textAlign:"center",fontSize:14,color:C.sub,marginTop:20 }}>Already have an account? <button onClick={()=>{ setError(""); setView("signin"); }} style={{ background:"none",border:"none",color:C.sage,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"inherit" }}>Sign In</button></p>
    </div>
  );

  // ── Confirm Email ─────────────────────────────────────────────────────────
  if (view === "confirm-email") return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:C.surface,padding:32 }}>
      <Logo/>
      <div style={{ fontSize:48,marginBottom:16 }}>📧</div>
      <h2 style={{ fontSize:26,fontWeight:900,color:C.ink,margin:"0 0 10px",textAlign:"center",letterSpacing:"-0.03em" }}>Check your email</h2>
      <p style={{ fontSize:14,color:C.sub,textAlign:"center",margin:"0 0 28px",lineHeight:1.6 }}>We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account, then come back to sign in.</p>
      <button onClick={()=>setView("signin")} style={{ width:"100%",height:54,borderRadius:0,border:"none",background:C.ink,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Go to Sign In</button>
    </div>
  );

  // ── Sign In form ──────────────────────────────────────────────────────────
  if (view === "signin") return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",background:C.surface,padding:32,overflowY:"auto" }}>
      <button onClick={()=>setView("landing")} style={{ alignSelf:"flex-start",width:36,height:36,borderRadius:0,border:`1px solid ${C.border}`,background:C.white,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",marginBottom:28 }}><ChevronLeft size={20} color={C.ink}/></button>
      <Logo/>
      <h2 style={{ fontSize:26,fontWeight:900,color:C.ink,margin:"0 0 6px",textAlign:"center",letterSpacing:"-0.03em" }}>Welcome back</h2>
      <p style={{ fontSize:14,color:C.sub,margin:"0 0 24px",textAlign:"center" }}>Sign in to your account</p>

      <ErrorMsg/>

      <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"0 0 8px" }}>Email Address</p>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle}/>

      <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"18px 0 8px" }}>Password</p>
      <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} onKeyDown={e=>e.key==="Enter"&&handleSignIn()}/>

      <div style={{ display:"flex",justifyContent:"flex-end",marginTop:14,marginBottom:4 }}>
        <button onClick={()=>setView("forgot")} style={{ background:"none",border:"none",color:C.sage,fontSize:13,fontWeight:600,cursor:"pointer",padding:"8px 0",fontFamily:"inherit" }}>Forgot password?</button>
      </div>

      <button onClick={handleSignIn} disabled={loading} style={{ width:"100%",height:54,borderRadius:0,border:"none",background:C.ink,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",opacity:loading?0.7:1 }}>{loading?"Signing in…":"Sign In"}</button>

      <p style={{ textAlign:"center",fontSize:14,color:C.sub,marginTop:20 }}>Don't have an account? <button onClick={()=>{ setError(""); setEmail(""); setPassword(""); setConfirmPassword(""); setView("signup"); }} style={{ background:"none",border:"none",color:C.sage,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"inherit" }}>Sign Up</button></p>
    </div>
  );

  // ── Forgot password — enter email ────────────────────────────────────────
  if (view === "forgot") {
    const sendLink = async () => {
      setError("");
      if (!recoverEmail || !/\S+@\S+\.\S+/.test(recoverEmail)) { setError("Please enter a valid email address."); return; }
      setLoading(true);
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(recoverEmail, { redirectTo: window.location.origin });
      setLoading(false);
      if (resetErr) { setError(resetErr.message || "Failed to send reset email. Please try again."); return; }
      setView("forgot-sent");
    };
    return (
      <div style={{ flex:1,display:"flex",flexDirection:"column",background:C.surface,padding:32,overflowY:"auto" }}>
        <button onClick={()=>{ setError(""); setView("signin"); }} style={{ alignSelf:"flex-start",width:36,height:36,borderRadius:0,border:`1px solid ${C.border}`,background:C.white,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",marginBottom:28 }}><ChevronLeft size={20} color={C.ink}/></button>
        <div style={{ width:72,height:72,borderRadius:16,background:C.ink,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px" }}><AtSign size={32} color="#fff" strokeWidth={1.5}/></div>
        <h2 style={{ fontSize:26,fontWeight:900,color:C.ink,margin:"0 0 6px",textAlign:"center",letterSpacing:"-0.03em" }}>Reset Password</h2>
        <p style={{ fontSize:14,color:C.sub,margin:"0 0 28px",textAlign:"center" }}>Enter your email and we'll send you a reset link.</p>
        <ErrorMsg/>
        <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"0 0 8px" }}>Email Address</p>
        <input type="email" value={recoverEmail} onChange={e=>setRecoverEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendLink()} placeholder="you@example.com" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle}/>
        <button onClick={sendLink} disabled={loading} style={{ width:"100%",height:54,borderRadius:0,border:"none",background:recoverEmail?C.ink:C.border,color:recoverEmail?"#fff":C.sub,fontSize:16,fontWeight:700,cursor:recoverEmail?"pointer":"not-allowed",fontFamily:"inherit",marginTop:24,opacity:loading?0.7:1 }}>{loading?"Sending…":"Send Reset Link"}</button>
      </div>
    );
  }

  // ── Forgot password — sent ────────────────────────────────────────────────
  if (view === "forgot-sent") return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:C.surface,padding:32 }}>
      <div style={{ width:80,height:80,borderRadius:16,background:C.ink,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:24 }}><AtSign size={36} color="#fff" strokeWidth={1.5}/></div>
      <h2 style={{ fontSize:26,fontWeight:900,color:C.ink,margin:"0 0 10px",textAlign:"center",letterSpacing:"-0.03em" }}>Check your email</h2>
      <p style={{ fontSize:15,color:C.sub,margin:"0 0 6px",textAlign:"center" }}>We sent a password reset link to</p>
      <p style={{ fontSize:15,fontWeight:700,color:C.ink,margin:"0 0 12px",textAlign:"center" }}>{recoverEmail}</p>
      <p style={{ fontSize:13,color:C.sub,margin:"0 0 36px",textAlign:"center" }}>Click the link in the email, then follow the steps to set your new password.</p>
      <button onClick={()=>{ setError(""); setView("signin"); }} style={{ width:"100%",height:54,borderRadius:0,border:"none",background:C.ink,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Back to Sign In</button>
    </div>
  );
}

function ProfileScreen({ onSettings, onNotifications, onPrivacy, onBack, onSignOut, userEmail="", username="" }) {
  const [profileImage, setProfileImage] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);

  const handleImageFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setProfileImage(e.target.result);
    reader.readAsDataURL(file);
    setShowPicker(false);
  };

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"#fff" }}>
      <input ref={galleryRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e=>handleImageFile(e.target.files[0])}/>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={e=>handleImageFile(e.target.files[0])}/>

      {showSignOutConfirm && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"flex-end" }} onClick={()=>setShowSignOutConfirm(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",width:"100%",padding:"8px 24px 44px" }}>
            <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
            <div style={{ textAlign:"center",marginBottom:24 }}>
              <div style={{ width:56,height:56,background:"#FEF0EF",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px" }}><LogOut size={24} color={C.red}/></div>
              <h2 style={{ fontSize:20,fontWeight:900,color:C.ink,margin:"0 0 6px",letterSpacing:"-0.02em" }}>Are you sure?</h2>
              <p style={{ fontSize:14,color:C.sub,margin:0 }}>You will be signed out of your account.</p>
            </div>
            <button onClick={onSignOut} style={{ width:"100%",height:54,border:`1px solid ${C.red}`,background:"transparent",color:C.red,fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}><LogOut size={18}/>Sign Out</button>
            <button onClick={()=>setShowSignOutConfirm(false)} style={{ width:"100%",height:54,border:"1px solid rgba(58,68,56,0.3)",background:"transparent",color:C.ink,fontSize:16,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
          </div>
        </div>
      )}

      {showPicker && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"flex-end" }} onClick={()=>setShowPicker(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",width:"100%",padding:"8px 24px 44px" }}>
            <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
            <h2 style={{ fontSize:20,fontWeight:800,color:C.ink,margin:"0 0 20px",letterSpacing:"-0.02em" }}>Change Profile Photo</h2>
            <button onClick={()=>{ setShowPicker(false); setTimeout(()=>galleryRef.current?.click(),100); }} style={{ width:"100%",height:54,border:"1px solid rgba(58,68,56,0.3)",background:"transparent",color:C.ink,fontSize:15,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:14,padding:"0 18px",fontFamily:"inherit",marginBottom:10 }}><Camera size={18} color={C.ink}/>Camera Roll</button>
            <button onClick={()=>{ setShowPicker(false); setTimeout(()=>cameraRef.current?.click(),100); }} style={{ width:"100%",height:54,border:"1px solid rgba(58,68,56,0.3)",background:"transparent",color:C.ink,fontSize:15,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:14,padding:"0 18px",fontFamily:"inherit",marginBottom:10 }}><Camera size={18} color={C.ink}/>Camera</button>
            <button onClick={()=>setShowPicker(false)} style={{ width:"100%",height:48,border:"none",background:C.surface,color:C.sub,fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background:"#fff",padding:"28px 24px 20px",flexShrink:0 }}>
        {onBack&&<button onClick={onBack} style={{ display:"flex",alignItems:"center",gap:4,border:"none",background:"transparent",color:C.sub,fontSize:13,cursor:"pointer",padding:"0 0 10px",fontFamily:"inherit" }}><ChevronLeft size={15} color={C.sub} strokeWidth={2}/>Back</button>}
        <div style={{ display:"flex",alignItems:"center",gap:16 }}>
          <button onClick={()=>setShowPicker(true)} style={{ width:64,height:64,borderRadius:"50%",background:C.surface,border:"1px solid rgba(58,68,56,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,cursor:"pointer",padding:0,overflow:"hidden",flexShrink:0 }}>
            {profileImage?<img src={profileImage} alt="Profile" style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }}/>:<User size={28} color={C.sub} strokeWidth={1.5}/>}
          </button>
          <div>
            <h1 style={{ fontSize:26,fontWeight:900,color:C.ink,margin:"0 0 2px",letterSpacing:"-0.03em",lineHeight:1 }}>{username?`@${username}`:userEmail?(userEmail.split("@")[0].replace(/[._-]/g," ").replace(/\b\w/g,c=>c.toUpperCase())):"My Wardrobe"}</h1>
            <p style={{ fontSize:13,color:C.sub,margin:0 }}>{userEmail||"Style enthusiast"}</p>
          </div>
        </div>
      </div>

      {/* Menu */}
      <div style={{ flex:1,overflowY:"auto",borderTop:"1px solid rgba(58,68,56,0.3)" }}>
        {[{ icon:<Bell size={18} color={C.ink}/>,label:"Notifications",sub:"Push alerts",action:onNotifications },{ icon:<Shield size={18} color={C.ink}/>,label:"Privacy",sub:"Data & permissions",action:onPrivacy },{ icon:<Phone size={18} color={C.ink}/>,label:"Settings",sub:"App preferences",action:onSettings }].map((item,i)=>(
          <button key={i} onClick={item.action} style={{ width:"100%",background:"#fff",padding:"18px 24px",borderBottom:"1px solid rgba(58,68,56,0.3)",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,fontFamily:"inherit",border:"none",borderBottom:"1px solid rgba(58,68,56,0.3)",boxSizing:"border-box" }}>
            <div style={{ width:38,height:38,borderRadius:8,background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>{item.icon}</div>
            <div style={{ flex:1 }}><div style={{ fontSize:15,fontWeight:600,color:C.ink }}>{item.label}</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>{item.sub}</div></div>
            <ChevronRight size={16} color={C.sub}/>
          </button>
        ))}
        <button onClick={()=>setShowSignOutConfirm(true)} style={{ width:"100%",padding:"18px 24px",border:"none",borderTop:"1px solid rgba(58,68,56,0.3)",background:"transparent",color:C.red,fontSize:15,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"inherit",marginTop:8,boxSizing:"border-box" }}><LogOut size={18}/> Sign Out</button>
      </div>
    </div>
  );
}

function SettingsScreen({ onBack, username="" }) {
  const [panel,setPanel]=useState(null); // null | "password" | "phone" | "name" | "dob" | "delete"
  const [curPw,setCurPw]=useState(""); const [newPw,setNewPw]=useState(""); const [confPw,setConfPw]=useState("");
  const [phone,setPhone]=useState(""); const [firstName,setFirstName]=useState(""); const [lastName,setLastName]=useState("");
  const [dob,setDob]=useState("");
  const [msg,setMsg]=useState(""); const [err,setErr]=useState("");

  const handleDobChange=(val)=>{
    const digits=val.replace(/\D/g,"").slice(0,8);
    let formatted=digits;
    if(digits.length>2) formatted=digits.slice(0,2)+"/"+digits.slice(2);
    if(digits.length>4) formatted=digits.slice(0,2)+"/"+digits.slice(2,4)+"/"+digits.slice(4);
    setDob(formatted);
  };

  const validateDob=(val)=>{
    if(!/^\d{2}\/\d{2}\/\d{4}$/.test(val)) return "Please enter a date in DD/MM/YYYY format.";
    const [d,m,y]=val.split("/").map(Number);
    if(m<1||m>12) return "Month must be between 01 and 12.";
    const daysInMonth=new Date(y,m,0).getDate();
    if(d<1||d>daysInMonth) return `Day must be between 01 and ${daysInMonth} for this month.`;
    if(y<1900) return "Please enter a valid year.";
    if(new Date(y,m-1,d)>new Date()) return "Date of birth cannot be in the future.";
    if(new Date().getFullYear()-y>120) return "Please enter a valid date of birth.";
    return null;
  };

  const handleSaveDob=async()=>{
    setErr(""); setMsg("");
    const validationErr=validateDob(dob);
    if(validationErr){setErr(validationErr);return;}
    const {error}=await supabase.auth.updateUser({data:{date_of_birth:dob}});
    if(error){setErr(error.message);return;}
    setMsg("Date of birth saved successfully.");
  };
  const inputStyle={width:"100%",height:48,padding:"0 14px",borderRadius:0,border:`1.5px solid ${C.border}`,background:C.white,fontSize:14,color:C.ink,outline:"none",fontFamily:"inherit",boxSizing:"border-box",marginBottom:12};
  const labelStyle={fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",display:"block",marginBottom:6};

  const handleChangePassword=async()=>{
    setErr(""); setMsg("");
    if(!curPw||!newPw||!confPw){setErr("Please fill in all fields.");return;}
    if(newPw!==confPw){setErr("New passwords do not match.");return;}
    if(newPw.length<6){setErr("Password must be at least 6 characters.");return;}
    const {error}=await supabase.auth.updateUser({password:newPw});
    if(error){setErr(error.message);return;}
    setMsg("Password updated successfully."); setCurPw(""); setNewPw(""); setConfPw("");
  };

  const [phoneStep,setPhoneStep]=useState("enter"); // "enter" | "verify"
  const [otp,setOtp]=useState("");
  const [phoneSending,setPhoneSending]=useState(false);

  const handleSendCode=async()=>{
    setErr(""); setMsg("");
    if(!phone){setErr("Please enter a phone number.");return;}
    const formatted=phone.trim().startsWith("+")?phone.trim():"+"+phone.trim();
    setPhoneSending(true);
    const {error}=await supabase.auth.updateUser({ phone: formatted });
    setPhoneSending(false);
    if(error){setErr(error.message);return;}
    setPhone(formatted);
    setPhoneStep("verify");
    setMsg("Verification code sent to "+formatted);
  };

  const handleVerifyCode=async()=>{
    setErr(""); setMsg("");
    if(!otp||otp.length<6){setErr("Please enter the 6-digit code.");return;}
    const {error}=await supabase.auth.verifyOtp({ phone, token:otp, type:"phone_change" });
    if(error){setErr(error.message);return;}
    setMsg("Phone number updated successfully.");
    setPhoneStep("enter"); setPhone(""); setOtp("");
  };

  const handleSaveName=async()=>{
    setErr(""); setMsg("");
    if(!firstName&&!lastName){setErr("Please enter at least a first name.");return;}
    const {error}=await supabase.auth.updateUser({data:{first_name:firstName,last_name:lastName}});
    if(error){setErr(error.message);return;}
    setMsg("Name updated successfully.");
  };

  const handleDeleteAccount=async()=>{
    setErr("");
    await supabase.auth.signOut();
    window.location.reload();
  };

  const Section=({title,sub,children})=>(
    <div style={{ background:C.white,borderRadius:0,padding:20,marginBottom:14,border:`1px solid ${C.border}` }}>
      <h3 style={{ fontSize:15,fontWeight:700,color:C.ink,margin:"0 0 4px" }}>{title}</h3>
      <p style={{ fontSize:12,color:C.sub,margin:"0 0 16px",lineHeight:1.5 }}>{sub}</p>
      {children}
    </div>
  );

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
      <div style={{ background:C.white,padding:"16px 20px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0 }}>
        <button onClick={panel?()=>{setPanel(null);setErr("");setMsg("");}:onBack} style={{ width:36,height:36,borderRadius:0,border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={20} color={C.sage}/></button>
        <h1 style={{ fontSize:22,fontWeight:800,color:C.ink,margin:0 }}>{panel?"Settings":"Settings"}</h1>
      </div>
      <div style={{ flex:1,overflowY:"auto",padding:16,paddingBottom:32 }}>
        {!panel&&(<>
          {username&&(
            <div style={{ background:C.white,borderRadius:0,padding:"14px 16px",marginBottom:10,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:14 }}>
              <div style={{ width:40,height:40,borderRadius:0,background:C.sage+"14",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><AtSign size={18} color={C.sage}/></div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:15,fontWeight:600,color:C.ink }}>Username</div>
                <div style={{ fontSize:13,fontWeight:700,color:C.sage,marginTop:2 }}>@{username}</div>
              </div>
              <div style={{ fontSize:11,fontWeight:700,color:C.sub,background:C.surface,padding:"3px 8px",border:`1px solid ${C.border}` }}>Permanent</div>
            </div>
          )}
          {[{id:"password",title:"Change Password",sub:"Enter your current password and choose a new one."},{id:"phone",title:"Update Phone Number",sub:"Enter your new phone number to receive a verification code."},{id:"name",title:"Change Name",sub:"Update your display name."},{id:"dob",title:"Date of Birth",sub:"Update your date of birth."}].map(item=>(
            <button key={item.id} onClick={()=>{setPanel(item.id);setErr("");setMsg("");}} style={{ width:"100%",background:C.white,borderRadius:0,padding:"14px 16px",marginBottom:10,border:`1px solid ${C.border}`,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,fontFamily:"inherit" }}>
              <div style={{ flex:1 }}><div style={{ fontSize:15,fontWeight:600,color:C.ink }}>{item.title}</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>{item.sub}</div></div>
              <ChevronRight size={18} color={C.border}/>
            </button>
          ))}
          <div style={{ marginTop:24,marginBottom:8 }}>
            <p style={{ fontSize:11,fontWeight:700,color:C.red,textTransform:"uppercase",letterSpacing:"0.1em",margin:"0 0 10px" }}>Danger Zone</p>
            <button onClick={()=>setPanel("delete")} style={{ width:"100%",background:"#FEF0EF",borderRadius:0,padding:"14px 16px",border:`1px solid ${C.red}30`,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,fontFamily:"inherit" }}>
              <div style={{ flex:1 }}><div style={{ fontSize:15,fontWeight:600,color:C.red }}>Delete Account</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>Permanently delete your account</div></div>
              <ChevronRight size={18} color={C.red}/>
            </button>
          </div>
        </>)}

        {panel==="password"&&(
          <Section title="Change Password" sub="Enter your current password and choose a new one.">
            {err&&<div style={{ background:"#FEF0EF",border:"1px solid #F4C5C0",borderRadius:0,padding:"8px 12px",fontSize:13,color:C.red,marginBottom:12 }}>{err}</div>}
            {msg&&<div style={{ background:C.sage+"18",border:`1px solid ${C.sage}40`,borderRadius:0,padding:"8px 12px",fontSize:13,color:C.sage,marginBottom:12 }}>{msg}</div>}
            <label style={labelStyle}>Current Password</label>
            <input type="password" value={curPw} onChange={e=>setCurPw(e.target.value)} placeholder="••••••••" style={inputStyle}/>
            <label style={labelStyle}>New Password</label>
            <input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="••••••••" style={inputStyle}/>
            <label style={labelStyle}>Confirm New Password</label>
            <input type="password" value={confPw} onChange={e=>setConfPw(e.target.value)} placeholder="••••••••" style={{...inputStyle,marginBottom:16}}/>
            <button onClick={handleChangePassword} style={{ width:"100%",height:48,borderRadius:0,border:"none",background:C.sage,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:10 }}>Change Password</button>
            <button onClick={()=>{setPanel(null);setErr("");setMsg("");}} style={{ width:"100%",height:48,borderRadius:0,border:`1.5px solid ${C.border}`,background:"transparent",color:C.sub,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
          </Section>
        )}

        {panel==="phone"&&(
          <Section title="Update Phone Number" sub={phoneStep==="enter"?"Enter your new phone number including country code (e.g. +44 7700 000000).":"Enter the 6-digit code sent to "+phone+"."}>
            {err&&<div style={{ background:"#FEF0EF",border:"1px solid #F4C5C0",borderRadius:0,padding:"8px 12px",fontSize:13,color:C.red,marginBottom:12 }}>{err}</div>}
            {msg&&<div style={{ background:C.sage+"18",border:`1px solid ${C.sage}40`,borderRadius:0,padding:"8px 12px",fontSize:13,color:C.sage,marginBottom:12 }}>{msg}</div>}
            {phoneStep==="enter"?(
              <>
                <label style={labelStyle}>Phone Number</label>
                <input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+44 7700 000000" style={{...inputStyle,marginBottom:16}}/>
                <button onClick={handleSendCode} disabled={phoneSending} style={{ width:"100%",height:48,borderRadius:0,border:"none",background:phoneSending?C.border:C.sage,color:"#fff",fontSize:14,fontWeight:700,cursor:phoneSending?"not-allowed":"pointer",fontFamily:"inherit",marginBottom:10 }}>{phoneSending?"Sending…":"Send Verification Code"}</button>
              </>
            ):(
              <>
                <label style={labelStyle}>Verification Code</label>
                <input type="text" inputMode="numeric" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,""))} placeholder="000000" style={{...inputStyle,letterSpacing:"0.3em",fontSize:22,fontWeight:700,textAlign:"center",marginBottom:16}}/>
                <button onClick={handleVerifyCode} style={{ width:"100%",height:48,borderRadius:0,border:"none",background:C.sage,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:10 }}>Verify & Save</button>
                <button onClick={()=>{setPhoneStep("enter");setOtp("");setErr("");setMsg("");}} style={{ width:"100%",height:40,borderRadius:0,border:"none",background:"transparent",color:C.sage,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",marginBottom:10 }}>Resend code</button>
              </>
            )}
            <button onClick={()=>{setPanel(null);setErr("");setMsg("");setPhoneStep("enter");setPhone("");setOtp("");}} style={{ width:"100%",height:48,borderRadius:0,border:`1.5px solid ${C.border}`,background:"transparent",color:C.sub,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
          </Section>
        )}

        {panel==="name"&&(
          <Section title="Change Name" sub="Update your display name.">
            {err&&<div style={{ background:"#FEF0EF",border:"1px solid #F4C5C0",borderRadius:0,padding:"8px 12px",fontSize:13,color:C.red,marginBottom:12 }}>{err}</div>}
            {msg&&<div style={{ background:C.sage+"18",border:`1px solid ${C.sage}40`,borderRadius:0,padding:"8px 12px",fontSize:13,color:C.sage,marginBottom:12 }}>{msg}</div>}
            <label style={labelStyle}>First Name</label>
            <input value={firstName} onChange={e=>setFirstName(e.target.value)} placeholder="Sarah" style={inputStyle}/>
            <label style={labelStyle}>Last Name</label>
            <input value={lastName} onChange={e=>setLastName(e.target.value)} placeholder="Smith" style={{...inputStyle,marginBottom:16}}/>
            <button onClick={handleSaveName} style={{ width:"100%",height:48,borderRadius:0,border:"none",background:C.sage,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:10 }}>Save Changes</button>
            <button onClick={()=>{setPanel(null);setErr("");setMsg("");}} style={{ width:"100%",height:48,borderRadius:0,border:`1.5px solid ${C.border}`,background:"transparent",color:C.sub,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
          </Section>
        )}

        {panel==="dob"&&(
          <Section title="Date of Birth" sub="Enter your date of birth in DD/MM/YYYY format.">
            {err&&<div style={{ background:"#FEF0EF",border:"1px solid #F4C5C0",borderRadius:0,padding:"8px 12px",fontSize:13,color:C.red,marginBottom:12 }}>{err}</div>}
            {msg&&<div style={{ background:C.sage+"18",border:`1px solid ${C.sage}40`,borderRadius:0,padding:"8px 12px",fontSize:13,color:C.sage,marginBottom:12 }}>{msg}</div>}
            <label style={labelStyle}>Date of Birth</label>
            <input value={dob} onChange={e=>handleDobChange(e.target.value)} placeholder="DD/MM/YYYY" maxLength={10} inputMode="numeric" style={{...inputStyle,marginBottom:16}}/>
            <button onClick={handleSaveDob} style={{ width:"100%",height:48,borderRadius:0,border:"none",background:C.sage,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:10 }}>Save</button>
            <button onClick={()=>{setPanel(null);setErr("");setMsg("");}} style={{ width:"100%",height:48,borderRadius:0,border:`1.5px solid ${C.border}`,background:"transparent",color:C.sub,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
          </Section>
        )}

        {panel==="delete"&&(
          <div style={{ background:"#FEF0EF",borderRadius:0,padding:20,border:`1px solid ${C.red}30` }}>
            <h3 style={{ fontSize:15,fontWeight:700,color:C.red,margin:"0 0 8px" }}>Delete Account</h3>
            <p style={{ fontSize:13,color:C.sub,margin:"0 0 20px",lineHeight:1.5 }}>This will permanently delete your account and all your outfit data. This cannot be undone.</p>
            <button onClick={handleDeleteAccount} style={{ width:"100%",height:48,borderRadius:0,border:"none",background:C.red,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:10 }}>Delete Account</button>
            <button onClick={()=>setPanel(null)} style={{ width:"100%",height:48,borderRadius:0,border:`1.5px solid ${C.border}`,background:"transparent",color:C.sub,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationsScreen({ onBack }) {
  const [pushOn,setPushOn]=useState(true);
  const [reminderOn,setReminderOn]=useState(true);

  const Toggle=({on,onToggle})=>(
    <div onClick={onToggle} style={{ width:44,height:26,borderRadius:0,background:on?C.sage:C.border,position:"relative",cursor:"pointer",flexShrink:0,transition:"background .2s" }}>
      <div style={{ position:"absolute",top:3,left:on?21:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left .2s" }}/>
    </div>
  );

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
      <div style={{ background:C.white,padding:"16px 20px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0 }}>
        <button onClick={onBack} style={{ width:36,height:36,borderRadius:0,border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={20} color={C.sage}/></button>
        <h1 style={{ fontSize:22,fontWeight:800,color:C.ink,margin:0 }}>Notifications</h1>
      </div>
      <div style={{ flex:1,overflowY:"auto",padding:16,paddingBottom:32 }}>
        <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"0 0 10px" }}>Push Notifications</p>
        <div style={{ background:C.white,borderRadius:0,border:`1px solid ${C.border}`,overflow:"hidden" }}>
          <div style={{ padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${C.border}` }}>
            <div><div style={{ fontSize:15,fontWeight:600,color:C.ink }}>Push Notifications</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>Receive alerts and updates</div></div>
            <Toggle on={pushOn} onToggle={()=>setPushOn(v=>!v)}/>
          </div>
          <div style={{ padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
            <div><div style={{ fontSize:15,fontWeight:600,color:C.ink }}>Daily Reminder</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>Reminder to capture your outfit</div></div>
            <Toggle on={reminderOn} onToggle={()=>setReminderOn(v=>!v)}/>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrivacyScreen({ onBack, cameraEnabled, onCameraToggle }) {
  const [locationOn,setLocationOn]=useState(false);
  const [locationSaving,setLocationSaving]=useState(false);
  const [cameraError,setCameraError]=useState("");
  const [locationError,setLocationError]=useState("");

  // Load persisted location preference on mount
  useEffect(()=>{
    supabase.auth.getUser().then(({data:{user}})=>{
      if(user?.user_metadata?.location) setLocationOn(true);
    });
  },[]);

  const Toggle=({on,onToggle,disabled})=>(
    <div onClick={disabled?undefined:onToggle} style={{ width:44,height:26,borderRadius:0,background:on?C.sage:C.border,position:"relative",cursor:disabled?"not-allowed":"pointer",flexShrink:0,transition:"background .2s",opacity:disabled?0.6:1 }}>
      <div style={{ position:"absolute",top:3,left:on?21:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left .2s" }}/>
    </div>
  );

  const handleCameraToggle=async()=>{
    setCameraError("");
    if(cameraEnabled){ onCameraToggle(false); return; }
    try{
      const stream=await navigator.mediaDevices.getUserMedia({ video:true });
      stream.getTracks().forEach(t=>t.stop());
      onCameraToggle(true);
    }catch(e){
      setCameraError("Camera access was denied. Please allow camera access in your browser settings, then try again.");
      onCameraToggle(false);
    }
  };

  const handleLocationToggle=async()=>{
    setLocationError("");
    if(locationOn){
      await supabase.auth.updateUser({ data:{ location:null } });
      setLocationOn(false);
      return;
    }
    if(!navigator.geolocation){ setLocationError("Geolocation is not supported by your browser."); return; }
    setLocationSaving(true);
    navigator.geolocation.getCurrentPosition(
      async(pos)=>{
        const { latitude:lat, longitude:lng }=pos.coords;
        const { error }=await supabase.auth.updateUser({ data:{ location:{ lat, lng } } });
        setLocationSaving(false);
        if(error){ setLocationError("Could not save location. Please try again."); return; }
        setLocationOn(true);
      },
      ()=>{
        setLocationSaving(false);
        setLocationError("Location access was denied. Please allow location access in your browser settings, then try again.");
      },
      { enableHighAccuracy:false, timeout:10000 }
    );
  };

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
      <div style={{ background:C.white,padding:"16px 20px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0 }}>
        <button onClick={onBack} style={{ width:36,height:36,borderRadius:0,border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={20} color={C.sage}/></button>
        <h1 style={{ fontSize:22,fontWeight:800,color:C.ink,margin:0 }}>Privacy</h1>
      </div>
      <div style={{ flex:1,overflowY:"auto",padding:16,paddingBottom:32 }}>
        <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"0 0 10px" }}>Privacy and Permissions</p>
        <div style={{ background:C.white,borderRadius:0,border:`1px solid ${C.border}`,overflow:"hidden" }}>
          <div style={{ padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${C.border}` }}>
            <div style={{ flex:1,marginRight:12 }}>
              <div style={{ fontSize:15,fontWeight:600,color:C.ink }}>Camera Access</div>
              <div style={{ fontSize:12,color:C.sub,marginTop:2 }}>Allow app to use your camera for outfit photos</div>
              {cameraError&&<div style={{ fontSize:11,color:C.red,marginTop:6,lineHeight:1.5 }}>{cameraError}</div>}
            </div>
            <Toggle on={cameraEnabled} onToggle={handleCameraToggle}/>
          </div>
          <div style={{ padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
            <div style={{ flex:1,marginRight:12 }}>
              <div style={{ fontSize:15,fontWeight:600,color:C.ink }}>Location</div>
              <div style={{ fontSize:12,color:C.sub,marginTop:2 }}>{locationSaving?"Retrieving your location…":"Allow app to access your location"}</div>
              {locationError&&<div style={{ fontSize:11,color:C.red,marginTop:6,lineHeight:1.5 }}>{locationError}</div>}
            </div>
            <Toggle on={locationOn} onToggle={handleLocationToggle} disabled={locationSaving}/>
          </div>
        </div>
      </div>
    </div>
  );
}


function AddItemScreen({ onBack, photoData={}, setPhotoData, cameraEnabled=false }) {
  const [step,setStep]=useState("pick"); // pick | analysing | edit | done
  const [photo,setPhoto]=useState(null);
  const [photoUrl,setPhotoUrl]=useState(null); // Supabase Storage URL once uploaded
  const [editEntry,setEditEntry]=useState({style:null,formalityLevel:null,season:null,items:[]});
  const [toast,setToast]=useState(null);
  const addItemCameraRef=useRef(null);
  const [showCamera,setShowCamera]=useState(false);
  const today=new Date();
  const todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const STYLES=["Everyday","Going Out","Activewear","Professional"];
  const FORMALITY=["Casual","Smart Casual","Formal","Sporty"];
  const SEASONS=["Spring","Summer","Autumn","Winter","All Season"];
  const CATS=["Top","Bottom","Outerwear","Shoes","Accessories","Dresses","Swimwear"];
  const COLORS=["Black","White","Cream","Beige","Navy","Blue","Gray","Brown","Green","Red","Yellow","Pink","Purple"];
  const catEmojis={Top:"👕",Bottom:"👖",Outerwear:"🧥",Shoes:"👟",Accessories:"💍",Dresses:"👗",Swimwear:"👙",Other:"👔"};

  // Build known items from all previously logged outfits
  const knownItems={};
  Object.values(photoData).forEach(e=>{ if(!e?.logged) return; (e.items||[]).forEach(item=>{ if(!item||typeof item!=="object") return; const name=(item.name||"").trim().toLowerCase(); if(!name) return; if(!knownItems[name]) knownItems[name]={category:item.category||"Top",color:item.color||"Black",price:null,count:0}; knownItems[name].count+=1; if(item.category&&item.category!=="Other") knownItems[name].category=item.category; if(item.color) knownItems[name].color=item.color; const p=parseFloat(item.price); if(!isNaN(p)&&p>0) knownItems[name].price=String(p); }); });

  const handleFile=(file)=>{
    if(!file) return;
    const r=new FileReader();
    r.onload=async(ev)=>{
      const compressed=await compressImage(ev.target.result);
      let finalCompressed=compressed;
      try{ finalCompressed=await removeBackground(compressed.split(",")[1])||compressed; }
      catch(e){ setToast("BG removal: "+(e.message||String(e))); setTimeout(()=>setToast(null),15000); }
      const base64=finalCompressed.split(",")[1];
      setPhoto(finalCompressed);
      setStep("analysing");
      const knownItemsList=Object.entries(knownItems).map(([name,v])=>({name,category:v.category,color:v.color,price:v.price?parseFloat(v.price):null}));
      const blob=await fetch(finalCompressed).then(r=>r.blob());
      let _aiErr=null;
      const [url,parsed]=await Promise.all([
        uploadPhoto(blob,todayKey),
        analyseOutfit(base64,"image/jpeg",knownItemsList).catch(e=>{ _aiErr=e; return null; }),
      ]);
      if(_aiErr){ setToast("AI error: "+(_aiErr.message||String(_aiErr))); setTimeout(()=>setToast(null),30000); }
      if(url) setPhotoUrl(url+"?t="+Date.now());
      if(parsed){
        const rawItems=parsed.clothing_items||[];
        const items=rawItems.map(item=>{ const key=(item.name||"").trim().toLowerCase(); const known=knownItems[key]; const normColor=normalizeAiColor(item.color); const normBrand=toCanonicalBrand(item.brand||null); const base={...item,color:normColor,brand:normBrand}; if(known){return {...base,price:known.price??item.price,_recognized:true,_wearCount:known.count};} return base; });
        const style=parsed.style_category||null;
        const formalityLevel=parsed.formality_level||null;
        const season=parsed.season||null;
        // Crop each item from the original image, then remove its background individually for a clean product-style photo
        const itemsWithPhotos=await Promise.all(items.map(async(item,idx)=>{
          const {bbox,...itemData}=item;
          if(!bbox) return itemData;
          const crop=await cropItemPhoto(compressed,bbox);
          if(!crop) return itemData;
          let cleanCrop=crop;
          try{ cleanCrop=await removeBackground(crop.split(",")[1])||crop; }catch(e){}
          const itemPhotoUrl=await uploadItemPhoto(cleanCrop,todayKey,idx);
          return itemPhotoUrl?{...itemData,itemPhoto:itemPhotoUrl}:itemData;
        }));
        setEditEntry({style,formalityLevel,season,items:itemsWithPhotos});
      }else{ setEditEntry({style:null,formalityLevel:null,season:null,items:[]}); }
      setStep("edit");
    };
    r.readAsDataURL(file);
  };

  const updateItem=(i,key,val)=>setEditEntry(e=>{ const items=[...e.items]; items[i]={...items[i],[key]:val}; return {...e,items}; });
  const removeItem=(i)=>setEditEntry(e=>({...e,items:e.items.filter((_,idx)=>idx!==i)}));
  const addItem=()=>setEditEntry(e=>({...e,items:[...e.items,{category:"Top",name:"",color:"Black",_isNew:true}]}));
  const applyKnown=(i,nameVal)=>{ const key=nameVal.trim().toLowerCase(); if(!key||!knownItems[key]) return; setEditEntry(prev=>{ const items=[...prev.items]; const cur=items[i]; if(!cur._isNew) return prev; const known=knownItems[key]; items[i]={...cur,category:known.category,color:known.color,price:known.price!=null?known.price:cur.price,_isNew:false,_recognized:true,_wearCount:known.count}; return {...prev,items}; }); };
  const handleSave=()=>{ const cleanItems=editEntry.items.map(({_isNew,_recognized,_wearCount,_showColorPicker,...rest})=>rest); setPhotoData(p=>({...p,[todayKey]:{logged:true,photo:photoUrl||photo,items:cleanItems,style:editEntry.style,formalityLevel:editEntry.formalityLevel,season:editEntry.season}})); setStep("done"); };

  const D = "1px solid rgba(58,68,56,0.3)";

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"#fff" }}>
      {toast&&<div style={{ position:"fixed",top:16,left:12,right:12,zIndex:99999,background:C.red,color:"#fff",borderRadius:0,padding:"10px 14px",fontSize:13,fontWeight:600,boxShadow:"0 4px 16px rgba(0,0,0,.12)" }}>{toast}</div>}

      {/* Header */}
      <div style={{ background:"#fff",padding:"28px 24px 20px",borderBottom:D,flexShrink:0 }}>
        <button onClick={step==="done"?onBack:step==="edit"?()=>setStep("pick"):onBack} style={{ display:"flex",alignItems:"center",gap:4,border:"none",background:"transparent",color:C.sub,fontSize:13,cursor:"pointer",padding:"0 0 10px",fontFamily:"inherit" }}><ChevronLeft size={15} color={C.sub} strokeWidth={2}/>Back</button>
        <h1 style={{ fontSize:28,fontWeight:700,color:C.ink,margin:0,letterSpacing:"-0.03em",lineHeight:1 }}>Log Today's Outfit</h1>
        <p style={{ fontSize:13,color:C.sub,margin:"5px 0 0",fontWeight:400 }}>{step==="pick"?"Upload a photo to get started":step==="analysing"?"Analysing with AI…":step==="edit"?"Review and edit detected items":"Outfit logged!"}</p>
      </div>

      <div style={{ flex:1,overflowY:"auto",padding:"24px 24px 40px" }}>

        {step==="pick"&&(
          <>
            {/* Camera icon hero */}
            <div style={{ display:"flex",flexDirection:"column",alignItems:"center",padding:"32px 0 28px" }}>
              <Camera size={56} color={C.sage} strokeWidth={1}/>
              <p style={{ fontSize:13,color:C.sub,margin:"16px 0 0",textAlign:"center",lineHeight:1.6,maxWidth:260 }}>AI detects items, colours and style — and recognises pieces you've worn before</p>
            </div>
            <div style={{ borderTop:D,paddingTop:24,display:"flex",flexDirection:"column",gap:12 }}>
              {showCamera&&<CameraCapture onCapture={async(dataUrl)=>{ setShowCamera(false); const blob=await fetch(dataUrl).then(r=>r.blob()); handleFile(new File([blob],"camera.jpg",{type:"image/jpeg"})); }} onClose={()=>setShowCamera(false)}/>}
              {cameraEnabled
                ? <button onClick={()=>setShowCamera(true)} style={{ width:"100%",height:52,borderRadius:0,border:"none",background:C.ink,display:"flex",alignItems:"center",justifyContent:"center",gap:10,cursor:"pointer",fontFamily:"inherit" }}><Camera size={18} color="#fff"/><span style={{ fontSize:14,fontWeight:600,color:"#fff" }}>Open Camera</span></button>
                : <div style={{ width:"100%",height:52,borderRadius:0,border:D,display:"flex",alignItems:"center",justifyContent:"center",gap:10,opacity:.4 }}><Camera size={18} color={C.ink}/><span style={{ fontSize:14,fontWeight:600,color:C.ink }}>Camera (enable in Privacy)</span></div>
              }
              <label style={{ display:"block",cursor:"pointer" }}>
                <input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>handleFile(e.target.files[0])}/>
                <div style={{ width:"100%",height:52,borderRadius:0,border:D,display:"flex",alignItems:"center",justifyContent:"center",gap:10 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  <span style={{ fontSize:14,fontWeight:600,color:C.ink }}>Choose from Library</span>
                </div>
              </label>
            </div>
          </>
        )}

        {step==="analysing"&&(
          <>
            {photo&&<div style={{ width:"100%",overflow:"hidden",marginBottom:20,aspectRatio:"9/16",borderRadius:0 }}><img src={photo} alt="Outfit" style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }}/></div>}
            <div style={{ borderTop:D,paddingTop:20,display:"flex",alignItems:"center",gap:14 }}>
              <div style={{ width:22,height:22,borderRadius:"50%",border:`2.5px solid ${C.sage}`,borderTopColor:"transparent",animation:"spin .7s linear infinite",flexShrink:0 }}/><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              <div>
                <div style={{ fontSize:14,fontWeight:600,color:C.ink }}>Analysing with AI…</div>
                <div style={{ fontSize:12,color:C.sub,marginTop:2 }}>Detecting items and matching your wardrobe</div>
              </div>
            </div>
          </>
        )}

        {step==="edit"&&(
          <>
            {photo&&<div style={{ width:"100%",overflow:"hidden",marginBottom:24,aspectRatio:"9/16" }}><img src={photo} alt="Outfit" style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }}/></div>}

            <p style={{ fontSize:11,fontWeight:600,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"0 0 10px" }}>Style</p>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:24 }}>
              {STYLES.map(s=><button key={s} onClick={()=>setEditEntry(e=>({...e,style:s}))} style={{ padding:"7px 16px",borderRadius:0,border:editEntry.style===s?`1px solid ${C.ink}`:`1px solid ${C.border}`,background:editEntry.style===s?C.ink:"transparent",color:editEntry.style===s?"#fff":C.ink,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit" }}>{s}</button>)}
            </div>

            <p style={{ fontSize:11,fontWeight:600,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"0 0 10px" }}>Formality</p>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:24 }}>
              {FORMALITY.map(f=><button key={f} onClick={()=>setEditEntry(e=>({...e,formalityLevel:f}))} style={{ padding:"7px 16px",borderRadius:0,border:editEntry.formalityLevel===f?`1px solid ${C.ink}`:`1px solid ${C.border}`,background:editEntry.formalityLevel===f?C.ink:"transparent",color:editEntry.formalityLevel===f?"#fff":C.ink,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit" }}>{f}</button>)}
            </div>

            <p style={{ fontSize:11,fontWeight:600,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"0 0 10px" }}>Season</p>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:24 }}>
              {SEASONS.map(s=><button key={s} onClick={()=>setEditEntry(e=>({...e,season:s}))} style={{ padding:"7px 16px",borderRadius:0,border:editEntry.season===s?`1px solid ${C.ink}`:`1px solid ${C.border}`,background:editEntry.season===s?C.ink:"transparent",color:editEntry.season===s?"#fff":C.ink,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit" }}>{s}</button>)}
            </div>

            <div style={{ borderTop:D,paddingTop:20,marginBottom:12 }}>
              <p style={{ fontSize:11,fontWeight:600,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"0 0 16px" }}>Items</p>
              {editEntry.items.map((item,i)=>(
                <div key={i} style={{ borderBottom:D,paddingBottom:16,marginBottom:16 }}>
                  <div style={{ display:"flex",alignItems:"center",marginBottom:10,gap:8 }}>
                    <input value={item.name} onChange={e=>updateItem(i,"name",e.target.value)} onBlur={e=>applyKnown(i,e.target.value)} placeholder="Item name" style={{ flex:1,height:38,padding:"0 12px",borderRadius:0,border:`1px solid ${item._recognized?C.sage:C.border}`,background:"#fff",fontSize:13,color:C.ink,outline:"none",fontFamily:"inherit" }}/>
                    <button onClick={()=>removeItem(i)} style={{ width:34,height:34,borderRadius:0,border:`1px solid ${C.border}`,background:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0 }}><Trash2 size={14} color={C.red}/></button>
                  </div>
                  {item._recognized&&<p style={{ fontSize:11,fontWeight:600,color:C.sage,margin:"0 0 8px" }}>✓ Recognised — details filled from previous log</p>}
                  <div style={{ display:"flex",gap:4,flexWrap:"wrap",marginBottom:10 }}>
                    {CATS.map(c=><button key={c} onClick={()=>updateItem(i,"category",c)} style={{ height:26,padding:"0 10px",borderRadius:0,border:`1px solid ${item.category===c?C.sage:C.border}`,background:item.category===c?C.sage:"transparent",color:item.category===c?"#fff":C.sub,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:4 }}><CatIcon cat={c} size={11} color={item.category===c?"#fff":C.sub}/>{c}</button>)}
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap" }}>
                    {toColors(item.color).filter(c=>colorHex[c]).map(c=>(
                      <div key={c} style={{ display:"flex",alignItems:"center",gap:6,padding:"4px 10px",border:`1px solid ${C.border}` }}>
                        <div style={{ width:11,height:11,background:colorHex[c],border:(c==="White"||c==="Cream")?`1px solid ${C.border}`:"none",flexShrink:0 }}/>
                        <span style={{ fontSize:12,fontWeight:500,color:C.ink }}>{c}</span>
                      </div>
                    ))}
                    <button onClick={()=>updateItem(i,"_showColorPicker",!item._showColorPicker)} style={{ fontSize:12,fontWeight:500,color:C.sage,background:"none",border:`1px solid ${C.sage}`,padding:"4px 12px",cursor:"pointer",fontFamily:"inherit",borderRadius:0 }}>{item._showColorPicker?"Close":"Edit colour"}</button>
                  </div>
                  {item._showColorPicker&&(
                    <div style={{ display:"flex",gap:5,flexWrap:"wrap",marginBottom:10 }}>
                      {COLORS.map(col=>{ const sel=toColors(item.color).includes(col); return (
                        <button key={col} onClick={()=>{ const cur=toColors(item.color); const nxt=sel?cur.filter(c=>c!==col):[...cur,col]; updateItem(i,"color",nxt.length===0?null:nxt.length===1?nxt[0]:nxt); }} title={col} style={{ width:52,border:sel?`2px solid ${C.sage}`:`1px solid ${C.border}`,cursor:"pointer",padding:0,background:"transparent",flexShrink:0,overflow:"hidden" }}>
                          <div style={{ width:"100%",height:32,background:colorHex[col] }}/>
                          <div style={{ padding:"3px 4px",background:"#fff" }}>
                            <div style={{ fontSize:9,fontWeight:600,color:C.ink,lineHeight:1.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{col}</div>
                          </div>
                        </button>
                      ); })}
                    </div>
                  )}
                  <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                    <span style={{ fontSize:12,fontWeight:500,color:C.sub }}>Price</span>
                    <div style={{ display:"flex",alignItems:"center",flex:1,height:36,border:`1px solid ${C.border}`,overflow:"hidden" }}>
                      <span style={{ padding:"0 10px",fontSize:13,color:C.sub,borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center" }}>£</span>
                      <input type="number" min="0" step="0.01" value={item.price||""} onChange={e=>updateItem(i,"price",e.target.value)} placeholder="0.00" style={{ flex:1,height:"100%",padding:"0 10px",border:"none",background:"transparent",fontSize:13,color:C.ink,outline:"none",fontFamily:"inherit" }}/>
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={addItem} style={{ width:"100%",height:44,borderRadius:0,border:D,background:"transparent",color:C.sub,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:20 }}><Plus size={15} color={C.sub}/>Add Item</button>
            </div>

            <button onClick={handleSave} style={{ width:"100%",height:52,borderRadius:0,border:"none",background:C.ink,color:"#fff",fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}><Check size={18}/>Save to Today</button>
          </>
        )}

        {step==="done"&&(
          <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",paddingTop:60,gap:14 }}>
            <div style={{ width:64,height:64,borderRadius:"50%",border:`1px solid ${C.sage}`,display:"flex",alignItems:"center",justifyContent:"center" }}><Check size={28} color={C.sage} strokeWidth={1.5}/></div>
            <h2 style={{ fontSize:24,fontWeight:700,color:C.ink,margin:0,letterSpacing:"-0.02em" }}>Outfit Logged!</h2>
            <p style={{ fontSize:13,color:C.sub,margin:0,textAlign:"center",lineHeight:1.6 }}>Saved to today on the calendar.<br/>All wardrobe analytics updated.</p>
            <div style={{ display:"flex",flexDirection:"column",gap:10,width:"100%",marginTop:16 }}>
              <button onClick={()=>{ setStep("pick"); setPhoto(null); setEditEntry({style:null,formalityLevel:null,season:null,items:[]}); }} style={{ width:"100%",height:50,borderRadius:0,border:"none",background:C.ink,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Log Another</button>
              <button onClick={onBack} style={{ width:"100%",height:50,borderRadius:0,border:D,background:"transparent",color:C.ink,fontSize:14,fontWeight:500,cursor:"pointer",fontFamily:"inherit" }}>Back to Home</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default function App() {
  const [isSignedIn,setIsSignedIn]=useState(false);
  const [authLoading,setAuthLoading]=useState(true);
  const [currentUser,setCurrentUser]=useState(null);
  const [currentEmail,setCurrentEmail]=useState("");
  const [currentUsername,setCurrentUsername]=useState("");
  const [tab,setTab]=useState("home");
  const [subScreen,setSubScreen]=useState(null);
  const [wardrobeInitialView,setWardrobeInitialView]=useState("main");
  const [calendarOpenDate,setCalendarOpenDate]=useState(null);
  const [cameraEnabled,setCameraEnabled]=useState(false);
  const [photoData,setPhotoData]=useState({});
  const [favourites,setFavourites]=useState([]);
  const [tabHistory,setTabHistory]=useState([]);
  const [needsPasswordReset,setNeedsPasswordReset]=useState(false);
  const [authGoToSignIn,setAuthGoToSignIn]=useState(false);
  const [resetPwNew,setResetPwNew]=useState("");
  const [resetPwConfirm,setResetPwConfirm]=useState("");
  const [resetPwError,setResetPwError]=useState("");
  const [resetPwLoading,setResetPwLoading]=useState(false);
  const dataSyncReady=useRef(false);

  // Restore session on mount — skip if this is a password recovery redirect
  useEffect(()=>{
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    const isRecovery = hash.includes("type=recovery") || params.get("type")==="recovery" || params.has("code");
    if(isRecovery) return; // onAuthStateChange will fire PASSWORD_RECOVERY once token is ready
    supabase.auth.getSession().then(async({data:{session}})=>{
      if(session){
        console.log("[session restore] user id:", session.user.id);
        const {data:profile,error:profileErr}=await supabase.from("profiles").select("photo_data,favourites,Username").eq("id",session.user.id).single();
        if(profileErr) console.error("[session restore] profile load error:", profileErr);
        console.log("[session restore] profile loaded:", profile ? `photo_data keys: ${Object.keys(profile.photo_data||{}).length}` : "null");
        setCurrentUser(session.user.id);
        setCurrentEmail(session.user.email||"");
        setCurrentUsername(profile?.Username||session.user.user_metadata?.username||"");
        setPhotoData(profile?.photo_data||{});
        setFavourites(profile?.favourites||[]);
        setIsSignedIn(true);
        dataSyncReady.current=true;
      }
      setAuthLoading(false);
    });
  },[]);

  // Detect PASSWORD_RECOVERY event (user clicked reset link in email)
  useEffect(()=>{
    const { data:{ subscription } } = supabase.auth.onAuthStateChange((event)=>{
      if(event==="PASSWORD_RECOVERY"){ setNeedsPasswordReset(true); setAuthLoading(false); }
    });
    return ()=>subscription.unsubscribe();
  },[]);

  // session_ended — fires when user closes/refreshes the tab
  useEffect(()=>{
    const _sessionStart = Date.now();
    const handleUnload = () => {
      const duration = Math.round((Date.now() - _sessionStart) / 1000);
      // Use sendBeacon so the request survives tab close
      const payload = JSON.stringify({
        user_id: currentUser,
        session_id: _sessionId,
        event_name: "session_ended",
        properties: { session_duration_seconds: duration },
        platform: "web",
      });
      navigator.sendBeacon(
        `${_sbUrl}/rest/v1/user_events?apikey=${_sbKey}`,
        new Blob([payload], { type: "application/json" })
      );
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [currentUser]);

  // Auto-save photoData → Supabase
  // Skip any entry that is still analysing (photo may still be base64 at that point)
  useEffect(()=>{
    if(!currentUser||!dataSyncReady.current) return;
    const isAnyAnalysing=Object.values(photoData).some(v=>v?.analysing);
    if(isAnyAnalysing) return;
    supabase.from("profiles").upsert({id:currentUser,photo_data:photoData})
      .then(({error})=>{ if(error) console.error("[save photoData]",error); });
  },[photoData,currentUser]);

  // Auto-save favourites → Supabase
  useEffect(()=>{
    if(!currentUser||!dataSyncReady.current) return;
    supabase.from("profiles").upsert({id:currentUser,favourites})
      .then(({error})=>{ if(error) console.error("[save favourites]",error); });
  },[favourites,currentUser]);

  const toggleFavourite=(item)=>{
    const key=(item.name||"").trim().toLowerCase();
    setFavourites(prev=>{
      const exists=prev.some(f=>(f.name||"").trim().toLowerCase()===key);
      track("favourite_toggled", { item_name: item.name, action: exists ? "removed" : "added" });
      if(exists) return prev.filter(f=>(f.name||"").trim().toLowerCase()!==key);
      return [...prev,{name:item.name,category:item.category||"Other",color:item.color||null,price:item.price||null}];
    });
  };

  const navigateTo=(newTab)=>{
    setTabHistory(h=>[...h,tab]);
    setTab(newTab);
    setSubScreen(null);
    track("screen_viewed", { screen: newTab });
  };
  const goBack=()=>{
    if(subScreen){ setSubScreen(null); return; }
    if(tabHistory.length>0){
      const prev=tabHistory[tabHistory.length-1];
      setTabHistory(h=>h.slice(0,-1));
      if(tab==="wardrobe") setWardrobeInitialView("main");
      setTab(prev);
    }
  };
  const canGoBack = subScreen!==null || tabHistory.length>0;

  const renderContent=()=>{
    if(subScreen==="addItem") return <AddItemScreen onBack={goBack} photoData={photoData} setPhotoData={setPhotoData} cameraEnabled={cameraEnabled}/>;
    if(subScreen==="settings") return <SettingsScreen onBack={goBack} username={currentUsername}/>;
    if(subScreen==="notifications") return <NotificationsScreen onBack={goBack}/>;
    if(subScreen==="privacy") return <PrivacyScreen onBack={goBack} cameraEnabled={cameraEnabled} onCameraToggle={setCameraEnabled}/>;
    switch(tab){
      case "home":      return <HomeScreen photoData={photoData} favourites={favourites} userEmail={currentEmail} username={currentUsername} onShowAllItems={()=>{ setWardrobeInitialView("items"); navigateTo("wardrobe"); }} onGoToFavorites={()=>navigateTo("favorites")} onAddItem={()=>setSubScreen("addItem")}/>;
      case "wardrobe":  return <WardrobeScreen photoData={photoData} currentUser={currentUser} onBack={canGoBack?goBack:null} initialView={wardrobeInitialView} onAddItem={()=>setSubScreen("addItem")}/>;
      case "calendar":  return <CalendarScreen photoData={photoData} setPhotoData={setPhotoData} favourites={favourites} onToggleFavourite={toggleFavourite} onBack={canGoBack?goBack:null} initialDate={calendarOpenDate} onClearInitialDate={()=>setCalendarOpenDate(null)} cameraEnabled={cameraEnabled}/>;
      case "favorites": return <FavoritesScreen favourites={favourites} setFavourites={setFavourites} photoData={photoData} onGoToDate={dateKey=>{ setCalendarOpenDate(dateKey); navigateTo("calendar"); }} onBack={canGoBack?goBack:null}/>;
      case "profile":   return <ProfileScreen onSettings={()=>setSubScreen("settings")} onNotifications={()=>setSubScreen("notifications")} onPrivacy={()=>setSubScreen("privacy")} userEmail={currentEmail} username={currentUsername} onBack={canGoBack?goBack:null} onSignOut={async()=>{ await supabase.auth.signOut(); dataSyncReady.current=false; setIsSignedIn(false); setCurrentUser(null); setCurrentEmail(""); setCurrentUsername(""); setPhotoData({}); setFavourites([]); setTab("home"); setSubScreen(null); setTabHistory([]); }}/>;
      default:          return <HomeScreen photoData={photoData} favourites={favourites} userEmail={currentEmail} username={currentUsername} onShowAllItems={()=>{ setWardrobeInitialView("items"); navigateTo("wardrobe"); }} onGoToFavorites={()=>navigateTo("favorites")} onAddItem={()=>setSubScreen("addItem")}/>;
    }
  };

  return (
    <>
      <style>{`*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html,body{margin:0;height:100%;overflow:hidden;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:${C.surface}}@keyframes slideUp{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes spin{to{transform:rotate(360deg)}}::-webkit-scrollbar{display:none}`}</style>
      <div style={{ position:"fixed",inset:0,display:"flex",flexDirection:"column",background:C.surface,paddingTop:"env(safe-area-inset-top,0px)",paddingBottom:"env(safe-area-inset-bottom,0px)" }}>
        {needsPasswordReset
          ? (() => {
              const doReset = async () => {
                setResetPwError("");
                if(!resetPwNew||resetPwNew.length<8){ setResetPwError("Password must be at least 8 characters."); return; }
                if(resetPwNew!==resetPwConfirm){ setResetPwError("Passwords do not match."); return; }
                setResetPwLoading(true);
                const { data: { session: currentSession } } = await supabase.auth.getSession();
                if(!currentSession){ setResetPwLoading(false); setResetPwError("Reset link has expired. Please request a new one."); return; }
                const { error } = await supabase.auth.updateUser({ password: resetPwNew });
                setResetPwLoading(false);
                if(error){ setResetPwError(error.message); return; }
                await supabase.auth.signOut();
                window.location.hash = "";
                setResetPwNew(""); setResetPwConfirm(""); setResetPwError(""); setAuthGoToSignIn(true); setNeedsPasswordReset(false);
              };
              const inputStyle = { width:"100%",height:52,padding:"0 16px",border:`1.5px solid rgba(58,68,56,0.3)`,background:"#fff",fontSize:15,color:C.ink,outline:"none",boxSizing:"border-box",fontFamily:"inherit",borderRadius:0 };
              return (
                <div style={{ flex:1,display:"flex",flexDirection:"column",background:"#fff",padding:"48px 32px 32px",overflowY:"auto",justifyContent:"center" }}>
                  <h2 style={{ fontSize:26,fontWeight:900,color:C.ink,margin:"0 0 32px",textAlign:"left",letterSpacing:"-0.03em" }}>Change Password</h2>
                  {resetPwError&&<div style={{ background:"#FEF0EF",border:"1px solid #F4C5C0",padding:"10px 14px",fontSize:13,color:"#C0392B",marginBottom:16 }}>{resetPwError}</div>}
                  <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"0 0 8px" }}>New Password</p>
                  <input type="password" value={resetPwNew} onChange={e=>setResetPwNew(e.target.value)} placeholder="Min. 8 characters" style={inputStyle} onFocus={e=>e.target.style.borderColor=C.sage} onBlur={e=>e.target.style.borderColor="rgba(58,68,56,0.3)"}/>
                  <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",margin:"20px 0 8px" }}>Confirm New Password</p>
                  <input type="password" value={resetPwConfirm} onChange={e=>setResetPwConfirm(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doReset()} placeholder="Repeat password" style={inputStyle} onFocus={e=>e.target.style.borderColor=C.sage} onBlur={e=>e.target.style.borderColor="rgba(58,68,56,0.3)"}/>
                  <button disabled={resetPwLoading} onClick={doReset} style={{ width:"100%",height:54,border:"none",background:C.sage,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginTop:24,opacity:resetPwLoading?0.7:1 }}>{resetPwLoading?"Updating…":"Change Password"}</button>
                  <button onClick={async()=>{ await supabase.auth.signOut(); window.location.hash=""; setResetPwNew(""); setResetPwConfirm(""); setResetPwError(""); setAuthGoToSignIn(true); setNeedsPasswordReset(false); }} style={{ width:"100%",height:54,border:`1px solid rgba(58,68,56,0.3)`,background:"transparent",color:C.sub,fontSize:16,fontWeight:600,cursor:"pointer",fontFamily:"inherit",marginTop:12 }}>Cancel</button>
                </div>
              );
            })()

          : authLoading
          ? <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16 }}>
              <div style={{ width:64,height:64,borderRadius:16,background:"rgba(58,68,56,0.07)",display:"flex",alignItems:"center",justifyContent:"center" }}><Shirt size={32} color={C.ink} strokeWidth={1.5}/></div>
              <div style={{ width:32,height:32,borderRadius:"50%",border:`3px solid ${C.sage}`,borderTopColor:"transparent",animation:"spin .7s linear infinite" }}/>
            </div>
          : !isSignedIn
            ? <AuthScreen initialView={authGoToSignIn?"signin":"landing"} onAuth={(email,data,favs,userId,uname)=>{ setCurrentUser(userId); setCurrentEmail(email||""); setCurrentUsername(uname||""); setPhotoData(data||{}); setFavourites(favs||[]); setIsSignedIn(true); setAuthGoToSignIn(false); dataSyncReady.current=true; }}/>
            : <>
                <div style={{ flex:1,overflow:"hidden",display:"flex",flexDirection:"column" }}><ErrorBoundary>{renderContent()}</ErrorBoundary></div>
                {!subScreen&&<TabBar active={tab} onChange={t=>{ if(t!=="wardrobe") setWardrobeInitialView("main"); setTab(t); setSubScreen(null); }}/>}
              </>
        }
      </div>
    </>
  );
}
