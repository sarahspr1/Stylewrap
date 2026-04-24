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
      <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,background:C.surface }}>
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
  sage: "#5E6A5C", green: "#5E6A5C",
  surface: "#FFFFFF",   // warm sage surface — screen backgrounds
  white: "#EDECE5",     // card backgrounds
  offwhite: "#F7F6F0",  // subtle inner surfaces, inputs
  ink: "#1F2620",       // primary text
  sub: "#8F978D",       // muted / secondary text
  border: "#D8D7D0",    // hairline borders
  red: "#E5635A",
};
const F = {
  sans: '"Inter Tight","Helvetica Neue",Helvetica,Arial,sans-serif',
  mono: '"JetBrains Mono","SF Mono",ui-monospace,monospace',
  serif: '"Cormorant Garamond",Georgia,serif',
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
  const CAM_LABEL={ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub };

  useEffect(()=>{
    let s;
    setReady(false); setError("");
    navigator.mediaDevices.getUserMedia({ video:{ facingMode:facing },audio:false })
      .then(st=>{ s=st; setStream(st); if(videoRef.current){ videoRef.current.srcObject=st; } })
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
    <div style={{ position:"fixed",inset:0,background:C.surface,zIndex:10000,display:"flex",flexDirection:"column" }}>
      {/* Section header */}
      <div style={{ padding:"28px 24px 0",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0 }}>
        <span style={{ ...CAM_LABEL }}>§ 05 · Camera</span>
        <button onClick={onClose} style={{ ...CAM_LABEL,border:"none",background:"transparent",cursor:"pointer",padding:0 }}>Cancel</button>
      </div>
      {/* Title */}
      <div style={{ padding:"12px 24px 14px",flexShrink:0 }}>
        <h1 style={{ fontSize:34,fontWeight:800,color:C.ink,margin:0,letterSpacing:"-0.03em",lineHeight:1 }}>Camera</h1>
        <p style={{ fontSize:13,color:C.sub,fontStyle:"italic",fontFamily:F.serif,margin:"4px 0 0" }}>Scan a garment</p>
      </div>
      {/* Viewfinder */}
      <div style={{ flex:1,position:"relative",overflow:"hidden",background:"#2A3628",margin:"0 24px" }}>
        {error ? (
          <div style={{ height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32 }}>
            <Camera size={36} color="rgba(255,255,255,0.4)" strokeWidth={1}/>
            <p style={{ color:"rgba(255,255,255,0.6)",textAlign:"center",fontSize:13,lineHeight:1.6,marginTop:16,marginBottom:0 }}>{error}</p>
          </div>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted onCanPlay={()=>setReady(true)} style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }}/>
            {/* Figure placeholder while loading */}
            {!ready&&(
              <div style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center" }}>
                <svg viewBox="0 0 200 300" width="44%" height="74%" style={{ display:"block" }}>
                  <circle cx="100" cy="52" r="22" fill="rgba(255,255,255,0.18)"/>
                  <rect x="82" y="70" width="36" height="14" fill="rgba(255,255,255,0.18)"/>
                  <path d="M42 88 L82 84 L100 96 L118 84 L158 88 L164 192 L138 196 L130 168 L126 288 L74 288 L70 168 L62 196 L36 192 Z" fill="rgba(255,255,255,0.18)"/>
                </svg>
              </div>
            )}
            {/* Focus guide rectangle */}
            <div style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none" }}>
              <div style={{ width:"68%",height:"74%",border:"1px solid rgba(255,255,255,0.38)" }}/>
            </div>
          </>
        )}
      </div>
      {/* Controls */}
      <div style={{ background:C.surface,padding:"18px 32px 44px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0 }}>
        <button onClick={onClose} style={{ ...CAM_LABEL,border:"none",background:"transparent",cursor:"pointer",padding:"8px 0",minWidth:56 }}>Cancel</button>
        <button onClick={handleCapture} disabled={!ready} style={{ width:68,height:68,borderRadius:"50%",background:"transparent",border:`3px solid ${ready?C.ink:C.border}`,cursor:ready?"pointer":"default",padding:4,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
          <div style={{ width:"100%",height:"100%",borderRadius:"50%",background:ready?C.ink:C.border }}/>
        </button>
        <button onClick={()=>{ stream?.getTracks().forEach(t=>t.stop()); setStream(null); setFacing(f=>f==="environment"?"user":"environment"); }} style={{ ...CAM_LABEL,border:"none",background:"transparent",cursor:"pointer",padding:"8px 0",minWidth:56,textAlign:"right" }}>Flip</button>
      </div>
    </div>
  );
}

function OutfitReview({ entry, editEntry, selectedDate, onRetake, onSave, onEdit }) {
  const analysing=entry?.analysing;
  const items=editEntry?.items||[];
  const REV_LABEL={ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub };

  // Build per-item attribute groups
  const itemGroups=items.map(item=>{
    const rows=[];
    const catVal=[item.category,item.name?.toLowerCase()].filter(Boolean).join(' / ');
    if(catVal) rows.push({ label:"Category",value:catVal });
    if(item.color){ const cv=Array.isArray(item.color)?item.color.join(', '):item.color; if(cv) rows.push({ label:"Color",value:cv }); }
    if(item.brand) rows.push({ label:"Brand",value:item.brand });
    return rows;
  }).filter(g=>g.length>0);

  const outfitRows=[];
  if(editEntry?.style) outfitRows.push({ label:"Style",value:editEntry.style });
  if(editEntry?.formalityLevel) outfitRows.push({ label:"Formality",value:editEntry.formalityLevel });
  if(editEntry?.season) outfitRows.push({ label:"Season",value:editEntry.season });

  const totalAttrs=itemGroups.reduce((s,g)=>s+g.length,0)+outfitRows.length;
  const multiItem=itemGroups.length>1;

  const AttrRow=({label,value,last})=>(
    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 18px",borderBottom:last?"none":`1px solid ${C.border}` }}>
      <span style={{ fontSize:13,color:C.sub,fontWeight:400 }}>{label}</span>
      <span style={{ fontSize:13,color:C.ink,fontWeight:500,textAlign:"right",maxWidth:"55%" }}>{value}</span>
    </div>
  );

  return (
    <div style={{ position:"fixed",inset:0,background:C.surface,zIndex:10000,display:"flex",flexDirection:"column" }}>
      {/* Header */}
      <div style={{ padding:"28px 24px 0",flexShrink:0 }}>
        <span style={{ ...REV_LABEL }}>§ 05 · Camera</span>
      </div>
      <div style={{ padding:"12px 24px 14px",flexShrink:0 }}>
        <h1 style={{ fontSize:34,fontWeight:800,color:C.ink,margin:0,letterSpacing:"-0.03em",lineHeight:1 }}>Camera</h1>
        <p style={{ fontSize:13,color:C.sub,fontStyle:"italic",fontFamily:F.serif,margin:"4px 0 0" }}>Scan a garment</p>
      </div>
      {/* Photo viewfinder */}
      <div style={{ flexShrink:0,height:200,background:"#2A3628",margin:"0 24px",position:"relative",overflow:"hidden" }}>
        {entry?.photo&&<img src={entry.photo} alt="Outfit" style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }}/>}
        {analysing&&(
          <div style={{ position:"absolute",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10 }}>
            <div style={{ width:26,height:26,borderRadius:"50%",border:"2.5px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",animation:"spin .7s linear infinite" }}/>
            <span style={{ fontFamily:F.mono,fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(255,255,255,0.65)" }}>Analysing…</span>
          </div>
        )}
      </div>
      {/* Detected attributes */}
      <div style={{ flex:1,overflowY:"auto",padding:"16px 24px 0" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
          <span style={{ ...REV_LABEL }}>Detected Attributes</span>
          <span style={{ ...REV_LABEL }}>{analysing?"…":`${totalAttrs}/${totalAttrs}`}</span>
        </div>
        <div style={{ background:C.white,border:`1px solid ${C.border}` }}>
          {itemGroups.length>0 ? (
            <>
              {itemGroups.map((group,gIdx)=>{
                const isLastGroup=gIdx===itemGroups.length-1;
                return (
                  <div key={gIdx}>
                    {multiItem&&(
                      <div style={{ padding:"7px 18px",background:C.surface,borderBottom:`1px solid ${C.border}` }}>
                        <span style={{ fontFamily:F.mono,fontSize:9,fontWeight:500,letterSpacing:"0.12em",textTransform:"uppercase",color:C.sub }}>Item {gIdx+1}</span>
                      </div>
                    )}
                    {group.map((row,rIdx)=>(
                      <AttrRow key={rIdx} label={row.label} value={row.value} last={isLastGroup&&rIdx===group.length-1&&outfitRows.length===0}/>
                    ))}
                  </div>
                );
              })}
              {outfitRows.map((row,i)=>(
                <AttrRow key={i} label={row.label} value={row.value} last={i===outfitRows.length-1}/>
              ))}
            </>
          ) : (
            <div style={{ padding:"20px 18px",textAlign:"center" }}>
              <span style={{ fontSize:13,color:C.sub }}>{analysing?"Analysing outfit with AI…":"No items detected — tap Edit to add manually"}</span>
            </div>
          )}
        </div>
      </div>
      {/* Bottom bar */}
      <div style={{ padding:"12px 24px 44px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0 }}>
        <button onClick={onRetake} style={{ fontFamily:F.mono,fontSize:11,fontWeight:500,letterSpacing:"0.1em",textTransform:"uppercase",color:C.sub,border:"none",background:"transparent",cursor:"pointer",padding:"8px 0",minWidth:64 }}>Retake</button>
        <button onClick={onSave} disabled={!!analysing} style={{ height:52,padding:"0 36px",background:analysing?C.border:C.ink,color:analysing?C.sub:"#fff",border:"none",cursor:analysing?"not-allowed":"pointer",fontFamily:"inherit",fontSize:15,fontWeight:700 }}>Save</button>
        <button onClick={onEdit} disabled={!!analysing} style={{ fontFamily:F.mono,fontSize:11,fontWeight:500,letterSpacing:"0.1em",textTransform:"uppercase",color:analysing?C.border:C.ink,border:"none",background:"transparent",cursor:analysing?"not-allowed":"pointer",padding:"8px 0",minWidth:64,textAlign:"right" }}>Edit</button>
      </div>
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
      <div style={{ fontSize:26,fontWeight:500,color:C.ink,lineHeight:1,letterSpacing:"-0.02em",fontFamily:F.mono }}>{number}</div>
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
            ? <div style={{ display:"flex",alignItems:"center",gap:5,background:C.ink,borderRadius:99,padding:"5px 12px" }}><Icon size={16} color="#fff" strokeWidth={1.5}/><span style={{ fontSize:9,fontWeight:500,color:"#fff",letterSpacing:"0.12em",textTransform:"uppercase",whiteSpace:"nowrap",fontFamily:F.mono }}>{label}</span></div>
            : <><Icon size={20} color="rgba(58,68,56,0.4)" strokeWidth={1.5}/><span style={{ fontSize:9,fontWeight:500,color:"rgba(31,38,32,0.45)",letterSpacing:"0.12em",textTransform:"uppercase",fontFamily:F.mono }}>{label}</span></>
          }
        </button>;
      })}
    </div>
  );
}

function DailyLogPrompt({ photoData={}, onAddItem, onDismiss, streak=0 }) {
  const [visible, setVisible] = useState(false);
  useEffect(()=>{ const t=setTimeout(()=>setVisible(true),1500); return ()=>clearTimeout(t); },[]);
  const lastPhotoEntry = Object.entries(photoData).filter(([,v])=>v?.logged&&v?.photo).sort((a,b)=>b[0].localeCompare(a[0]))[0];
  const lastPhoto = lastPhotoEntry?.[1]?.photo;
  const dismiss = ()=>{ onDismiss(); setVisible(false); };
  if(!visible) return null;
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9998,display:"flex",alignItems:"flex-end",animation:"fadeIn .2s ease" }} onClick={dismiss}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",width:"100%",padding:"20px 24px 48px",animation:"slideUp .3s cubic-bezier(.32,.72,0,1)" }}>
        <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"0 auto 24px" }}/>
        <div style={{ display:"flex",alignItems:"center",gap:16,marginBottom:22 }}>
          {lastPhoto
            ? <img src={lastPhoto} style={{ width:56,height:56,borderRadius:"50%",objectFit:"cover",border:`2px solid ${C.border}`,flexShrink:0 }}/>
            : <div style={{ width:56,height:56,borderRadius:"50%",background:"rgba(58,68,56,0.07)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><Camera size={24} color={C.sage} strokeWidth={1.5}/></div>
          }
          <div>
            {streak>0&&<div style={{ fontSize:10,fontWeight:500,color:C.sage,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,marginBottom:3 }}>{streak} day streak</div>}
            <p style={{ fontSize:13,color:C.sub,margin:0,lineHeight:1.4 }}>{lastPhoto?"Your last look is saved. Add today's.":"Start building your wardrobe story."}</p>
          </div>
        </div>
        <h2 style={{ fontSize:24,fontWeight:900,color:C.ink,margin:"0 0 4px",letterSpacing:"-0.03em" }}>Log Today's Outfit</h2>
        <p style={{ fontSize:14,color:C.sub,margin:"0 0 22px" }}>Capture your look in seconds.</p>
        <button onClick={()=>{ dismiss(); onAddItem(); }} style={{ width:"100%",height:56,background:C.ink,border:"none",color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,fontFamily:"inherit",marginBottom:10,transition:"opacity .15s",borderRadius:0 }} onMouseDown={e=>e.currentTarget.style.opacity=".8"} onMouseUp={e=>e.currentTarget.style.opacity="1"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
          <Camera size={20} color="#fff" strokeWidth={1.5}/>Take Photo
        </button>
        <button onClick={dismiss} style={{ width:"100%",height:44,background:"transparent",border:"none",color:C.sub,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Skip for now</button>
      </div>
    </div>
  );
}

const GS=({cat})=>{const col="#3A4A38";const sh={Top:<path d="M20 20 L35 12 L45 18 L65 18 L75 12 L90 20 L95 45 L85 48 L85 95 L25 95 L25 48 L15 45 Z" fill={col}/>,Bottom:<path d="M30 15 L80 15 L82 50 L78 95 L60 95 L55 55 L50 95 L32 95 L28 50 Z" fill={col}/>,Dresses:<path d="M35 15 L45 10 L65 10 L75 15 L72 30 L85 95 L25 95 L38 30 Z" fill={col}/>,Outerwear:<path d="M18 22 L35 12 L45 16 L55 14 L65 16 L75 12 L92 22 L90 95 L68 95 L55 55 L42 95 L20 95 Z" fill={col}/>,Shoes:<path d="M12 60 L35 55 L55 52 L80 55 L92 62 L92 72 L15 72 Z" fill={col}/>,Accessories:<g><path d="M32 25 Q55 10 78 25" stroke={col} strokeWidth="3" fill="none"/><path d="M25 30 L85 30 L80 90 L30 90 Z" fill={col}/></g>};return(<svg viewBox="0 0 110 110" width="52%" height="52%">{sh[cat]||sh.Top}</svg>);};
const ItemPhoto=({src,category,style:s})=>{const[err,setErr]=useState(false);if(!src||err)return<GS cat={category}/>;return<img src={src} onError={()=>setErr(true)} style={s} alt=""/>;};

function HomeScreen({ photoData={}, favourites=[], onShowAllItems, onGoToFavorites, onAddItem, userEmail="", username="" }) {
  const now=new Date();
  const toKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const todayKey=toKey(now);
  const loggedToday=!!(photoData[todayKey]?.logged);
  const allLoggedKeys=Object.keys(photoData).filter(k=>photoData[k]?.logged).sort().reverse();

  // Show today's outfit if logged, otherwise most recent
  const displayKey=loggedToday?todayKey:(allLoggedKeys[0]||null);
  const displayEntry=displayKey?photoData[displayKey]:null;
  const items=(displayEntry?.items||[]).filter(i=>i&&typeof i==="object"&&i.name);

  // Date display: DD.MM.YY
  const dateLabel=`${String(now.getDate()).padStart(2,"0")}.${String(now.getMonth()+1).padStart(2,"0")}.${String(now.getFullYear()).slice(2)}`;

  // Auto headline from items
  const headline=(()=>{
    if(!items.length) return null;
    const raw=items.map(i=>i.name?.toLowerCase()).filter(Boolean).join(", ")+".";
    return raw.charAt(0).toUpperCase()+raw.slice(1);
  })();

  // Wear counts across all outfits
  const wearCountMap={};
  allLoggedKeys.forEach(k=>{ (photoData[k]?.items||[]).filter(i=>i?.name).forEach(i=>{ const key=i.name.trim().toLowerCase(); wearCountMap[key]=(wearCountMap[key]||0)+1; }); });

  // Combo count: how many times this exact item set has been worn
  const itemSet=new Set(items.map(i=>i.name?.trim().toLowerCase()).filter(Boolean));
  const comboCount=allLoggedKeys.filter(k=>{
    const kSet=new Set((photoData[k]?.items||[]).filter(i=>i?.name).map(i=>i.name.trim().toLowerCase()));
    return itemSet.size===kSet.size&&[...itemSet].every(n=>kSet.has(n));
  }).length;
  const ordinal=n=>{const s=["th","st","nd","rd"];const v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);};

  // Avg CPW for today's items
  const avgItemCPW=(()=>{
    const priced=items.filter(i=>i.price!=null&&parseFloat(i.price)>0);
    if(!priced.length) return null;
    const tot=priced.reduce((s,i)=>{const w=wearCountMap[i.name.trim().toLowerCase()]||1;return s+parseFloat(i.price)/w;},0);
    return tot/priced.length;
  })();

  // Similar outfits (≥2 items in common)
  const similarCount=allLoggedKeys.filter(k=>{
    if(k===displayKey) return false;
    const kSet=new Set((photoData[k]?.items||[]).filter(i=>i?.name).map(i=>i.name.trim().toLowerCase()));
    return[...itemSet].filter(n=>kSet.has(n)).length>=2;
  }).length;

  // Days since last worn (any item from today's outfit)
  const lastWornDays=(()=>{
    if(!itemSet.size) return null;
    const prev=allLoggedKeys.filter(k=>k!==displayKey&&[...itemSet].some(n=>(photoData[k]?.items||[]).some(i=>i?.name?.trim().toLowerCase()===n)));
    if(!prev.length) return null;
    const[y,m,d]=prev[0].split("-").map(Number);
    return Math.round((now-new Date(y,m-1,d))/(1000*60*60*24));
  })();

  // Days since last log (for non-today display)
  const daysSinceLog=(()=>{
    if(!displayKey||loggedToday) return null;
    const[y,m,d]=displayKey.split("-").map(Number);
    return Math.round((now-new Date(y,m-1,d))/(1000*60*60*24));
  })();

  const ML={fontFamily:F.mono,fontSize:9,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub};

  const intelRows=[
    {label:"Cost/wear",val:avgItemCPW!=null?`${getCurrencySymbol()}${avgItemCPW.toFixed(2)}`:"—",right:"tracked"},
    {label:"Similar",val:similarCount>0?`${similarCount} outfits`:"—",right:"pairable"},
    {label:"Last worn",val:lastWornDays!=null?`${lastWornDays}d ago`:"first time",right:"this combo"},
  ];

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface}}>
      {/* Nav */}
      <div style={{padding:"16px 20px 10px",background:C.surface,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <button onClick={onShowAllItems} style={{border:"none",background:"transparent",cursor:"pointer",padding:0}}>
          <span style={{...ML}}>§ 01 / Home</span>
        </button>
        <span style={{fontFamily:F.mono,fontSize:10,color:C.sub,letterSpacing:"0.08em"}}>{dateLabel}</span>
      </div>

      {/* Main card — fills remaining height, scrollable */}
      <div style={{flex:1,overflowY:"auto",margin:"0 8px 8px",background:C.surface,border:`1px solid ${C.border}`}}>

        {/* CTA */}
        <button onClick={onAddItem} style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",padding:"0 14px",height:48,background:C.ink,border:"none",borderBottom:`1px solid ${C.border}`,cursor:"pointer",fontFamily:"inherit",boxSizing:"border-box"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{...ML,color:"rgba(255,255,255,0.45)"}}>Log</span>
            <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>{loggedToday?"Edit today's outfit":"Confirm today's outfit"}</span>
          </div>
          <ChevronRight size={16} color="rgba(255,255,255,0.6)" strokeWidth={2}/>
        </button>

        {displayEntry?(
          <>
            {/* Outfit label + headline */}
            <div style={{padding:"14px 14px 12px"}}>
              <span style={{...ML,color:C.sage}}>Outfit / {String(allLoggedKeys.indexOf(displayKey)+1).padStart(2,"0")}</span>
              <h2 style={{fontFamily:F.serif,fontSize:28,fontWeight:700,color:C.ink,margin:"6px 0 10px",letterSpacing:"-0.01em",lineHeight:1.15}}>{headline||"Outfit logged"}</h2>
              {/* Tags */}
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {displayEntry.style&&<span style={{fontSize:11,color:C.ink,background:C.white,border:`1px solid ${C.border}`,padding:"3px 10px"}}>{displayEntry.style}</span>}
                {displayEntry.season&&<span style={{fontSize:11,color:C.ink,background:C.white,border:`1px solid ${C.border}`,padding:"3px 10px"}}>{displayEntry.season}</span>}
                {comboCount>0&&<span style={{fontSize:11,color:C.ink,background:C.white,border:`1px solid ${C.border}`,padding:"3px 10px"}}>{ordinal(comboCount)} wear</span>}
              </div>
            </div>

            {/* Item tiles */}
            {items.length>0&&(
              <div style={{display:"flex",gap:8,padding:"0 8px 8px"}}>
                {items.slice(0,3).map((item,i)=>{
                  const wears=wearCountMap[item.name.trim().toLowerCase()]||1;
                  return(
                    <div key={i} style={{flex:"1 1 0",minWidth:0,background:C.white,border:`1px solid ${C.border}`}}>
                      <div style={{width:"100%",height:72,background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                        <ItemPhoto src={item.itemPhoto} category={item.category} style={{width:"100%",height:"100%",objectFit:"contain",display:"block"}}/>
                      </div>
                      <div style={{padding:"6px 8px 8px"}}>
                        <span style={{fontFamily:F.mono,fontSize:9,fontWeight:500,letterSpacing:"0.1em",color:C.sage}}>{String(i+1).padStart(2,"0")}</span>
                        <div style={{fontSize:12,fontWeight:700,color:C.ink,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</div>
                        <div style={{fontSize:10,color:C.sub,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{[item.brand,`${wears}×`].filter(Boolean).join(" · ")}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* TODAY'S INTEL */}
            <div style={{margin:"0 8px 8px",background:C.white,border:`1px solid ${C.border}`}}>
              <div style={{padding:"9px 14px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{...ML}}>Today's Intel</span>
                <span style={{...ML}}>{intelRows.filter(r=>r.val!=="—").length} insights</span>
              </div>
              {intelRows.map((r,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",padding:"11px 14px",borderBottom:i<intelRows.length-1?`1px solid ${C.border}`:"none",gap:8}}>
                  <span style={{fontSize:12,color:C.sub,flex:"0 0 76px"}}>{r.label}</span>
                  <span style={{fontSize:13,fontWeight:700,color:C.ink,flex:1}}>{r.val}</span>
                  <span style={{fontSize:11,color:C.sage}}>{r.right}</span>
                </div>
              ))}
            </div>
          </>
        ):(
          <div style={{padding:"40px 20px",textAlign:"center"}}>
            <Shirt size={36} color={C.sub} strokeWidth={1} style={{margin:"0 auto 14px",display:"block"}}/>
            <div style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:6}}>No outfits logged yet</div>
            <div style={{fontSize:13,color:C.sub,lineHeight:1.5}}>Log your first outfit to see your daily summary here.</div>
          </div>
        )}
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
  const [filterPeriod,setFilterPeriod]=useState("overall");
  const [showFilterMenu,setShowFilterMenu]=useState(false);
  const [periodTab,setPeriodTab]=useState("all");

  // Available months (months with logged data + current month)
  const _now=new Date();
  const _nowMonthKey=`${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,"0")}`;
  const _availableMonths=[...(()=>{ const s=new Set(Object.keys(photoData).filter(k=>photoData[k]?.logged).map(k=>k.slice(0,7))); s.add(_nowMonthKey); return [...s].sort().reverse(); })()];
  const _formatPeriod=key=>{ if(key==="overall") return "Overall"; const [y,m]=key.split("-"); return new Date(Number(y),Number(m)-1,1).toLocaleDateString("en-US",{month:"long",year:"numeric"}); };
  const filterLabel=_formatPeriod(filterPeriod);

  const loggedOutfits=Object.entries(photoData).filter(([key,e])=>e&&e.logged&&(filterPeriod==="overall"||key.startsWith(filterPeriod))).flatMap(([,e])=>e.outfit2?[e,e.outfit2]:[e]);
  const totalOutfits=loggedOutfits.length;
  // Total item instances across all outfits (any valid object counts)
  const totalItemsCount=loggedOutfits.reduce((sum,e)=>sum+(e.items||[]).filter(i=>i&&typeof i==="object").length,0);
  // Named items only — used for wear counts, color distribution, most/least worn
  const allLoggedObjs=loggedOutfits.flatMap(e=>(e.items||[]).map(item=>typeof item==="object"?item:{ name:String(item||""),category:"Other" }).filter(item=>item&&item.name&&typeof item.name==="string"));
  const wearCounts={};
  allLoggedObjs.forEach(item=>{ const k=(item.name||"").toLowerCase().trim(); if(!k) return; if(!wearCounts[k]) wearCounts[k]={ name:item.name,category:item.category||"Other",count:0 }; wearCounts[k].count+=1; });
  // Map each item name → { photo, dateKey } from its most recent logged outfit
  const itemLastInfo={};
  Object.entries(photoData).sort(([a],[b])=>b.localeCompare(a)).forEach(([dateKey,entry])=>{ if(!entry?.logged) return; [...(entry.items||[]),...(entry.outfit2?.items||[])].forEach(item=>{ if(!item||typeof item!=="object") return; const k=(item.name||"").trim().toLowerCase(); if(!k) return; if(!itemLastInfo[k]) itemLastInfo[k]={ photo:entry.photo||null, dateKey, itemPhoto:item.itemPhoto||null, brand:null, price:null, color:null }; if(item.brand&&!itemLastInfo[k].brand) itemLastInfo[k].brand=toCanonicalBrand(item.brand); if(item.price!=null&&itemLastInfo[k].price==null){ const p=parseFloat(item.price); if(!isNaN(p)) itemLastInfo[k].price=p; } if(item.color&&!itemLastInfo[k].color) itemLastInfo[k].color=item.color; }); });
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
  loggedOutfits.forEach(entry=>{ const s=entry.style&&styleCounts.hasOwnProperty(entry.style)?entry.style:getStyle(entry.items); styleCounts[s]+=1; });
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
    const allCategories=["All",...[...new Set(wearArr.map(i=>i.category).filter(Boolean))].sort()];
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

    // Inline SVG garment shapes — fallback when no item photo
    const GarmentShape=({ category })=>{
      const col="#3A4A38";
      const shapes={
        "Top":      <path d="M20 20 L35 12 L45 18 L65 18 L75 12 L90 20 L95 45 L85 48 L85 95 L25 95 L25 48 L15 45 Z" fill={col}/>,
        "Bottom":   <path d="M30 15 L80 15 L82 50 L78 95 L60 95 L55 55 L50 95 L32 95 L28 50 Z" fill={col}/>,
        "Dresses":  <path d="M35 15 L45 10 L65 10 L75 15 L72 30 L85 95 L25 95 L38 30 Z" fill={col}/>,
        "Outerwear":<path d="M18 22 L35 12 L45 16 L55 14 L65 16 L75 12 L92 22 L90 95 L68 95 L55 55 L42 95 L20 95 Z" fill={col}/>,
        "Shoes":    <path d="M12 60 L35 55 L55 52 L80 55 L92 62 L92 72 L15 72 Z" fill={col}/>,
        "Accessories":<g><path d="M32 25 Q55 10 78 25" stroke={col} strokeWidth="3" fill="none"/><path d="M25 30 L85 30 L80 90 L30 90 Z" fill={col}/></g>,
        "Swimwear": <path d="M35 15 L75 15 L78 28 L90 95 L20 95 L32 28 Z" fill={col}/>,
      };
      return (
        <svg viewBox="0 0 110 110" width="60%" height="60%" style={{ display:"block" }}>
          {shapes[category]||shapes["Top"]}
        </svg>
      );
    };

    return (
      <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
        {/* Header */}
        <div style={{ padding:"28px 24px 0",flexShrink:0 }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
            <button onClick={()=>setView("main")} style={{ border:"none",background:"transparent",cursor:"pointer",padding:0,display:"flex",alignItems:"center",gap:4 }}>
              <span style={{ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub }}>§ 02 · Wardrobe</span>
            </button>
            <span style={{ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub }}>{wearArr.length} Items</span>
          </div>
          <h1 style={{ fontSize:34,fontWeight:800,color:C.ink,margin:"0 0 16px",letterSpacing:"-0.03em",lineHeight:1 }}>Your library</h1>
        </div>
        {/* Filters */}
        <div style={{ flexShrink:0,padding:"0 24px" }}>
          <div style={{ display:"flex",gap:8,overflowX:"auto",paddingBottom:10,scrollbarWidth:"none",msOverflowStyle:"none" }}>
            {allCategories.map(c=>(
              <button key={c} onClick={()=>setItemCatFilter(c)} style={{ flexShrink:0,height:32,padding:"0 16px",borderRadius:0,border:`1px solid ${itemCatFilter===c?C.ink:C.border}`,background:itemCatFilter===c?C.ink:C.white,color:itemCatFilter===c?"#fff":C.sub,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:F.sans,letterSpacing:"0.01em" }}>{c}</button>
            ))}
          </div>
          <div style={{ display:"flex",gap:6,paddingBottom:12,borderBottom:`1px solid ${C.border}` }}>
            {[{id:"most",label:"Most Worn"},{id:"least",label:"Least Worn"},{id:"az",label:"A–Z"}].map(s=>(
              <button key={s.id} onClick={()=>setItemSort(s.id)} style={{ height:24,padding:"0 10px",borderRadius:0,border:itemSort===s.id?`1px solid ${C.ink}`:`1px solid ${C.border}`,background:itemSort===s.id?C.ink:"transparent",color:itemSort===s.id?"#fff":C.sub,fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:F.mono,letterSpacing:"0.06em",textTransform:"uppercase" }}>{s.label}</button>
            ))}
          </div>
        </div>
        {/* Grid */}
        <div style={{ flex:1,overflowY:"auto",padding:"12px 12px 32px" }}>
          {wearArr.length===0 ? (
            <div style={{ textAlign:"center",padding:"48px 24px" }}>
              <Shirt size={36} color={C.sub} strokeWidth={1.5} style={{ margin:"0 auto 16px",display:"block" }}/>
              <div style={{ fontSize:16,fontWeight:700,color:C.ink,marginBottom:6 }}>No items yet</div>
              <div style={{ fontSize:13,color:C.sub }}>Log an outfit on the Calendar screen to see your items here.</div>
            </div>
          ) : sortedItems.length===0 ? (
            <div style={{ textAlign:"center",padding:"40px 24px" }}>
              <div style={{ fontSize:15,fontWeight:700,color:C.ink,marginBottom:4 }}>No items match</div>
              <div style={{ fontSize:13,color:C.sub }}>Try a different category</div>
            </div>
          ) : (
            <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8 }}>
              {sortedItems.map((item,idx)=>(
                <button key={idx} onClick={()=>setSelectedWearItem({...item,_idx:idx+1})} style={{ background:C.white,border:`1px solid ${C.border}`,cursor:"pointer",textAlign:"left",fontFamily:"inherit",padding:0,display:"flex",flexDirection:"column",overflow:"hidden" }}>
                  {/* Photo / silhouette tile */}
                  <div style={{ width:"100%",aspectRatio:"1/1",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",flexShrink:0 }}>
                    {item.lastPhoto
                      ? <img src={item.lastPhoto} alt={item.name} style={{ width:"100%",height:"100%",objectFit:"contain",display:"block" }}/>
                      : <GarmentShape category={item.category}/>
                    }
                  </div>
                  {/* Info */}
                  <div style={{ padding:"8px 10px 10px",flex:1 }}>
                    <div style={{ display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:3 }}>
                      <span style={{ fontFamily:F.mono,fontSize:9,color:C.sub,letterSpacing:"0.06em" }}>{String(idx+1).padStart(2,"0")}</span>
                      <span style={{ fontFamily:F.mono,fontSize:9,color:C.sub,letterSpacing:"0.04em" }}>{item.count}×</span>
                    </div>
                    <div style={{ fontSize:12,fontWeight:600,color:C.ink,lineHeight:1.3,marginBottom:2,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical" }}>{item.name}</div>
                    <div style={{ fontSize:11,color:C.sub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{item.brand||item.category||""}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Item detail — full-screen overlay */}
        {selectedWearItem&&(()=>{
          const sw=selectedWearItem;
          const cpwVal=sw.price!=null&&sw.count>0?(sw.price/sw.count):null;
          const lastDays=(()=>{ if(!datesWorn.length) return null; const [y,m,d]=datesWorn[0].split("-").map(Number); const diff=Math.round((new Date()-new Date(y,m-1,d))/(1000*60*60*24)); return diff; })();
          const firstWorn=(()=>{ if(!datesWorn.length) return null; const [y,m,d]=datesWorn[datesWorn.length-1].split("-").map(Number); return new Date(y,m-1,d).toLocaleDateString("en-US",{month:"short",year:"numeric"}); })();

          // Wear rhythm — last 12 weeks
          const todayDate=new Date(); todayDate.setHours(0,0,0,0);
          const wornSet=new Set(datesWorn);
          const rhythmCells=[];
          for(let i=83;i>=0;i--){
            const dd=new Date(todayDate); dd.setDate(todayDate.getDate()-i);
            const k=`${dd.getFullYear()}-${String(dd.getMonth()+1).padStart(2,"0")}-${String(dd.getDate()).padStart(2,"0")}`;
            rhythmCells.push(wornSet.has(k));
          }

          // Frequently paired
          const pairedCounts={};
          datesWorn.forEach(dk=>{ const e=photoData[dk]; if(!e?.items) return; e.items.forEach(it=>{ const k=(it.name||"").trim().toLowerCase(); if(!k||k===sw.name.trim().toLowerCase()) return; pairedCounts[k]=(pairedCounts[k]||0)+1; }); });
          const pairedItems=Object.entries(pairedCounts).sort(([,a],[,b])=>b-a).slice(0,6).map(([name,cnt])=>{ const found=wearArr.find(w=>w.name.trim().toLowerCase()===name)||{name,category:"Other",count:0}; return {...found,pairCount:cnt}; });

          const MLABEL={ fontFamily:F.mono,fontSize:9,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub };
          const AttrRow=({label,value,last,valueColor})=>(
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 16px",borderBottom:last?"none":`1px solid ${C.border}` }}>
              <span style={{ fontSize:12,color:C.sub }}>{label}</span>
              <span style={{ fontSize:12,color:valueColor||C.ink,fontWeight:500 }}>{value}</span>
            </div>
          );

          const isTop5=wearArr.findIndex(w=>w.name.trim().toLowerCase()===sw.name.trim().toLowerCase())<5;
          const totalItems=wearArr.length;
          return (
            <div style={{ position:"fixed",inset:0,background:C.surface,zIndex:9999,display:"flex",flexDirection:"column",overflowY:"auto" }}>
              {/* Top nav */}
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px 12px",background:C.surface,flexShrink:0 }}>
                <button onClick={()=>setSelectedWearItem(null)} style={{ border:"none",background:"transparent",cursor:"pointer",padding:0,display:"flex",alignItems:"center",gap:4 }}>
                  <ChevronLeft size={14} color={C.sub} strokeWidth={2}/>
                  <span style={{ fontFamily:F.mono,fontSize:10,letterSpacing:"0.08em",color:C.sub }}>Wardrobe</span>
                </button>
                <span style={{ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.12em",textTransform:"uppercase",color:C.sage }}>Item {String(sw._idx||1).padStart(2,"0")} / {totalItems}</span>
                <span style={{ fontFamily:F.mono,fontSize:13,color:C.sub,letterSpacing:"0.1em" }}>···</span>
              </div>

              {/* Image hero */}
              <div style={{ margin:"0 16px",background:C.white,border:`1px solid ${C.border}`,position:"relative",flexShrink:0 }}>
                <div style={{ width:"100%",aspectRatio:"4/3",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden" }}>
                  {sw.lastPhoto
                    ? <img src={sw.lastPhoto} alt={sw.name} style={{ width:"100%",height:"100%",objectFit:"contain",display:"block" }}/>
                    : <GarmentShape category={sw.category}/>
                  }
                </div>
                {isTop5&&(
                  <div style={{ position:"absolute",top:10,left:10,background:C.ink,padding:"4px 8px",display:"flex",alignItems:"center",gap:4 }}>
                    <span style={{ fontSize:8,color:"#fff" }}>★</span>
                    <span style={{ fontFamily:F.mono,fontSize:9,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",color:"#fff" }}>Top 5</span>
                  </div>
                )}
              </div>

              {/* Identity */}
              <div style={{ padding:"16px 20px 4px",flexShrink:0 }}>
                <div style={{ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub,marginBottom:6 }}>{sw.category||"Item"} · N°{String(sw._idx||"?").padStart(2,"0")}</div>
                <h1 style={{ fontSize:26,fontWeight:800,color:C.ink,margin:"0 0 5px",letterSpacing:"-0.02em",lineHeight:1.15 }}>{sw.name}</h1>
                <div style={{ fontSize:13,color:C.sub }}>{[sw.brand,firstWorn?`acquired ${firstWorn}`:null].filter(Boolean).join(" · ")}</div>
              </div>

              {/* Stats row */}
              <div style={{ display:"flex",padding:"16px 20px 20px",gap:24,flexShrink:0 }}>
                {[
                  { val:cpwVal!=null?`${getCurrencySymbol()}${cpwVal.toFixed(2)}`:"—", label:"CPW" },
                  { val:`${sw.count}×`, label:"Worn" },
                  { val:lastDays!=null?`${lastDays}d`:"—", label:"Last" },
                ].map((s,i)=>(
                  <div key={i} style={{ display:"flex",flexDirection:"column",gap:4 }}>
                    <div style={{ fontSize:24,fontWeight:700,color:C.ink,letterSpacing:"-0.02em",lineHeight:1 }}>{s.val}</div>
                    <div style={{ fontFamily:F.mono,fontSize:9,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* § ATTRIBUTES */}
              <div style={{ margin:"0 16px 12px",background:C.white,border:`1px solid ${C.border}`,flexShrink:0 }}>
                <div style={{ padding:"10px 16px",borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontFamily:F.mono,fontSize:9,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub }}>§ Attributes</span>
                </div>
                {sw.category&&<AttrRow label="Category" value={sw.category}/>}
                {toColors(sw.color).length>0&&<AttrRow label="Color" value={toColors(sw.color).join(" · ")}/>}
                {sw.brand&&<AttrRow label="Brand" value={sw.brand}/>}
                {sw.price!=null&&<AttrRow label="Price" value={`${getCurrencySymbol()}${Number(sw.price).toFixed(2)}`}/>}
                {cpwVal!=null&&<AttrRow label="Cost per wear" value={`${getCurrencySymbol()}${cpwVal.toFixed(2)}`} valueColor={C.sage} last/>}
                {!sw.category&&!sw.color&&!sw.brand&&!sw.price&&<div style={{ padding:"14px 16px" }}><span style={{ fontSize:13,color:C.sub }}>No attributes recorded</span></div>}
              </div>

              {/* § WEAR RHYTHM */}
              <div style={{ margin:"0 16px 12px",background:C.white,border:`1px solid ${C.border}`,flexShrink:0 }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontFamily:F.mono,fontSize:9,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub }}>§ Wear Rhythm</span>
                  <span style={{ fontFamily:F.mono,fontSize:9,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub }}>12 Weeks</span>
                </div>
                <div style={{ padding:"14px 16px" }}>
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(12,1fr)",gridAutoFlow:"column",gridTemplateRows:"repeat(7,1fr)",gap:2 }}>
                    {rhythmCells.map((worn,i)=>(
                      <div key={i} style={{ width:"100%",aspectRatio:"1/1",background:worn?C.sage:C.surface,opacity:worn?1:0.7 }}/>
                    ))}
                  </div>
                </div>
              </div>

              {/* § FREQUENTLY PAIRED */}
              {pairedItems.length>0&&(
                <div style={{ margin:"0 16px 40px",background:C.white,border:`1px solid ${C.border}`,flexShrink:0 }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:`1px solid ${C.border}` }}>
                    <span style={{ fontFamily:F.mono,fontSize:9,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub }}>§ Frequently Paired</span>
                    <span style={{ fontFamily:F.mono,fontSize:9,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub }}>{pairedItems.length} of {Object.keys(pairedCounts).length}</span>
                  </div>
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:0 }}>
                    {pairedItems.slice(0,3).map((pi,i)=>(
                      <div key={i} style={{ borderRight:i<2?`1px solid ${C.border}`:"none" }}>
                        <div style={{ width:"100%",aspectRatio:"1/1",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden" }}>
                          {pi.lastPhoto
                            ? <img src={pi.lastPhoto} alt={pi.name} style={{ width:"100%",height:"100%",objectFit:"contain",display:"block" }}/>
                            : <GarmentShape category={pi.category}/>
                          }
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
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
            <div><div style={{ fontSize:26,fontWeight:500,color:C.ink,letterSpacing:"-0.02em",fontFamily:F.mono }}>{selectedPiece.wears} wears</div><div style={{ fontSize:13,color:C.sub }}>{pct}% of outfit appearances</div></div>
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
                <div style={{ fontSize:36,fontWeight:500,color:"#fff",lineHeight:1.1,marginTop:4,letterSpacing:"-0.02em",fontFamily:F.mono }}>${avgCPW}</div>
                <div style={{ fontSize:12,color:"rgba(255,255,255,.7)",marginTop:2 }}>{pricedItems.length} items tracked</div>
              </div>
              <DollarSign size={44} color="rgba(255,255,255,.8)" strokeWidth={1.5}/>
            </div>
          )}
          {priced.length>0&&(
            <div style={{ marginBottom:16 }}>
              <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,marginBottom:10 }}>Tracked Items</p>
              {priced.map((item,i)=>(
                <div key={i} style={{ background:C.white,borderRadius:0,padding:"14px 16px",marginBottom:10,border:`1px solid ${C.border}` }}>
                  <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:10 }}>
                    <div style={{ width:42,height:42,borderRadius:0,background:C.sage+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>{catEmoji(item.category)}</div>
                    <div style={{ flex:1 }}><div style={{ fontSize:14,fontWeight:700,color:C.ink }}>{item.label}</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>${item.price.toFixed(2)} · {item.wears} wear{item.wears!==1?"s":""}</div></div>
                    <div style={{ textAlign:"right" }}><div style={{ fontSize:20,fontWeight:500,color:C.sage,letterSpacing:"-0.01em",fontFamily:F.mono }}>${item.cpw.toFixed(2)}</div><div style={{ fontSize:10,color:C.sub }}>per wear</div></div>
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
              <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,marginBottom:10 }}>Add Price to Track ({unpriced.length} items)</p>
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
              {cpwPriceInput&&parseFloat(cpwPriceInput)>0&&<div style={{ background:C.sage+"14",borderRadius:0,padding:"10px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center" }}><span style={{ fontSize:13,color:C.sub }}>Cost per wear</span><span style={{ fontSize:22,fontWeight:500,color:C.sage,fontFamily:F.mono }}>${(parseFloat(cpwPriceInput)/cpwAddModal.wears).toFixed(2)}</span></div>}
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
              {cpwPriceInput&&parseFloat(cpwPriceInput)>0&&<div style={{ background:C.sage+"14",borderRadius:0,padding:"10px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center" }}><span style={{ fontSize:13,color:C.sub }}>New cost per wear</span><span style={{ fontSize:22,fontWeight:500,color:C.sage,fontFamily:F.mono }}>${(parseFloat(cpwPriceInput)/cpwEditItem.wears).toFixed(2)}</span></div>}
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

  // Period-filtered analytics data
  const _curY=new Date().getFullYear();
  const _todayStr=(()=>{const n=new Date();return`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;})();
  const _pf=dk=>{if(periodTab==="all")return true;const[y,m]=dk.split("-").map(Number);if(periodTab==="q1")return y===_curY&&m>=1&&m<=3;if(periodTab==="q2")return y===_curY&&m>=4&&m<=6;if(periodTab==="q3")return y===_curY&&m>=7&&m<=9;if(periodTab==="ytd")return y===_curY&&dk<=_todayStr;return true;};
  const pEntries=Object.entries(photoData).filter(([k,v])=>v?.logged&&_pf(k));
  const pDates=pEntries.map(([k])=>k).sort();
  const pOutfitCount=pEntries.length;
  const pAllItems=pEntries.flatMap(([,e])=>(e.items||[]).filter(i=>i&&typeof i==="object"&&i.name));
  const pUniqueNames=new Set(pAllItems.map(i=>i.name.trim().toLowerCase()));
  const pGarments=pUniqueNames.size;
  const pDays=pDates.length>0?Math.max(1,Math.round((new Date()-new Date(pDates[0]))/(1000*60*60*24))+1):0;
  const pItemMap={};
  pAllItems.forEach(item=>{const k=item.name.trim().toLowerCase();if(!pItemMap[k])pItemMap[k]={name:item.name,category:item.category||"Other",count:0,price:null,brand:item.brand||null,photo:item.itemPhoto||null};pItemMap[k].count++;const p=parseFloat(item.price);if(!isNaN(p)&&p>0)pItemMap[k].price=p;if(item.itemPhoto&&!pItemMap[k].photo)pItemMap[k].photo=item.itemPhoto;});
  const pCPWVals=Object.values(pItemMap).filter(v=>v.price!=null).map(v=>v.price/v.count);
  const pAvgCPW=pCPWVals.length>0?(pCPWVals.reduce((s,v)=>s+v,0)/pCPWVals.length):null;
  const pWornNames=new Set(pAllItems.map(i=>i.name.trim().toLowerCase()));
  const pUtil=wearArr.length>0?Math.round(pWornNames.size/wearArr.length*100):0;
  const pLowUse=Object.values(pItemMap).filter(v=>v.count<=1).length;
  const pNewItems=(()=>{if(periodTab==="all")return 0;const prior=new Set(Object.entries(photoData).filter(([k,v])=>v?.logged&&!_pf(k)&&k<(pDates[0]||"9")).flatMap(([,e])=>(e.items||[]).filter(i=>i?.name).map(i=>i.name.trim().toLowerCase())));return[...pWornNames].filter(n=>!prior.has(n)).length;})();
  const pTotalWears=pAllItems.length;
  const pCO2=pTotalWears>0?(pTotalWears*0.4).toFixed(1):"—";
  const linePoints=(()=>{if(!pDates.length)return[];const dc={};pDates.forEach(d=>{dc[d]=(dc[d]||0)+1;});const sorted=Object.entries(dc).sort(([a],[b])=>a.localeCompare(b));let cum=0;return sorted.map(([,c])=>{cum+=c;return cum;});})();
  const pColorCounts={};
  pAllItems.forEach(item=>{toColors(item.color).forEach(c=>{const k=colorHex[c]?c:"Other";pColorCounts[k]=(pColorCounts[k]||0)+1;});});
  const pColorTotal=Object.values(pColorCounts).reduce((s,v)=>s+v,0)||1;
  const pColorData=Object.entries(pColorCounts).filter(([n])=>n!=="Other").sort(([,a],[,b])=>b-a).concat(pColorCounts["Other"]?[["Other",pColorCounts["Other"]]]:[]).map(([name,cnt])=>({name,pct:Math.round(cnt/pColorTotal*100),hex:colorHex[name]||"#B0AFA9"})).slice(0,5);
  const pItemArr=Object.values(pItemMap).sort((a,b)=>b.count-a.count);
  const pMaxWears=pItemArr[0]?.count||1;
  const pMostWorn=pItemArr.slice(0,5);
  const pLeastWorn=[...pItemArr].sort((a,b)=>a.count-b.count).slice(0,5);
  const pStyleCounts={};
  pEntries.forEach(([,e])=>{const s=e.style&&["Everyday","Going Out","Activewear","Professional"].includes(e.style)?e.style:getStyle(e.items);pStyleCounts[s]=(pStyleCounts[s]||0)+1;});
  const pStyleTotal=Object.values(pStyleCounts).reduce((s,v)=>s+v,0)||1;
  const pStyleData=Object.entries(pStyleCounts).sort(([,a],[,b])=>b-a).map(([name,cnt])=>({name,pct:Math.round(cnt/pStyleTotal*100),count:cnt}));
  const topStyle=pStyleData[0];
  const ML={fontFamily:F.mono,fontSize:9,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub};
  const GS=({cat,size=24})=>{const col="#3A4A38";const sh={Top:<path d="M20 20 L35 12 L45 18 L65 18 L75 12 L90 20 L95 45 L85 48 L85 95 L25 95 L25 48 L15 45 Z" fill={col}/>,Bottom:<path d="M30 15 L80 15 L82 50 L78 95 L60 95 L55 55 L50 95 L32 95 L28 50 Z" fill={col}/>,Dresses:<path d="M35 15 L45 10 L65 10 L75 15 L72 30 L85 95 L25 95 L38 30 Z" fill={col}/>,Outerwear:<path d="M18 22 L35 12 L45 16 L55 14 L65 16 L75 12 L92 22 L90 95 L68 95 L55 55 L42 95 L20 95 Z" fill={col}/>,Shoes:<path d="M12 60 L35 55 L55 52 L80 55 L92 62 L92 72 L15 72 Z" fill={col}/>,Accessories:<g><path d="M32 25 Q55 10 78 25" stroke={col} strokeWidth="3" fill="none"/><path d="M25 30 L85 30 L80 90 L30 90 Z" fill={col}/></g>};return(<svg viewBox="0 0 110 110" width={size} height={size}>{sh[cat]||sh.Top}</svg>);};

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface}}>
      {/* Header */}
      <div style={{padding:"28px 24px 0",background:C.surface,flexShrink:0}}>
        {onBack&&<button onClick={onBack} style={{display:"flex",alignItems:"center",gap:4,border:"none",background:"transparent",color:C.sub,fontSize:13,cursor:"pointer",padding:"0 0 8px",fontFamily:"inherit"}}><ChevronLeft size={15} color={C.sub} strokeWidth={2}/>Back</button>}
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
          <div>
            <span style={{...ML}}>§ 01 / Overview</span>
            <h1 style={{fontSize:34,fontWeight:800,color:C.ink,margin:"6px 0 4px",letterSpacing:"-0.03em",lineHeight:1}}>Analytics</h1>
            <p style={{fontSize:11,color:C.sub,margin:0,fontFamily:F.mono,letterSpacing:"0.03em"}}>
              {pDays>0?`${pDays}d · `:""}{pGarments} garments tracked · <span style={{color:C.sage,cursor:"pointer"}} onClick={()=>setView("items")}>{pOutfitCount} outfits</span>
            </p>
          </div>
          <button onClick={()=>setView("items")} style={{border:`1px solid ${C.border}`,background:C.white,padding:"6px 12px",cursor:"pointer",fontFamily:F.mono,fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:C.sub,marginTop:4,flexShrink:0}}>Library</button>
        </div>
        {/* Period tabs */}
        <div style={{display:"flex",gap:0,marginTop:14,borderBottom:`1px solid ${C.border}`}}>
          {[{k:"q1",l:"Q1"},{k:"q2",l:"Q2"},{k:"q3",l:"Q3"},{k:"ytd",l:"YTD"},{k:"all",l:"All"}].map(t=>(
            <button key={t.k} onClick={()=>setPeriodTab(t.k)} style={{flex:1,height:32,border:"none",borderBottom:periodTab===t.k?`2px solid ${C.ink}`:"2px solid transparent",background:periodTab===t.k?C.ink:"transparent",fontFamily:F.mono,fontSize:9,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",color:periodTab===t.k?"#fff":C.sub,cursor:"pointer",padding:0,marginBottom:-1,transition:"background .15s"}}>
              {t.l}
            </button>
          ))}
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto"}}>
        {/* 4 stat cards */}
        <div style={{display:"flex",gap:8,overflowX:"auto",scrollbarWidth:"none",padding:"16px 16px 0",msOverflowStyle:"none"}}>
          {[
            {label:"Cost / Wear",val:pAvgCPW!=null?`${getCurrencySymbol()}${pAvgCPW.toFixed(2)}`:"—",sub:"avg across tracked items",onClick:()=>pOutfitCount>0&&setView("cpw")},
            {label:"Utilization",val:pUtil>0?`${pUtil}%`:"—",sub:`${pWornNames.size} of ${wearArr.length} worn`,onClick:null},
            {label:"New · Unworn",val:(pNewItems>0||pLowUse>0)?`${pNewItems} · ${pLowUse}`:"—",sub:"new items · low-use",onClick:null},
            {label:"CO₂ Avoided",val:pCO2!=="—"?`${pCO2}kg`:"—",sub:"re-wear impact",onClick:null},
          ].map((s,i)=>(
            <div key={i} onClick={s.onClick||undefined} style={{flexShrink:0,width:138,background:C.white,border:`1px solid ${C.border}`,padding:"14px 14px 12px",cursor:s.onClick?"pointer":"default"}}>
              <div style={{...ML,marginBottom:8}}>{s.label}</div>
              <div style={{fontSize:22,fontWeight:700,color:C.ink,letterSpacing:"-0.02em",lineHeight:1,fontFamily:F.mono}}>{s.val}</div>
              <div style={{fontSize:10,color:C.sub,marginTop:6,lineHeight:1.3}}>{s.sub}</div>
            </div>
          ))}
        </div>

        {pOutfitCount===0?(
          <div style={{textAlign:"center",padding:"48px 24px"}}>
            <Shirt size={36} color={C.sub} strokeWidth={1} style={{margin:"0 auto 16px",display:"block"}}/>
            <div style={{fontSize:16,fontWeight:700,color:C.ink,marginBottom:6}}>No outfits logged{periodTab!=="all"?" this period":""}</div>
            <div style={{fontSize:13,color:C.sub}}>Log outfits on the Calendar tab to see your insights</div>
          </div>
        ):(
          <>
            {/* § 02 / VOLUME — cumulative line chart */}
            {linePoints.length>1&&(
              <div style={{margin:"12px 16px 0",background:C.white,border:`1px solid ${C.border}`}}>
                <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}>
                  <span style={{...ML}}>§ 02 / Volume</span>
                  <div style={{fontSize:15,fontWeight:700,color:C.ink,marginTop:4,letterSpacing:"-0.01em"}}>Wears across the period</div>
                </div>
                <div style={{padding:"14px 16px 16px"}}>
                  {(()=>{
                    const W=340,H=80,padB=4,padT=4;
                    const max=Math.max(...linePoints)||1;
                    const pts=linePoints.map((v,i)=>[(i/(linePoints.length-1))*W,padT+(H-padT-padB)-(v/max)*(H-padT-padB)]);
                    const d=pts.map((p,i)=>`${i===0?"M":"L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
                    return(<svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{display:"block",height:80}}>
                      <line x1={0} x2={W} y1={H-padB} y2={H-padB} stroke={C.border} strokeWidth="0.5"/>
                      <path d={d} stroke={C.sage} strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke"/>
                      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="2" fill={C.sage}/>
                    </svg>);
                  })()}
                </div>
              </div>
            )}

            {/* § 03 / PALETTE — colour distribution */}
            {pColorData.length>0&&(()=>{
              // Build SVG donut segments
              const total=pColorData.reduce((s,c)=>s+c.pct,0)||1;
              const cx=60,cy=60,r=48,inner=28,strokeW=r-inner;
              const rMid=(r+inner)/2;
              let cumAngle=-Math.PI/2;
              const segments=pColorData.map(c=>{
                const angle=(c.pct/total)*2*Math.PI;
                const x1=cx+rMid*Math.cos(cumAngle),y1=cy+rMid*Math.sin(cumAngle);
                cumAngle+=angle;
                const x2=cx+rMid*Math.cos(cumAngle),y2=cy+rMid*Math.sin(cumAngle);
                const large=angle>Math.PI?1:0;
                return {d:`M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rMid} ${rMid} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,hex:c.hex,name:c.name,stroke:strokeW};
              });
              return (
                <div style={{margin:"12px 16px 0",background:C.white,border:`1px solid ${C.border}`}}>
                  <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}>
                    <span style={{...ML}}>§ 03 / Palette</span>
                    <div style={{fontSize:15,fontWeight:700,color:C.ink,marginTop:4,letterSpacing:"-0.01em"}}>Color distribution</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",padding:"16px 16px",gap:16}}>
                    {/* Legend */}
                    <div style={{flex:1,display:"flex",flexDirection:"column",gap:0}}>
                      {pColorData.map((c,i)=>(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:i<pColorData.length-1?`1px solid ${C.border}`:"none"}}>
                          <div style={{width:12,height:12,flexShrink:0,background:c.hex,border:(c.hex==="#FFFFFF"||c.hex==="#F5F0E8")?`1px solid ${C.border}`:"none"}}/>
                          <span style={{flex:1,fontSize:12,color:C.ink}}>{c.name}</span>
                          <span style={{fontFamily:F.mono,fontSize:11,color:C.sub,minWidth:30,textAlign:"right"}}>{c.pct}%</span>
                        </div>
                      ))}
                    </div>
                    {/* Donut chart */}
                    <svg width={120} height={120} style={{flexShrink:0}}>
                      {segments.map((seg,i)=>(
                        <path key={i} d={seg.d} fill="none" stroke={seg.hex} strokeWidth={seg.stroke}
                          style={{filter:(seg.hex==="#FFFFFF"||seg.hex==="#F5F0E8")?"drop-shadow(0 0 0 1px #D8D7D0)":undefined}}/>
                      ))}
                    </svg>
                  </div>
                </div>
              );
            })()}

            {/* § 04 / TOP 5 — Most worn */}
            <div style={{margin:"12px 16px 0",background:C.white,border:`1px solid ${C.border}`}}>
              <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}>
                <span style={{...ML}}>§ 04 / Top 5</span>
                <div style={{fontSize:15,fontWeight:700,color:C.ink,marginTop:4,letterSpacing:"-0.01em"}}>Most-worn</div>
                <div style={{fontSize:11,color:C.sub,marginTop:2}}>Your heavy lifters</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"24px 1fr 36px 50px",gap:"0 8px",padding:"6px 14px",borderBottom:`1px solid ${C.border}`}}>
                {["N°","Garment","Wears","Share"].map((h,i)=><span key={i} style={{...ML,fontSize:8,textAlign:i>=2?"right":"left"}}>{h}</span>)}
              </div>
              {pMostWorn.map((item,i)=>{
                const sharePct=pTotalWears>0?((item.count/pTotalWears)*100).toFixed(2):0;
                const photo=item.photo||(itemLastInfo[item.name?.trim().toLowerCase()]?.itemPhoto)||(itemLastInfo[item.name?.trim().toLowerCase()]?.photo)||null;
                return(
                  <div key={i} style={{display:"grid",gridTemplateColumns:"24px 1fr 36px 50px",gap:"0 8px",padding:"10px 14px",borderBottom:i<pMostWorn.length-1?`1px solid ${C.border}`:"none",alignItems:"center"}}>
                    <span style={{fontFamily:F.mono,fontSize:10,color:C.sub}}>{String(i+1).padStart(2,"0")}</span>
                    <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                      <div style={{width:28,height:28,background:C.surface,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                        <ItemPhoto src={photo} category={item.category} style={{width:"100%",height:"100%",objectFit:"contain"}}/>
                      </div>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,color:C.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</div>
                        {item.brand&&<div style={{fontSize:10,color:C.sage}}>{item.brand}</div>}
                      </div>
                    </div>
                    <span style={{fontFamily:F.mono,fontSize:11,color:C.ink,textAlign:"right"}}>{item.count}×</span>
                    <div style={{textAlign:"right"}}>
                      <span style={{fontFamily:F.mono,fontSize:10,color:C.sage}}>{sharePct}%</span>
                      <div style={{height:1,background:C.border,marginTop:3,position:"relative"}}><div style={{position:"absolute",left:0,top:-0.5,height:2,width:`${(item.count/pMaxWears)*100}%`,background:C.sage}}/></div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* § 04 / BOTTOM 5 — Least worn */}
            <div style={{margin:"12px 16px 0",background:C.white,border:`1px solid ${C.border}`}}>
              <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}>
                <span style={{...ML}}>§ 04 / Bottom 5</span>
                <div style={{fontSize:15,fontWeight:700,color:C.ink,marginTop:4,letterSpacing:"-0.01em"}}>Least-worn</div>
                <div style={{fontSize:11,color:C.sub,marginTop:2}}>Waiting their turn</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"24px 1fr 36px 50px",gap:"0 8px",padding:"6px 14px",borderBottom:`1px solid ${C.border}`}}>
                {["N°","Garment","Wears","Share"].map((h,i)=><span key={i} style={{...ML,fontSize:8,textAlign:i>=2?"right":"left"}}>{h}</span>)}
              </div>
              {pLeastWorn.map((item,i)=>{
                const sharePct=pTotalWears>0?((item.count/pTotalWears)*100).toFixed(2):0;
                const photo=item.photo||(itemLastInfo[item.name?.trim().toLowerCase()]?.itemPhoto)||(itemLastInfo[item.name?.trim().toLowerCase()]?.photo)||null;
                return(
                  <div key={i} style={{display:"grid",gridTemplateColumns:"24px 1fr 36px 50px",gap:"0 8px",padding:"10px 14px",borderBottom:i<pLeastWorn.length-1?`1px solid ${C.border}`:"none",alignItems:"center"}}>
                    <span style={{fontFamily:F.mono,fontSize:10,color:C.sub}}>{String(pItemArr.length-pLeastWorn.length+i+1).padStart(2,"0")}</span>
                    <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                      <div style={{width:28,height:28,background:C.surface,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                        <ItemPhoto src={photo} category={item.category} style={{width:"100%",height:"100%",objectFit:"contain"}}/>
                      </div>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,color:C.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</div>
                        {item.brand&&<div style={{fontSize:10,color:C.sage}}>{item.brand}</div>}
                      </div>
                    </div>
                    <span style={{fontFamily:F.mono,fontSize:11,color:C.ink,textAlign:"right"}}>{item.count}×</span>
                    <div style={{textAlign:"right"}}>
                      <span style={{fontFamily:F.mono,fontSize:10,color:C.sub}}>{sharePct}%</span>
                      <div style={{height:1,background:C.border,marginTop:3,position:"relative"}}><div style={{position:"absolute",left:0,top:-0.5,height:2,width:`${(item.count/pMaxWears)*100}%`,background:C.border}}/></div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* § 05 / STYLE — style distribution */}
            {pStyleData.length>0&&(
              <div style={{margin:"12px 16px 32px",background:C.white,border:`1px solid ${C.border}`}}>
                <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
                  <div>
                    <span style={{...ML}}>§ 05 / Style</span>
                    <div style={{fontSize:15,fontWeight:700,color:C.ink,marginTop:4,letterSpacing:"-0.01em"}}>Style distribution</div>
                    <div style={{fontSize:11,color:C.sub,marginTop:2}}>Share of {pOutfitCount} logged outfits</div>
                  </div>
                  <span style={{...ML}}>{pStyleData.length} tags</span>
                </div>
                {pStyleData.map((s,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",padding:"10px 16px",borderBottom:i<pStyleData.length-1?`1px solid ${C.border}`:"none",gap:10}}>
                    <div style={{width:10,height:10,background:styleColors[s.name]||C.border,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,color:C.ink,marginBottom:4}}>{s.name}</div>
                      <div style={{height:1,background:C.border,position:"relative"}}><div style={{position:"absolute",left:0,top:-0.5,height:2,width:`${s.pct}%`,background:C.ink}}/></div>
                    </div>
                    <span style={{fontFamily:F.mono,fontSize:11,color:C.sub,minWidth:28,textAlign:"right"}}>{s.pct}%</span>
                  </div>
                ))}
                {/* Stacked ratio bar */}
                <div style={{padding:"12px 16px",borderTop:`1px solid ${C.border}`}}>
                  <span style={{...ML,display:"block",marginBottom:8}}>§ Ratio</span>
                  <div style={{height:12,display:"flex",overflow:"hidden",border:`1px solid ${C.border}`}}>
                    {pStyleData.map((s,i)=><div key={i} style={{flex:s.pct,background:styleColors[s.name]||C.border}}/>)}
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                    {["0%","50%","100%"].map(l=><span key={l} style={{fontFamily:F.mono,fontSize:8,color:C.sub}}>{l}</span>)}
                  </div>
                </div>
                {/* Italic insight */}
                {topStyle&&(
                  <div style={{padding:"10px 16px 16px",borderTop:`1px solid ${C.border}`}}>
                    <span style={{...ML,display:"block",marginBottom:8}}>§ Read</span>
                    <p style={{fontFamily:F.serif,fontStyle:"italic",fontSize:14,color:C.sage,margin:"0 0 14px",lineHeight:1.6}}>{topStyle.name} leads your wardrobe story{periodTab!=="all"?" this period":""}.</p>
                    <div style={{display:"flex",gap:24}}>
                      <div><div style={{fontSize:22,fontWeight:700,color:C.ink,fontFamily:F.mono,lineHeight:1}}>{topStyle.pct}%</div><span style={{...ML,marginTop:4,display:"block"}}>{topStyle.name}</span></div>
                      <div><div style={{fontSize:22,fontWeight:700,color:C.ink,fontFamily:F.mono,lineHeight:1}}>{pStyleData.length}</div><span style={{...ML,marginTop:4,display:"block"}}>Styles</span></div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
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

const CURRENCIES=[
  {code:"USD",symbol:"$",label:"US Dollar"},{code:"GBP",symbol:"£",label:"British Pound"},
  {code:"EUR",symbol:"€",label:"Euro"},{code:"AUD",symbol:"A$",label:"Australian Dollar"},
  {code:"CAD",symbol:"C$",label:"Canadian Dollar"},{code:"JPY",symbol:"¥",label:"Japanese Yen"},
  {code:"CHF",symbol:"Fr",label:"Swiss Franc"},{code:"CNY",symbol:"¥",label:"Chinese Yuan"},
  {code:"INR",symbol:"₹",label:"Indian Rupee"},{code:"SEK",symbol:"kr",label:"Swedish Krona"},
  {code:"NOK",symbol:"kr",label:"Norwegian Krone"},{code:"DKK",symbol:"kr",label:"Danish Krone"},
  {code:"NZD",symbol:"NZ$",label:"New Zealand Dollar"},{code:"SGD",symbol:"S$",label:"Singapore Dollar"},
  {code:"HKD",symbol:"HK$",label:"Hong Kong Dollar"},{code:"ZAR",symbol:"R",label:"South African Rand"},
  {code:"BRL",symbol:"R$",label:"Brazilian Real"},{code:"MXN",symbol:"$",label:"Mexican Peso"},
  {code:"KRW",symbol:"₩",label:"South Korean Won"},{code:"AED",symbol:"د.إ",label:"UAE Dirham"},
];
const getCurrencySymbol=()=>{ const code=localStorage.getItem("preferredCurrency")||"GBP"; return CURRENCIES.find(c=>c.code===code)?.symbol||"£"; };

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
  const [showReview,setShowReview]=useState(false);
  const [showDetail,setShowDetail]=useState(false);
  const [photoUploading,setPhotoUploading]=useState(false);
  const [calMonth,setCalMonth]=useState(()=>new Date().getMonth());
  const [calYear,setCalYear]=useState(()=>new Date().getFullYear());
  const [detailOutfitTab,setDetailOutfitTab]=useState(0); // 0=primary, 1=outfit2
  const uploadSlotRef=useRef("primary"); // "primary" | "outfit2"
  const calCameraRef=useRef(null);

  useEffect(()=>{
    if(!initialDate) return;
    const [y,m,d]=initialDate.split("-").map(Number);
    const nd=new Date(y,m-1,d);
    setSelectedDate(nd);
    const ik=`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    if(photoData[ik]?.logged){ setShowDetail(true); } else { setShowModal(true); }
    onClearInitialDate&&onClearInitialDate();
  },[initialDate]);
  const months=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const today=new Date();
  const toKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  // Build lookup of all previously logged items by name (latest entry wins for each field)
  const knownItems={};
  Object.values(photoData).forEach(e=>{ if(!e?.logged) return; [...(e.items||[]),...(e.outfit2?.items||[])].forEach(item=>{ if(!item||typeof item!=="object") return; const name=(item.name||"").trim().toLowerCase(); if(!name) return; if(!knownItems[name]) knownItems[name]={category:item.category||"Top",color:item.color||"Black",price:null,count:0}; knownItems[name].count+=1; if(item.category&&item.category!=="Other") knownItems[name].category=item.category; if(item.color) knownItems[name].color=item.color; const p=parseFloat(item.price); if(!isNaN(p)&&p>0) knownItems[name].price=String(p); }); });

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
      const slot=uploadSlotRef.current;
      if(slot==="outfit2"){
        setPhotoData(p=>({...p,[dateKey]:{...p[dateKey],outfit2:{photo:finalCompressed,items:[],style:null,analysing:true}}}));
      } else {
        setPhotoData(p=>({...p,[dateKey]:{ logged:true,photo:finalCompressed,items:[],style:null,analysing:true }}));
      }
      setShowReview(true); setShowModal(false);
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
          itemsWithPhotos.push({...itemData,itemPhoto:itemPhotoUrl||source});
        }
        if(slot==="outfit2"){
          setPhotoData(p=>{ if(!p[dateKey]) return p; return {...p,[dateKey]:{...p[dateKey],outfit2:{photo:finalPhoto,items:itemsWithPhotos,style,formalityLevel,season,colorPalette,analysing:false}}}; });
        } else {
          setPhotoData(p=>{ if(!p[dateKey]) return p; return {...p,[dateKey]:{logged:true,photo:finalPhoto,items:itemsWithPhotos,style,formalityLevel,season,colorPalette,analysing:false}}; });
        }
        setEditEntry({style,formalityLevel,season,items:itemsWithPhotos.map(item=>({...item}))});
        track("outfit_created", { date_key: dateKey, items_count: items.length, style, season });
        if(Object.keys(photoData).length===0) track("onboarding_completed", { items_count: items.length });
        supabase.auth.getSession().then(({data:{session}})=>{
          if(session) syncOutfit(session.user.id, dateKey, finalPhoto, style, season, itemsWithPhotos);
        });
        setToast(`Outfit analysed — ${items.length} item${items.length!==1?"s":""} found`);
        setTimeout(()=>setToast(null),3000);
      }else{
        if(slot==="outfit2"){
          setPhotoData(p=>{ if(!p[dateKey]) return p; return {...p,[dateKey]:{...p[dateKey],outfit2:{...p[dateKey].outfit2,photo:finalPhoto,analysing:false}}}; });
        } else {
          setPhotoData(p=>{ if(!p[dateKey]) return p; return {...p,[dateKey]:{...p[dateKey],photo:finalPhoto,analysing:false}}; });
        }
        setEditEntry({style:null,formalityLevel:null,season:null,items:[]});
        setToast("Analysis complete — review and add items manually");
        setTimeout(()=>setToast(null),3000);
      }
    };
    r.readAsDataURL(file);
  };

  const toRoman=(n)=>{
    const v=[1000,900,500,400,100,90,50,40,10,9,5,4,1],s=["M","CM","D","CD","C","XC","L","XL","X","IX","V","IV","I"];
    let r="";v.forEach((val,i)=>{while(n>=val){r+=s[i];n-=val;}});return r;
  };

  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const isCurMonth=calMonth===today.getMonth()&&calYear===today.getFullYear();
  const isPastMonth=calYear<today.getFullYear()||(calYear===today.getFullYear()&&calMonth<today.getMonth());
  const countUpTo=isPastMonth?daysInMonth:isCurMonth?today.getDate():0;
  let wornCount=0,restCount=0;
  for(let d=1;d<=countUpTo;d++){
    const k=`${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    if(photoData[k]?.logged) wornCount++; else restCount++;
  }
  const logPct=countUpTo>0?Math.round(wornCount/countUpTo*100):0;

  const prevMonth=()=>{ if(calMonth===0){ setCalMonth(11); setCalYear(y=>y-1); } else setCalMonth(m=>m-1); };
  const nextMonth=()=>{ if(calMonth===11){ setCalMonth(0); setCalYear(y=>y+1); } else setCalMonth(m=>m+1); };

  const renderMonth=(mIdx,yr)=>{
    const year=yr??today.getFullYear(),days=new Date(year,mIdx+1,0).getDate();
    const firstDay=new Date(year,mIdx,1).getDay(),offset=(firstDay+6)%7; // Monday-first
    const CELL={ borderTop:"none",borderLeft:"none",borderRight:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,cursor:"pointer",padding:"7px 7px 6px",display:"flex",flexDirection:"column",alignItems:"flex-start",justifyContent:"space-between",aspectRatio:"1",fontFamily:"inherit",minHeight:52 };
    const cells=[];
    for(let i=0;i<offset;i++) cells.push(<div key={`e${i}`} style={{ borderRight:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,aspectRatio:"1" }}/>);
    for(let d=1;d<=days;d++){
      const date=new Date(year,mIdx,d),key=toKey(date);
      const isToday=date.toDateString()===today.toDateString(),hasPhoto=!!(photoData[key]?.logged);
      cells.push(
        <button key={d} onClick={()=>{ setSelectedDate(date); setEditMode(false); setEditEntry(null); setSelectedItemIdxs(new Set()); if(photoData[key]?.logged){ setShowDetail(true); } else { setShowModal(true); } }}
          style={{ ...CELL,background:isToday?C.ink:"transparent" }}>
          <div>
            <div style={{ fontFamily:F.mono,fontSize:13,fontWeight:500,color:isToday?"#fff":C.ink,lineHeight:1 }}>{d}</div>
            {isToday&&<div style={{ fontFamily:F.mono,fontSize:7,fontWeight:500,letterSpacing:"0.1em",color:"rgba(255,255,255,0.6)",textTransform:"uppercase",marginTop:2 }}>TDY</div>}
          </div>
          {hasPhoto&&<div style={{ display:"flex",gap:2 }}><div style={{ width:6,height:6,background:isToday?"rgba(255,255,255,0.55)":C.ink,flexShrink:0 }}/>{photoData[key]?.outfit2&&<div style={{ width:6,height:6,background:isToday?"rgba(255,255,255,0.35)":C.sub,flexShrink:0 }}/>}</div>}
        </button>
      );
    }
    return cells;
  };

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface,position:"relative" }}>
      {toast&&<div style={{ position:"fixed",top:16,left:12,right:12,zIndex:99999,background:toast.startsWith("AI error")?"#E5635A":C.sage,color:"#fff",borderRadius:0,padding:"10px 14px",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:8,boxShadow:"0 4px 16px rgba(0,0,0,.18)" }}><Check size={15} color="#fff"/>{toast}</div>}

      {/* Section header row */}
      <div style={{ padding:"28px 24px 0",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0 }}>
        <span style={{ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub }}>§ 04 · Calendar</span>
        <div style={{ display:"flex",alignItems:"center",gap:4 }}>
          <button onClick={prevMonth} style={{ border:"none",background:"transparent",cursor:"pointer",padding:"4px 6px",fontFamily:F.mono,fontSize:13,color:C.sub,lineHeight:1 }}>{"<"}</button>
          <span style={{ fontFamily:F.mono,fontSize:12,color:C.sub,letterSpacing:"0.04em" }}>{months[calMonth]}</span>
          <button onClick={nextMonth} style={{ border:"none",background:"transparent",cursor:"pointer",padding:"4px 6px",fontFamily:F.mono,fontSize:13,color:C.sub,lineHeight:1 }}>{">"}</button>
        </div>
      </div>

      {/* Title + stats */}
      <div style={{ padding:"14px 24px 20px",flexShrink:0 }}>
        <h1 style={{ fontSize:38,fontWeight:800,color:C.ink,margin:0,letterSpacing:"-0.03em",lineHeight:1.05 }}>{months[calMonth]} {toRoman(calYear)}</h1>
        {countUpTo>0
          ? <p style={{ fontSize:13,color:C.sub,margin:"6px 0 0",fontWeight:400 }}>{wornCount} worn · {restCount} rest · {logPct}% logged</p>
          : <p style={{ fontSize:13,color:C.sub,margin:"6px 0 0",fontWeight:400 }}>No entries yet</p>
        }
      </div>

      <div style={{ flex:1,overflowY:"auto",display:"flex",flexDirection:"column" }}>
        {/* Day headers */}
        <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",borderTop:`1px solid ${C.border}`,borderLeft:`1px solid ${C.border}`,margin:"0 24px",flexShrink:0 }}>
          {["M","T","W","T","F","S","S"].map((d,i)=>(
            <div key={i} style={{ display:"flex",alignItems:"center",justifyContent:"center",fontFamily:F.mono,fontSize:10,fontWeight:500,color:C.sub,height:28,letterSpacing:"0.06em",borderRight:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}` }}>{d}</div>
          ))}
        </div>
        {/* Calendar grid */}
        <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",borderLeft:`1px solid ${C.border}`,margin:"0 24px 0",flexShrink:0 }}>
          {renderMonth(calMonth,calYear)}
        </div>
        {/* Fill remaining space with matching border */}
        <div style={{ flex:1,margin:"0 24px",borderLeft:`1px solid ${C.border}`,borderRight:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}` }}/>
      </div>
      {showCamera&&<CameraCapture onCapture={handleCameraCapture} onClose={()=>setShowCamera(false)}/>}
      {showReview&&selectedDate&&(
        <OutfitReview
          entry={uploadSlotRef.current==="outfit2"?photoData[toKey(selectedDate)]?.outfit2:photoData[toKey(selectedDate)]}
          editEntry={editEntry}
          selectedDate={selectedDate}
          onRetake={()=>{
            const dk=toKey(selectedDate);
            setPhotoData(p=>{ const n={...p}; delete n[dk]; return n; });
            setShowReview(false); setEditEntry(null); setEditMode(false);
            setShowModal(true); setTimeout(()=>setShowSourcePicker(true),50);
          }}
          onSave={()=>{ setShowReview(false); setEditEntry(null); setEditMode(false); }}
          onEdit={()=>{ setShowReview(false); setShowModal(true); setEditMode(true); }}
        />
      )}
      {showDetail&&selectedDate&&(()=>{
        const dk=toKey(selectedDate);
        const primaryEntry=photoData[dk];
        if(!primaryEntry?.logged) return null;
        const hasSecond=!!(primaryEntry.outfit2);
        const activeEntry=detailOutfitTab===1&&hasSecond?primaryEntry.outfit2:primaryEntry;
        const items=activeEntry.items||[];
        const REV_LABEL={ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub };
        const itemGroups=items.map(item=>{
          const rows=[];
          const catVal=[item.category,item.name?.toLowerCase()].filter(Boolean).join(' / ');
          if(catVal) rows.push({ label:"Category",value:catVal });
          if(item.color){ const cv=Array.isArray(item.color)?item.color.join(', '):item.color; if(cv) rows.push({ label:"Color",value:cv }); }
          if(item.brand) rows.push({ label:"Brand",value:item.brand });
          if(item.price) rows.push({ label:"Price",value:`${getCurrencySymbol()}${item.price}` });
          return rows;
        }).filter(g=>g.length>0);
        const outfitRows=[];
        if(activeEntry.style) outfitRows.push({ label:"Style",value:activeEntry.style });
        if(activeEntry.formalityLevel) outfitRows.push({ label:"Formality",value:activeEntry.formalityLevel });
        if(activeEntry.season) outfitRows.push({ label:"Season",value:activeEntry.season });
        if(activeEntry.notes) outfitRows.push({ label:"Notes",value:activeEntry.notes });
        const totalAttrs=itemGroups.reduce((s,g)=>s+g.length,0)+outfitRows.length;
        const multiItem=itemGroups.length>1;
        const AttrRow=({label,value,last})=>(
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 18px",borderBottom:last?"none":`1px solid ${C.border}` }}>
            <span style={{ fontSize:13,color:C.sub,fontWeight:400 }}>{label}</span>
            <span style={{ fontSize:13,color:C.ink,fontWeight:500,textAlign:"right",maxWidth:"55%" }}>{value}</span>
          </div>
        );
        const dateLabel=selectedDate.toLocaleDateString("en-GB",{ weekday:"long",day:"numeric",month:"long" });
        const handleDelete=()=>{
          if(detailOutfitTab===1){
            // Delete outfit 2 — just remove the outfit2 key
            setPhotoData(p=>{ const n={...p}; const e={...n[dk]}; delete e.outfit2; n[dk]=e; return n; });
            setDetailOutfitTab(0);
          } else if(hasSecond){
            // Delete outfit 1 but outfit 2 exists — promote outfit 2 to primary
            setPhotoData(p=>{ const n={...p}; const {outfit2,...rest}=n[dk]; n[dk]={...rest,...outfit2,logged:true,outfit2:undefined}; delete n[dk].outfit2; return n; });
            setDetailOutfitTab(0);
          } else {
            // Delete the only outfit — remove the whole day
            track("outfit_deleted",{date_key:dk});
            setPhotoData(p=>{ const n={...p}; delete n[dk]; return n; });
            setShowDetail(false);
          }
        };
        const handleEdit=()=>{
          uploadSlotRef.current=detailOutfitTab===1?"outfit2":"primary";
          setShowDetail(false);
          setEditEntry({ style:activeEntry.style||null,formalityLevel:activeEntry.formalityLevel||null,season:activeEntry.season||null,notes:activeEntry.notes||"",items:(activeEntry.items||[]).map(item=>typeof item==="object"&&item?{...item}:{name:String(item||""),category:"Other",color:null}) });
          setEditMode(true); setShowModal(true);
        };
        return (
          <div style={{ position:"fixed",inset:0,background:C.surface,zIndex:10000,display:"flex",flexDirection:"column" }}>
            <div style={{ padding:"28px 24px 0",flexShrink:0 }}>
              <span style={{ ...REV_LABEL }}>§ 04 · Calendar</span>
            </div>
            <div style={{ padding:"12px 24px 14px",flexShrink:0 }}>
              <h1 style={{ fontSize:28,fontWeight:800,color:C.ink,margin:0,letterSpacing:"-0.03em",lineHeight:1 }}>{dateLabel}</h1>
            </div>
            {/* Outfit tabs — shown when 2 outfits exist */}
            {hasSecond&&(
              <div style={{ display:"flex",margin:"0 24px",borderBottom:`1px solid ${C.border}`,flexShrink:0 }}>
                {["Outfit 1","Outfit 2"].map((label,i)=>(
                  <button key={i} onClick={()=>setDetailOutfitTab(i)} style={{ flex:1,height:36,border:"none",background:"transparent",fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer",color:detailOutfitTab===i?C.ink:C.sub,borderBottom:detailOutfitTab===i?`2px solid ${C.ink}`:"2px solid transparent",marginBottom:-1 }}>{label}</button>
                ))}
              </div>
            )}
            <div style={{ flexShrink:0,height:200,background:"#2A3628",margin:"8px 24px 0",position:"relative",overflow:"hidden" }}>
              {activeEntry.photo&&<img src={activeEntry.photo} alt="Outfit" style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }}/>}
              {!activeEntry.photo&&<div style={{ width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center" }}><span style={{ fontFamily:F.mono,fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(255,255,255,0.35)" }}>No photo</span></div>}
            </div>
            <div style={{ flex:1,overflowY:"auto",padding:"16px 24px 0" }}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
                <span style={{ ...REV_LABEL }}>Detected Attributes</span>
                <span style={{ ...REV_LABEL }}>{totalAttrs}/{totalAttrs}</span>
              </div>
              <div style={{ background:C.white,border:`1px solid ${C.border}` }}>
                {itemGroups.length>0||outfitRows.length>0 ? (
                  <>
                    {itemGroups.map((group,gIdx)=>{
                      const isLastGroup=gIdx===itemGroups.length-1;
                      return (
                        <div key={gIdx}>
                          {multiItem&&<div style={{ padding:"7px 18px",background:C.surface,borderBottom:`1px solid ${C.border}` }}><span style={{ fontFamily:F.mono,fontSize:9,fontWeight:500,letterSpacing:"0.12em",textTransform:"uppercase",color:C.sub }}>Item {gIdx+1}</span></div>}
                          {group.map((row,rIdx)=>(
                            <AttrRow key={rIdx} label={row.label} value={row.value} last={isLastGroup&&rIdx===group.length-1&&outfitRows.length===0}/>
                          ))}
                        </div>
                      );
                    })}
                    {outfitRows.map((row,i)=>(
                      <AttrRow key={i} label={row.label} value={row.value} last={i===outfitRows.length-1}/>
                    ))}
                  </>
                ) : (
                  <div style={{ padding:"20px 18px",textAlign:"center" }}><span style={{ fontSize:13,color:C.sub }}>No attributes — tap Edit to add details</span></div>
                )}
              </div>
              {/* Add second outfit button — only shown on primary tab when no outfit2 yet */}
              {!hasSecond&&detailOutfitTab===0&&(
                <button onClick={()=>{ uploadSlotRef.current="outfit2"; setShowDetail(false); setEditMode(false); setEditEntry(null); setShowModal(true); setTimeout(()=>setShowSourcePicker(true),50); }} style={{ width:"100%",marginTop:12,height:44,border:`1px solid ${C.border}`,background:C.white,fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.1em",textTransform:"uppercase",color:C.sub,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
                  <Plus size={13} color={C.sub}/> Add second outfit
                </button>
              )}
            </div>
            <div style={{ padding:"12px 24px 44px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0 }}>
              <button onClick={handleDelete} style={{ fontFamily:F.mono,fontSize:11,fontWeight:500,letterSpacing:"0.1em",textTransform:"uppercase",color:C.red,border:"none",background:"transparent",cursor:"pointer",padding:"8px 0",minWidth:64 }}>Delete</button>
              <button onClick={handleEdit} style={{ height:52,padding:"0 36px",background:C.ink,color:"#fff",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:15,fontWeight:700 }}>Edit</button>
              <button onClick={()=>{ setShowDetail(false); setDetailOutfitTab(0); }} style={{ fontFamily:F.mono,fontSize:11,fontWeight:500,letterSpacing:"0.1em",textTransform:"uppercase",color:C.sub,border:"none",background:"transparent",cursor:"pointer",padding:"8px 0",minWidth:64,textAlign:"right" }}>Close</button>
            </div>
          </div>
        );
      })()}
      <Modal isOpen={showModal&&!!selectedDate} onClose={()=>{ setShowModal(false); setShowSourcePicker(false); setEditMode(false); setEditEntry(null); setSelectedItemIdxs(new Set()); uploadSlotRef.current="primary"; }} title={selectedDate?selectedDate.toLocaleDateString("en-US",{ weekday:"long",month:"long",day:"numeric" }):""}>
        {selectedDate&&(()=>{
          const entry=photoData[toKey(selectedDate)];
          // Adding second outfit — bypass the existing-outfit view, go straight to upload
          if(entry?.logged&&uploadSlotRef.current==="outfit2"&&!editMode){
            return (<>
              <div style={{ background:C.surface,borderRadius:0,padding:20,textAlign:"center",marginBottom:16 }}><Camera size={32} color={C.sub}/><div style={{ fontSize:14,color:C.sub,marginTop:8 }}>Add a second outfit for this day</div></div>
              <PrimaryBtn onClick={()=>{ if(!photoUploading) setShowSourcePicker(true); }}>{photoUploading?"Processing…":<><Camera size={16}/> Upload Outfit 2 Photo</>}</PrimaryBtn>
              {showSourcePicker&&<div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",flexDirection:"column",justifyContent:"flex-end" }} onClick={()=>setShowSourcePicker(false)}>
                <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:0,padding:"8px 16px 40px" }}>
                  <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
                  <p style={{ fontSize:13,fontWeight:700,color:C.sub,textAlign:"center",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:16 }}>Outfit 2 Photo</p>
                  {cameraEnabled
                    ? <button onClick={()=>{ setShowSourcePicker(false); setShowCamera(true); }} style={{ width:"100%",height:56,borderRadius:0,border:"none",background:C.sage+"14",display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:10,cursor:"pointer",fontFamily:"inherit" }}><Camera size={20} color={C.sage}/><span style={{ fontSize:16,fontWeight:700,color:C.sage }}>Camera</span></button>
                    : <div style={{ width:"100%",height:48,borderRadius:0,background:C.border,display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10,opacity:.5 }}><Camera size={18} color={C.sub}/><span style={{ fontSize:14,fontWeight:600,color:C.sub }}>Camera (enable in Privacy)</span></div>
                  }
                  <label style={{ display:"block",cursor:"pointer" }}><input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>handlePhotoUpload(e.target.files[0])}/><div style={{ width:"100%",height:56,borderRadius:0,background:C.surface,border:`1.5px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:10 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span style={{ fontSize:16,fontWeight:700,color:C.ink }}>Camera Roll</span></div></label>
                </div>
              </div>}
            </>);
          }
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
              const saveEdit=()=>{ const cleanItems=editEntry.items.map(({_isNew,_recognized,_wearCount,_showColorPicker,...rest})=>rest); const dk=toKey(selectedDate); if(uploadSlotRef.current==="outfit2"){ setPhotoData(p=>({...p,[dk]:{...p[dk],outfit2:{...p[dk].outfit2,style:editEntry.style,formalityLevel:editEntry.formalityLevel,season:editEntry.season,notes:editEntry.notes||"",items:cleanItems}}})); } else { setPhotoData(p=>({...p,[dk]:{...p[dk],style:editEntry.style,formalityLevel:editEntry.formalityLevel,season:editEntry.season,notes:editEntry.notes||"",items:cleanItems}})); } setEditMode(false); setEditEntry(null); };
              return (<>
                <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,marginBottom:10 }}>Style</p>
                <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:16 }}>
                  {STYLES.map(s=><button key={s} onClick={()=>setEditEntry(e=>({...e,style:s}))} style={{ padding:"6px 14px",borderRadius:0,border:editEntry.style===s?"none":`1.5px solid ${C.border}`,background:editEntry.style===s?C.sage:C.white,color:editEntry.style===s?"#fff":C.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{s}</button>)}
                </div>
                <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,marginBottom:10 }}>Formality</p>
                <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:16 }}>
                  {FORMALITY.map(f=><button key={f} onClick={()=>setEditEntry(e=>({...e,formalityLevel:f}))} style={{ padding:"6px 14px",borderRadius:0,border:editEntry.formalityLevel===f?"none":`1.5px solid ${C.border}`,background:editEntry.formalityLevel===f?"#5E6A5C":C.white,color:editEntry.formalityLevel===f?"#fff":C.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{f}</button>)}
                </div>
                <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,marginBottom:10 }}>Season</p>
                <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:20 }}>
                  {SEASONS.map(s=><button key={s} onClick={()=>setEditEntry(e=>({...e,season:s}))} style={{ padding:"6px 14px",borderRadius:0,border:editEntry.season===s?"none":`1.5px solid ${C.border}`,background:editEntry.season===s?"#5E6A5C":C.white,color:editEntry.season===s?"#fff":C.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{s}</button>)}
                </div>
                <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,marginBottom:10 }}>Items</p>
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
                        <span style={{ padding:"0 8px",fontSize:13,color:C.sub,borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center" }}>{getCurrencySymbol()}</span>
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
                <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,marginBottom:8 }}>Notes</p>
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
              {entry.notes&&<div style={{ background:C.surface,borderRadius:0,padding:"10px 14px",border:`1px solid ${C.border}`,marginBottom:14 }}><p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,margin:"0 0 4px" }}>Notes</p><p style={{ fontSize:13,color:C.ink,margin:0,lineHeight:1.5 }}>{entry.notes}</p></div>}
              <div style={{ marginBottom:16 }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
                  <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,margin:0 }}>What I wore</p>
                  {selectedItemIdxs.size>0&&<button onClick={removeSelected} style={{ fontSize:12,fontWeight:700,color:C.red,background:"#FEF0EF",border:"none",borderRadius:0,padding:"4px 12px",cursor:"pointer",fontFamily:"inherit" }}>Remove {selectedItemIdxs.size} selected</button>}
                </div>
                {entry.analysing?(<div style={{background:C.surface,borderRadius:0,padding:20,display:"flex",flexDirection:"column",alignItems:"center",gap:10,border:`1px solid ${C.border}`}}><div style={{width:24,height:24,borderRadius:"50%",border:`2.5px solid ${C.sage}`,borderTopColor:"transparent",animation:"spin .7s linear infinite"}}/><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style><span style={{fontSize:13,color:C.sub,fontWeight:600}}>Analysing outfit with AI…</span></div>):cats.length>0?<div style={{ display:"flex",flexDirection:"column",gap:12 }}>{cats.map(cat=>(<div key={cat}><div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:6 }}><CatIcon cat={cat} size={13} color={C.sub}/><span style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono }}>{cat}</span></div>{grouped[cat].map((item,i)=>{ const hex=item.color&&colorHex[item.color]?colorHex[item.color]:null; const isSel=selectedItemIdxs.has(item._idx); const isFav=favourites.some(f=>(f.name||"").trim().toLowerCase()===(item.name||"").trim().toLowerCase()); const wearCount=knownItems[(item.name||"").trim().toLowerCase()]?.count;
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
  const removeFav=(name)=>setFavourites(prev=>prev.filter(f=>(f.name||"").trim().toLowerCase()!==(name||"").trim().toLowerCase()));
  const [selectedFav,setSelectedFav]=useState(null);

  // Build wear count + last photo for each favourite from photoData
  const allLoggedEntries=Object.entries(photoData).filter(([,e])=>e?.logged).sort(([a],[b])=>b.localeCompare(a));
  const getFavMeta=(favName)=>{
    const k=(favName||"").trim().toLowerCase();
    let photo=null; let wears=0;
    allLoggedEntries.forEach(([,entry])=>{
      (entry.items||[]).forEach(item=>{
        if(!item||typeof item!=="object") return;
        if((item.name||"").trim().toLowerCase()===k){
          wears++;
          if(!photo) photo=item.itemPhoto||null;
        }
      });
    });
    return { photo, wears };
  };

  const GarmentShape=({ category })=>{
    const col="#3A4A38";
    const shapes={
      "Top":      <path d="M20 20 L35 12 L45 18 L65 18 L75 12 L90 20 L95 45 L85 48 L85 95 L25 95 L25 48 L15 45 Z" fill={col}/>,
      "Bottom":   <path d="M30 15 L80 15 L82 50 L78 95 L60 95 L55 55 L50 95 L32 95 L28 50 Z" fill={col}/>,
      "Dresses":  <path d="M35 15 L45 10 L65 10 L75 15 L72 30 L85 95 L25 95 L38 30 Z" fill={col}/>,
      "Outerwear":<path d="M18 22 L35 12 L45 16 L55 14 L65 16 L75 12 L92 22 L90 95 L68 95 L55 55 L42 95 L20 95 Z" fill={col}/>,
      "Shoes":    <path d="M12 60 L35 55 L55 52 L80 55 L92 62 L92 72 L15 72 Z" fill={col}/>,
      "Accessories":<g><path d="M32 25 Q55 10 78 25" stroke={col} strokeWidth="3" fill="none"/><path d="M25 30 L85 30 L80 90 L30 90 Z" fill={col}/></g>,
      "Swimwear": <path d="M35 15 L75 15 L78 28 L90 95 L20 95 L32 28 Z" fill={col}/>,
    };
    return (
      <svg viewBox="0 0 110 110" width="60%" height="60%" style={{ display:"block" }}>
        {shapes[category]||shapes["Top"]}
      </svg>
    );
  };

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
      {/* Header */}
      <div style={{ padding:"28px 24px 0",flexShrink:0 }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
          {onBack
            ? <button onClick={onBack} style={{ border:"none",background:"transparent",cursor:"pointer",padding:0,display:"flex",alignItems:"center",gap:4 }}><span style={{ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub }}>§ 03 · Favourites</span></button>
            : <span style={{ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub }}>§ 03 · Favourites</span>
          }
          <span style={{ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub }}>{favourites.length} Items</span>
        </div>
        <h1 style={{ fontSize:34,fontWeight:800,color:C.ink,margin:"0 0 16px",letterSpacing:"-0.03em",lineHeight:1 }}>Your favourites</h1>
      </div>

      {/* Divider */}
      <div style={{ height:1,background:C.border,flexShrink:0,margin:"0 0 0 0" }}/>

      {/* Grid */}
      <div style={{ flex:1,overflowY:"auto",padding:"12px 12px 32px" }}>
        {favourites.length===0 ? (
          <div style={{ textAlign:"center",padding:"64px 24px" }}>
            <Heart size={36} color={C.sub} strokeWidth={1} style={{ margin:"0 auto 16px",display:"block" }}/>
            <div style={{ fontSize:16,fontWeight:700,color:C.ink,marginBottom:6 }}>No favourites yet</div>
            <div style={{ fontSize:13,color:C.sub,lineHeight:1.5 }}>Tap the heart on any item in your outfit log to save it here.</div>
          </div>
        ) : (
          <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8 }}>
            {favourites.map((fav,idx)=>{
              const { photo, wears }=getFavMeta(fav.name);
              return (
                <button key={idx} onClick={()=>setSelectedFav({...fav,_idx:idx+1,_photo:photo,_wears:wears})} style={{ background:C.white,border:`1px solid ${C.border}`,cursor:"pointer",textAlign:"left",fontFamily:"inherit",padding:0,display:"flex",flexDirection:"column",overflow:"hidden" }}>
                  <div style={{ width:"100%",aspectRatio:"1/1",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",flexShrink:0 }}>
                    {photo
                      ? <img src={photo} alt={fav.name} style={{ width:"100%",height:"100%",objectFit:"contain",display:"block" }}/>
                      : <GarmentShape category={fav.category}/>
                    }
                  </div>
                  <div style={{ padding:"8px 10px 10px",flex:1 }}>
                    <div style={{ display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:3 }}>
                      <span style={{ fontFamily:F.mono,fontSize:9,color:C.sub,letterSpacing:"0.06em" }}>{String(idx+1).padStart(2,"0")}</span>
                      <span style={{ fontFamily:F.mono,fontSize:9,color:C.sub,letterSpacing:"0.04em" }}>{wears}×</span>
                    </div>
                    <div style={{ fontSize:12,fontWeight:600,color:C.ink,lineHeight:1.3,marginBottom:2,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical" }}>{fav.name}</div>
                    <div style={{ fontSize:11,color:C.sub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{fav.brand||fav.category||""}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Item detail overlay */}
      {selectedFav&&(()=>{
        const sf=selectedFav;
        const wornDates=allLoggedEntries.filter(([,e])=>(e.items||[]).some(i=>(i.name||"").trim().toLowerCase()===(sf.name||"").trim().toLowerCase())).map(([k])=>k);
        const lastWorn=(()=>{ if(!wornDates.length) return null; const [y,m,d]=wornDates[0].split("-").map(Number); const diff=Math.round((new Date()-new Date(y,m-1,d))/(1000*60*60*24)); return diff; })();
        return (
          <div style={{ position:"fixed",inset:0,background:C.surface,zIndex:9999,display:"flex",flexDirection:"column",overflowY:"auto" }}>
            <div style={{ padding:"20px 20px 0",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0 }}>
              <span style={{ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub }}>Favourites · N°{String(sf._idx).padStart(2,"0")}</span>
              <button onClick={()=>setSelectedFav(null)} style={{ border:"none",background:"transparent",cursor:"pointer",padding:4 }}><X size={20} color={C.sub}/></button>
            </div>
            <div style={{ padding:"12px 20px 20px",borderBottom:`1px solid ${C.border}` }}>
              <h2 style={{ fontSize:26,fontWeight:800,color:C.ink,margin:"0 0 4px",letterSpacing:"-0.02em",lineHeight:1.1 }}>{sf.name}</h2>
              <span style={{ fontFamily:F.mono,fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",color:C.sub }}>{sf.category}</span>
            </div>
            {/* Image */}
            <div style={{ width:"100%",height:220,background:C.white,display:"flex",alignItems:"center",justifyContent:"center",borderBottom:`1px solid ${C.border}`,flexShrink:0 }}>
              {sf._photo
                ? <img src={sf._photo} alt={sf.name} style={{ height:"100%",width:"100%",objectFit:"contain" }}/>
                : <GarmentShape category={sf.category}/>
              }
            </div>
            {/* Stats */}
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",borderBottom:`1px solid ${C.border}`,flexShrink:0 }}>
              {[{l:"Worn",v:`${sf._wears}×`},{l:"Last worn",v:lastWorn!=null?`${lastWorn}d ago`:"—"}].map(({l,v},i)=>(
                <div key={i} style={{ padding:"14px 16px",borderRight:i===0?`1px solid ${C.border}`:"none" }}>
                  <div style={{ fontFamily:F.mono,fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:C.sub,marginBottom:4 }}>{l}</div>
                  <div style={{ fontSize:18,fontWeight:700,color:C.ink }}>{v}</div>
                </div>
              ))}
            </div>
            {/* Attributes */}
            {[{label:"Category",value:sf.category},{label:"Brand",value:sf.brand||"—"},{label:"Price",value:sf.price?`${getCurrencySymbol()}${sf.price}`:"—"},{label:"Colour",value:sf.color||(Array.isArray(sf.color)?sf.color.join(", "):"—")}].map(({label,value},i,arr)=>(
              <div key={i} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 20px",borderBottom:i<arr.length-1?`1px solid ${C.border}`:"none",background:C.white }}>
                <span style={{ fontSize:12,color:C.sub }}>{label}</span>
                <span style={{ fontSize:12,color:C.ink,fontWeight:500 }}>{value||"—"}</span>
              </div>
            ))}
            {/* Remove button */}
            <div style={{ padding:"20px 20px 40px",marginTop:"auto" }}>
              <button onClick={()=>{ removeFav(sf.name); setSelectedFav(null); }} style={{ width:"100%",height:48,background:"transparent",border:`1px solid ${C.border}`,color:C.sub,fontSize:12,fontWeight:600,fontFamily:F.mono,letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
                <Heart size={14} color={C.sub}/> Remove from favourites
              </button>
            </div>
          </div>
        );
      })()}
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

  const inputStyle = { width:"100%",height:52,padding:"0 16px",borderRadius:0,border:`1.5px solid ${C.border}`,background:C.offwhite,fontSize:15,color:C.ink,outline:"none",boxSizing:"border-box",fontFamily:"inherit" };
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
    const { data: profile } = await supabase.from("users").select("photo_data,favourites,username").eq("id", data.user.id).maybeSingle();
    if (!profile) {
      // First sign-in after email confirmation — create profile using username stored in metadata
      const uname = data.user.user_metadata?.username || "";
      await supabase.from("users").insert({ id: data.user.id, email: data.user.email, photo_data:{}, favourites:[], username: uname });
      setLoading(false);
      onAuth(data.user.email, {}, [], data.user.id, uname);
      return;
    }
    setLoading(false);
    await track("user_signed_in");
    onAuth(data.user.email, profile?.photo_data||{}, profile?.favourites||[], data.user.id, profile?.username||data.user.user_metadata?.username||"");
  };

  const handleSignUp = async () => {
    setError("");
    if (!username || !email || !password || !confirmPassword) { setError("Please fill in all fields."); return; }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) { setError("Username must be 3–20 characters and contain only lowercase letters, numbers, and underscores."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    const { data: taken } = await supabase.from("users").select("id").eq("username", username).maybeSingle();
    if (taken) { setLoading(false); setError("That username is already taken. Please choose another."); return; }
    const { data, error: authError } = await supabase.auth.signUp({ email, password, options:{ emailRedirectTo: window.location.origin, data:{ username } } });
    if (authError) { setLoading(false); setError(friendlyAuthError(authError.message)); return; }
    if (!data.session) { setLoading(false); setView("confirm-email"); return; }
    await supabase.from("users").insert({ id: data.user.id, email: data.user.email, photo_data:{}, favourites:[], username });
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

      <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,margin:"0 0 8px" }}>Username</p>
      <div style={{ position:"relative" }}>
        <span style={{ position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",fontSize:15,color:C.sub,fontWeight:600,pointerEvents:"none",userSelect:"none" }}>@</span>
        <input value={username} onChange={e=>setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,""))} placeholder="yourname" maxLength={20} style={{...inputStyle,paddingLeft:32}} onFocus={focusStyle} onBlur={blurStyle}/>
      </div>
      <p style={{ fontSize:11,color:C.sub,margin:"6px 0 0",lineHeight:1.5 }}>3–20 characters · letters, numbers, underscores · cannot be changed later</p>

      <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,margin:"18px 0 8px" }}>Email Address</p>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle}/>

      <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,margin:"18px 0 8px" }}>Password</p>
      <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle}/>

      <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,margin:"18px 0 8px" }}>Confirm Password</p>
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

      <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,margin:"0 0 8px" }}>Email Address</p>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle}/>

      <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,margin:"18px 0 8px" }}>Password</p>
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
        <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,margin:"0 0 8px" }}>Email Address</p>
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

function ProfileScreen({ onSettings, onNotifications, onPrivacy, onBack, onSignOut, userEmail="", username="", photoData={}, favourites=[], memberSince="" }) {
  const [profileImage, setProfileImage] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [showUnitsPicker, setShowUnitsPicker] = useState(false);
  const [currency, setCurrency] = useState(()=>localStorage.getItem("preferredCurrency")||"USD");
  const [tempUnit, setTempUnit] = useState(()=>localStorage.getItem("preferredTempUnit")||"F");
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);

  const selectCurrency = (code) => {
    setCurrency(code);
    localStorage.setItem("preferredCurrency", code);
  };
  const selectTempUnit = (unit) => {
    setTempUnit(unit);
    localStorage.setItem("preferredTempUnit", unit);
  };

  const handleImageFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setProfileImage(e.target.result);
    reader.readAsDataURL(file);
    setShowPicker(false);
  };

  // Stats from photoData
  const loggedEntries = Object.values(photoData).filter(d => d?.logged && d?.items?.length);
  const totalOutfits = loggedEntries.length;
  const allItems = loggedEntries.flatMap(e => e.items || []);
  const uniqueNames = new Set(allItems.map(i => i.name?.trim().toLowerCase()).filter(Boolean));
  const totalGarments = uniqueNames.size;
  const itemMap = {};
  allItems.forEach(item => {
    const key = item.name?.trim().toLowerCase();
    if (!key) return;
    if (!itemMap[key]) itemMap[key] = { price: parseFloat(item.price)||0, wears: 0 };
    itemMap[key].wears++;
  });
  const cpwItems = Object.values(itemMap).filter(s => s.wears > 0 && s.price > 0);
  const avgCPW = cpwItems.length ? (cpwItems.reduce((s, i) => s + i.price / i.wears, 0) / cpwItems.length).toFixed(2) : null;

  // Display name
  const displayName = username || userEmail.split("@")[0] || "Style enthusiast";

  // Notifications status
  const reminderEnabled = localStorage.getItem("dailyReminderEnabled") !== "false";

  const LABEL = { fontFamily:F.mono, fontSize:9, fontWeight:500, letterSpacing:"0.14em", textTransform:"uppercase", color:C.sub };
  const ROW_BTN = { width:"100%", padding:"16px 18px", border:"none", background:"transparent", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", fontFamily:"inherit", textAlign:"left", boxSizing:"border-box" };
  const ROW_VAL = { display:"flex", alignItems:"center", gap:6 };

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
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
            <button onClick={()=>setShowSignOutConfirm(false)} style={{ width:"100%",height:54,border:`1px solid ${C.border}`,background:"transparent",color:C.ink,fontSize:16,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
          </div>
        </div>
      )}

      {showUnitsPicker && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"flex-end" }} onClick={()=>setShowUnitsPicker(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.white,width:"100%",maxHeight:"72vh",display:"flex",flexDirection:"column",animation:"slideUp .28s cubic-bezier(.32,.72,0,1)" }}>
            <div style={{ padding:"12px 24px 0",flexShrink:0 }}>
              <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"0 auto 16px" }}/>
              {/* Temperature */}
              <div style={{ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub,marginBottom:10 }}>Temperature</div>
              <div style={{ display:"flex",gap:8,marginBottom:20 }}>
                {[{unit:"F",label:"°F  Fahrenheit"},{unit:"C",label:"°C  Celsius"}].map(({unit,label})=>(
                  <button key={unit} onClick={()=>selectTempUnit(unit)} style={{ flex:1,height:48,border:`1.5px solid ${tempUnit===unit?C.sage:C.border}`,background:tempUnit===unit?C.sage:"transparent",color:tempUnit===unit?"#fff":C.ink,fontFamily:F.mono,fontSize:13,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
                    {tempUnit===unit&&<Check size={13} color="#fff" strokeWidth={2.5}/>}{label}
                  </button>
                ))}
              </div>
              {/* Currency */}
              <div style={{ fontFamily:F.mono,fontSize:10,fontWeight:500,letterSpacing:"0.14em",textTransform:"uppercase",color:C.sub,marginBottom:0 }}>Currency</div>
            </div>
            <div style={{ overflowY:"auto",flex:1,paddingBottom:44 }}>
              {CURRENCIES.map(c=>(
                <button key={c.code} onClick={()=>selectCurrency(c.code)} style={{ width:"100%",padding:"14px 24px",border:"none",borderBottom:`1px solid ${C.border}`,background:"transparent",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",fontFamily:"inherit" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                    <span style={{ fontFamily:F.mono,fontSize:14,fontWeight:500,color:C.ink,minWidth:36 }}>{c.symbol}</span>
                    <div>
                      <div style={{ fontSize:14,fontWeight:500,color:C.ink }}>{c.label}</div>
                      <div style={{ fontFamily:F.mono,fontSize:10,color:C.sub,letterSpacing:"0.06em",marginTop:1 }}>{c.code}</div>
                    </div>
                  </div>
                  {currency===c.code && <Check size={16} color={C.sage} strokeWidth={2}/>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showPicker && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"flex-end" }} onClick={()=>setShowPicker(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",width:"100%",padding:"8px 24px 44px" }}>
            <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
            <h2 style={{ fontSize:20,fontWeight:800,color:C.ink,margin:"0 0 20px",letterSpacing:"-0.02em" }}>Change Profile Photo</h2>
            <button onClick={()=>{ setShowPicker(false); setTimeout(()=>galleryRef.current?.click(),100); }} style={{ width:"100%",height:54,border:`1px solid ${C.border}`,background:"transparent",color:C.ink,fontSize:15,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:14,padding:"0 18px",fontFamily:"inherit",marginBottom:10 }}><Camera size={18} color={C.ink}/>Camera Roll</button>
            <button onClick={()=>{ setShowPicker(false); setTimeout(()=>cameraRef.current?.click(),100); }} style={{ width:"100%",height:54,border:`1px solid ${C.border}`,background:"transparent",color:C.ink,fontSize:15,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:14,padding:"0 18px",fontFamily:"inherit",marginBottom:10 }}><Camera size={18} color={C.ink}/>Camera</button>
            <button onClick={()=>setShowPicker(false)} style={{ width:"100%",height:48,border:"none",background:C.surface,color:C.sub,fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ flex:1,overflowY:"auto" }}>
        {/* Section label + Edit */}
        <div style={{ padding:"28px 24px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0 }}>
          <span style={{ ...LABEL }}>§ 05 · Profile</span>
          <button onClick={()=>setShowPicker(true)} style={{ ...LABEL, border:"none", background:"transparent", cursor:"pointer", padding:0, color:C.sage }}>Edit</button>
        </div>

        {/* Avatar + name block */}
        <div style={{ padding:"0 24px 24px",display:"flex",alignItems:"center",gap:20 }}>
          <button onClick={()=>setShowPicker(true)} style={{ width:88,height:88,borderRadius:0,background:C.sage,border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",padding:0,overflow:"hidden",flexShrink:0 }}>
            {profileImage
              ? <img src={profileImage} alt="Profile" style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }}/>
              : <span style={{ fontFamily:F.sans,fontSize:30,fontWeight:600,color:"#fff",lineHeight:1 }}>{displayName.charAt(0).toUpperCase()}</span>
            }
          </button>
          <div>
            <div style={{ fontSize:22,fontWeight:700,color:C.ink,letterSpacing:"-0.02em",lineHeight:1.1,marginBottom:6 }}>{displayName}</div>
            {memberSince && <div style={{ ...LABEL }}>Member Since {memberSince}</div>}
          </div>
        </div>

        {/* Hairline divider */}
        <div style={{ height:1,background:C.border,margin:"0 24px" }}/>

        {/* Stats row */}
        <div style={{ display:"flex",padding:"20px 24px",gap:0 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:F.mono,fontSize:34,fontWeight:500,color:C.ink,letterSpacing:"-0.03em",lineHeight:1 }}>{totalGarments}</div>
            <div style={{ ...LABEL,marginTop:6 }}>Garments</div>
          </div>
          <div style={{ width:1,background:C.border,flexShrink:0,margin:"4px 0" }}/>
          <div style={{ flex:1,paddingLeft:20 }}>
            <div style={{ fontFamily:F.mono,fontSize:34,fontWeight:500,color:C.ink,letterSpacing:"-0.03em",lineHeight:1 }}>{totalOutfits}</div>
            <div style={{ ...LABEL,marginTop:6 }}>Outfits</div>
          </div>
          <div style={{ width:1,background:C.border,flexShrink:0,margin:"4px 0" }}/>
          <div style={{ flex:1,paddingLeft:20 }}>
            <div style={{ fontFamily:F.mono,fontSize:34,fontWeight:500,color:C.ink,letterSpacing:"-0.03em",lineHeight:1 }}>{avgCPW?`$${avgCPW}`:"—"}</div>
            <div style={{ ...LABEL,marginTop:6 }}>CPW</div>
          </div>
        </div>

        {/* Hairline divider */}
        <div style={{ height:1,background:C.border }}/>

        {/* Settings card */}
        <div style={{ padding:"20px 24px 0" }}>
          <div style={{ background:C.white,border:`1px solid ${C.border}` }}>
            {/* Appearance */}
            <div style={{ padding:"16px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:15,color:C.ink,fontWeight:500 }}>Appearance</span>
              <div style={ROW_VAL}>
                <span style={{ fontFamily:F.mono,fontSize:12,color:C.sub }}>Light</span>
                <span style={{ fontFamily:F.mono,fontSize:13,color:C.sub,letterSpacing:"-0.02em" }}>⇄</span>
              </div>
            </div>
            {/* Units */}
            <button onClick={()=>setShowUnitsPicker(true)} style={{ ...ROW_BTN,borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:15,color:C.ink,fontWeight:500 }}>Units</span>
              <div style={ROW_VAL}>
                <span style={{ fontFamily:F.mono,fontSize:12,color:C.sub }}>°{tempUnit} · {currency}</span>
                <ChevronRight size={15} color={C.sub} strokeWidth={1.5}/>
              </div>
            </button>
            {/* Notifications */}
            <button onClick={onNotifications} style={{ ...ROW_BTN,borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:15,color:C.ink,fontWeight:500 }}>Notifications</span>
              <div style={ROW_VAL}>
                <span style={{ fontFamily:F.mono,fontSize:12,color:C.sub }}>{reminderEnabled?"Daily":"Off"}</span>
                <ChevronRight size={15} color={C.sub} strokeWidth={1.5}/>
              </div>
            </button>
            {/* Privacy */}
            <button onClick={onPrivacy} style={{ ...ROW_BTN,borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:15,color:C.ink,fontWeight:500 }}>Privacy</span>
              <div style={ROW_VAL}>
                <ChevronRight size={15} color={C.sub} strokeWidth={1.5}/>
              </div>
            </button>
            {/* Account */}
            <button onClick={onSettings} style={{ ...ROW_BTN }}>
              <span style={{ fontSize:15,color:C.ink,fontWeight:500 }}>Account</span>
              <div style={ROW_VAL}>
                <ChevronRight size={15} color={C.sub} strokeWidth={1.5}/>
              </div>
            </button>
          </div>
        </div>

        {/* Sign out */}
        <div style={{ padding:"12px 24px 40px" }}>
          <button onClick={()=>setShowSignOutConfirm(true)} style={{ width:"100%",padding:"16px 18px",border:`1px solid ${C.border}`,background:"transparent",color:C.red,fontSize:15,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"inherit" }}>
            <LogOut size={16} color={C.red} strokeWidth={1.5}/>Sign Out
          </button>
        </div>
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
  const labelStyle={fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,display:"block",marginBottom:6};

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
  const [reminderOn,setReminderOn]=useState(()=>localStorage.getItem("dailyReminderEnabled")!=="false");

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
        <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,margin:"0 0 10px" }}>Push Notifications</p>
        <div style={{ background:C.white,borderRadius:0,border:`1px solid ${C.border}`,overflow:"hidden" }}>
          <div style={{ padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${C.border}` }}>
            <div><div style={{ fontSize:15,fontWeight:600,color:C.ink }}>Push Notifications</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>Receive alerts and updates</div></div>
            <Toggle on={pushOn} onToggle={()=>setPushOn(v=>!v)}/>
          </div>
          <div style={{ padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
            <div><div style={{ fontSize:15,fontWeight:600,color:C.ink }}>Daily Reminder</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>Reminder to capture your outfit</div></div>
            <Toggle on={reminderOn} onToggle={()=>setReminderOn(v=>{ const next=!v; localStorage.setItem("dailyReminderEnabled",String(next)); return next; })}/>
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
        <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,margin:"0 0 10px" }}>Privacy and Permissions</p>
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
  Object.values(photoData).forEach(e=>{ if(!e?.logged) return; [...(e.items||[]),...(e.outfit2?.items||[])].forEach(item=>{ if(!item||typeof item!=="object") return; const name=(item.name||"").trim().toLowerCase(); if(!name) return; if(!knownItems[name]) knownItems[name]={category:item.category||"Top",color:item.color||"Black",price:null,count:0}; knownItems[name].count+=1; if(item.category&&item.category!=="Other") knownItems[name].category=item.category; if(item.color) knownItems[name].color=item.color; const p=parseFloat(item.price); if(!isNaN(p)&&p>0) knownItems[name].price=String(p); }); });

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
          return {...itemData,itemPhoto:itemPhotoUrl||cleanCrop};
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

  const D = `1px solid ${C.border}`;

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
      {toast&&<div style={{ position:"fixed",top:16,left:12,right:12,zIndex:99999,background:C.red,color:"#fff",borderRadius:0,padding:"10px 14px",fontSize:13,fontWeight:600,boxShadow:"0 4px 16px rgba(0,0,0,.12)" }}>{toast}</div>}

      {/* Header */}
      <div style={{ background:C.surface,padding:"28px 24px 20px",borderBottom:`1px solid ${C.border}`,flexShrink:0 }}>
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
                  <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:8 }}>
                    <span style={{ fontSize:12,fontWeight:500,color:C.sub,minWidth:34 }}>Price</span>
                    <div style={{ display:"flex",alignItems:"center",flex:1,height:36,border:`1px solid ${C.border}`,overflow:"hidden" }}>
                      <span style={{ padding:"0 10px",fontSize:13,color:C.sub,borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center" }}>{getCurrencySymbol()}</span>
                      <input type="number" min="0" step="0.01" value={item.price||""} onChange={e=>updateItem(i,"price",e.target.value)} placeholder="0.00" style={{ flex:1,height:"100%",padding:"0 10px",border:"none",background:"transparent",fontSize:13,color:C.ink,outline:"none",fontFamily:"inherit" }}/>
                    </div>
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                    <span style={{ fontSize:12,fontWeight:500,color:C.sub,minWidth:34 }}>Brand</span>
                    <div style={{ flex:1,height:36,border:`1px solid ${C.border}`,overflow:"visible" }}>
                      <BrandPicker value={item.brand||""} onChange={v=>updateItem(i,"brand",v)}/>
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
  const [memberSince,setMemberSince]=useState("");
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
  const [promptDismissed,setPromptDismissed]=useState(false);
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
        const {data:profile,error:profileErr}=await supabase.from("users").select("photo_data,favourites,username").eq("id",session.user.id).single();
        if(profileErr) console.error("[session restore] profile load error:", profileErr);
        console.log("[session restore] profile loaded:", profile ? `photo_data keys: ${Object.keys(profile.photo_data||{}).length}` : "null");
        setCurrentUser(session.user.id);
        setCurrentEmail(session.user.email||"");
        setCurrentUsername(profile?.username||session.user.user_metadata?.username||"");
        const _d=session.user.created_at?new Date(session.user.created_at):null;
        if(_d) setMemberSince(`${String(_d.getMonth()+1).padStart(2,"0")}\u00B7${_d.getFullYear()}`);
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
    supabase.from("users").update({photo_data:photoData}).eq("id",currentUser)
      .then(({error})=>{ if(error) console.error("[save photoData]",error); });
  },[photoData,currentUser]);

  // Auto-save favourites → Supabase
  useEffect(()=>{
    if(!currentUser||!dataSyncReady.current) return;
    supabase.from("users").update({favourites}).eq("id",currentUser)
      .then(({error})=>{ if(error) console.error("[save favourites]",error); });
  },[favourites,currentUser]);

  // Daily prompt + notification scheduling
  const _toKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const _todayKey=_toKey(new Date());
  const _loggedToday=!!(photoData[_todayKey]?.logged);
  const _dismissedToday=localStorage.getItem("promptDismissed")===new Date().toDateString();
  const _reminderEnabled=localStorage.getItem("dailyReminderEnabled")!=="false";
  const showDailyPrompt=isSignedIn&&_reminderEnabled&&!_loggedToday&&!_dismissedToday&&!promptDismissed&&!subScreen&&!needsPasswordReset;

  // Streak count
  let _streak=0;
  const _d=new Date();
  while(photoData[_toKey(_d)]?.logged){ _streak++; _d.setDate(_d.getDate()-1); }

  // Request notification permission politely after 8s
  useEffect(()=>{
    if(!isSignedIn||!("Notification" in window)) return;
    if(Notification.permission!=="default") return;
    const t=setTimeout(()=>Notification.requestPermission(),8000);
    return ()=>clearTimeout(t);
  },[isSignedIn]);

  // Schedule browser notifications for morning + evening
  useEffect(()=>{
    if(!isSignedIn||!("Notification" in window)||Notification.permission!=="granted") return;
    const now=new Date();
    const timers=[];
    const scheduleNotif=(hour,minRange,body,tag)=>{
      const t=new Date(now);
      t.setHours(hour,Math.floor(Math.random()*minRange),0,0);
      if(t<=now) return;
      timers.push(setTimeout(()=>{
        const key=_toKey(new Date());
        if(!photoData[key]?.logged) new Notification("Stylewrap",{ body, icon:"/favicon.ico", tag });
      }, t-now));
    };
    const _rem=localStorage.getItem("dailyReminderEnabled")!=="false";
    if(!_loggedToday&&_rem){
      scheduleNotif(10,120,"What are you wearing today? Log your outfit in seconds.","morning-reminder");
      scheduleNotif(18,180,"Don't forget to log today's outfit. Your wardrobe story awaits.","evening-reminder");
    }
    return ()=>timers.forEach(clearTimeout);
  },[isSignedIn,_loggedToday]);

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
      case "profile":   return <ProfileScreen onSettings={()=>setSubScreen("settings")} onNotifications={()=>setSubScreen("notifications")} onPrivacy={()=>setSubScreen("privacy")} userEmail={currentEmail} username={currentUsername} photoData={photoData} favourites={favourites} memberSince={memberSince} onBack={canGoBack?goBack:null} onSignOut={async()=>{ await supabase.auth.signOut(); dataSyncReady.current=false; setIsSignedIn(false); setCurrentUser(null); setCurrentEmail(""); setCurrentUsername(""); setMemberSince(""); setPhotoData({}); setFavourites([]); setTab("home"); setSubScreen(null); setTabHistory([]); }}/>;
      default:          return <HomeScreen photoData={photoData} favourites={favourites} userEmail={currentEmail} username={currentUsername} onShowAllItems={()=>{ setWardrobeInitialView("items"); navigateTo("wardrobe"); }} onGoToFavorites={()=>navigateTo("favorites")} onAddItem={()=>setSubScreen("addItem")}/>;
    }
  };

  return (
    <>
      <style>{`*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html,body{margin:0;height:100%;font-family:${F.sans};background:${C.surface};-webkit-font-smoothing:antialiased}@keyframes slideUp{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}::-webkit-scrollbar{display:none}`}</style>
      <div style={{ position:"relative",width:"100%",height:"100%",display:"flex",flexDirection:"column",background:C.surface,overflow:"hidden",paddingTop:"env(safe-area-inset-top,0px)",paddingBottom:"env(safe-area-inset-bottom,0px)" }}>
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
              const inputStyle = { width:"100%",height:52,padding:"0 16px",border:`1.5px solid ${C.border}`,background:C.white,fontSize:15,color:C.ink,outline:"none",boxSizing:"border-box",fontFamily:"inherit",borderRadius:0 };
              return (
                <div style={{ flex:1,display:"flex",flexDirection:"column",background:C.surface,padding:"48px 32px 32px",overflowY:"auto",justifyContent:"center" }}>
                  <h2 style={{ fontSize:26,fontWeight:900,color:C.ink,margin:"0 0 32px",textAlign:"left",letterSpacing:"-0.03em" }}>Change Password</h2>
                  {resetPwError&&<div style={{ background:"#FEF0EF",border:"1px solid #F4C5C0",padding:"10px 14px",fontSize:13,color:"#C0392B",marginBottom:16 }}>{resetPwError}</div>}
                  <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,margin:"0 0 8px" }}>New Password</p>
                  <input type="password" value={resetPwNew} onChange={e=>setResetPwNew(e.target.value)} placeholder="Min. 8 characters" style={inputStyle} onFocus={e=>e.target.style.borderColor=C.sage} onBlur={e=>e.target.style.borderColor=C.border}/>
                  <p style={{ fontSize:10,fontWeight:500,color:C.sub,textTransform:"uppercase",letterSpacing:"0.14em",fontFamily:F.mono,margin:"20px 0 8px" }}>Confirm New Password</p>
                  <input type="password" value={resetPwConfirm} onChange={e=>setResetPwConfirm(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doReset()} placeholder="Repeat password" style={inputStyle} onFocus={e=>e.target.style.borderColor=C.sage} onBlur={e=>e.target.style.borderColor=C.border}/>
                  <button disabled={resetPwLoading} onClick={doReset} style={{ width:"100%",height:54,border:"none",background:C.sage,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginTop:24,opacity:resetPwLoading?0.7:1 }}>{resetPwLoading?"Updating…":"Change Password"}</button>
                  <button onClick={async()=>{ await supabase.auth.signOut(); window.location.hash=""; setResetPwNew(""); setResetPwConfirm(""); setResetPwError(""); setAuthGoToSignIn(true); setNeedsPasswordReset(false); }} style={{ width:"100%",height:54,border:`1px solid ${C.border}`,background:"transparent",color:C.sub,fontSize:16,fontWeight:600,cursor:"pointer",fontFamily:"inherit",marginTop:12 }}>Cancel</button>
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
                {showDailyPrompt&&<DailyLogPrompt photoData={photoData} onAddItem={()=>setSubScreen("addItem")} streak={_streak} onDismiss={()=>{ localStorage.setItem("promptDismissed",new Date().toDateString()); setPromptDismissed(true); }}/>}
              </>
        }
      </div>
    </>
  );
}
