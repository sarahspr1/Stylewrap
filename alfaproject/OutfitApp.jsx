import { useState, useRef, useEffect, Component } from "react";

class ErrorBoundary extends Component {
  constructor(props){ super(props); this.state={ error:null }; }
  static getDerivedStateFromError(e){ return { error:e }; }
  render(){
    if(this.state.error) return (
      <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,background:"#F7F6F4" }}>
        <div style={{ fontSize:40,marginBottom:16 }}>⚠️</div>
        <div style={{ fontSize:16,fontWeight:700,color:"#1C1C1E",marginBottom:8,textAlign:"center" }}>Something went wrong</div>
        <div style={{ fontSize:13,color:"#8E8E93",textAlign:"center",marginBottom:24 }}>{""+this.state.error}</div>
        <button onClick={()=>this.setState({error:null})} style={{ padding:"10px 24px",borderRadius:14,border:"none",background:"#9A9B7A",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Try Again</button>
      </div>
    );
    return this.props.children;
  }
}
import { Home, ShoppingBag, Calendar, Heart, User, ChevronLeft, ChevronRight, Camera, Plus, Trash2, Pencil, Search, TrendingUp, Palette, X, Bell, Shield, Phone, LogOut, Check } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const C = {
  sage: "#9A9B7A", green: "#7A9B7A", blush: "#D3C2B2", blushD: "#B89A8A",
  surface: "#F7F6F4", white: "#FFFFFF", ink: "#1C1C1E", sub: "#8E8E93",
  border: "#E5E5EA", red: "#E5635A",
};

const colorKeywords = { "Black":["black","dark","charcoal"],"White":["white","cream","ivory","off-white","butter","ecru"],"Blue":["blue","denim","navy","teal"],"Gray":["gray","grey","slate"],"Brown":["brown","tan","camel","beige","khaki"],"Green":["green","olive","sage"],"Red":["red","burgundy"],"Yellow":["yellow","gold","mustard"],"Pink":["pink","blush","salmon"],"Purple":["purple","violet","lavender"] };
const colorHex = { "Black":"#1A1A1A","White":"#E8E8E8","Blue":"#5A85C4","Gray":"#9E9E9E","Brown":"#8B6347","Green":"#6B9B6B","Red":"#C45A5A","Yellow":"#D4B84A","Pink":"#D4888A","Purple":"#8A7AB5" };

function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"flex-end" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:"28px 28px 0 0",width:"100%",maxHeight:"92vh",overflow:"auto",padding:"8px 20px 44px",animation:"slideUp .28s cubic-bezier(.32,.72,0,1)" }}>
        <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 16px" }} />
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
          <h2 style={{ fontSize:22,fontWeight:800,color:C.ink,margin:0 }}>{title}</h2>
          <button onClick={onClose} style={{ width:32,height:32,borderRadius:"50%",border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><X size={17} color={C.sub}/></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PrimaryBtn({ children, onClick, disabled, style:s={} }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ width:"100%",height:52,borderRadius:16,border:"none",background:disabled?C.border:C.sage,color:disabled?C.sub:"#fff",fontSize:16,fontWeight:700,cursor:disabled?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"inherit",...s }}>
      {children}
    </button>
  );
}

function DangerBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{ width:"100%",height:52,borderRadius:16,border:"none",background:"#FEF0EF",color:C.red,fontSize:16,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"inherit" }}>
      {children}
    </button>
  );
}

function StatCard({ icon, number, label, accent=C.sage, onClick }) {
  const El = onClick ? "button" : "div";
  return (
    <El onClick={onClick} style={{ flex:1,background:C.white,borderRadius:20,padding:16,boxShadow:"0 1px 0 rgba(0,0,0,.06)",border:`1px solid ${C.border}`,cursor:onClick?"pointer":"default",textAlign:"left",fontFamily:"inherit" }}>
      <div style={{ width:38,height:38,borderRadius:12,background:accent+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,marginBottom:10 }}>{icon}</div>
      <div style={{ fontSize:26,fontWeight:800,color:C.ink,lineHeight:1 }}>{number}</div>
      <div style={{ fontSize:12,color:C.sub,marginTop:4 }}>{label}</div>
    </El>
  );
}

const allItemsData = [
  { id:1,  name:"Black Leather Jacket", category:"Outerwear", emoji:"🧥", color:"#2A2A2A", wears:24 },
  { id:2,  name:"White Sneakers",        category:"Shoes",     emoji:"👟", color:"#E8E8E8", wears:18 },
  { id:3,  name:"Blue Jeans",            category:"Bottoms",   emoji:"👖", color:"#4A6FA5", wears:16 },
  { id:4,  name:"Gray Sweater",          category:"Tops",      emoji:"🧣", color:"#9E9E9E", wears:14 },
  { id:5,  name:"White T-Shirt",         category:"Tops",      emoji:"👕", color:"#FAFAFA", wears:22 },
  { id:6,  name:"Button-Up Shirt",       category:"Tops",      emoji:"👔", color:"#E8D5C4", wears:11 },
  { id:7,  name:"Chelsea Boots",         category:"Shoes",     emoji:"🥾", color:"#5C3D2E", wears:9  },
  { id:8,  name:"Chinos",               category:"Bottoms",   emoji:"👖", color:"#C4A882", wears:13 },
  { id:9,  name:"Blazer",               category:"Outerwear", emoji:"🧥", color:"#1C1C2E", wears:7  },
  { id:10, name:"Floral Shirt",          category:"Tops",      emoji:"🌺", color:"#F7C5A8", wears:5  },
  { id:11, name:"Shorts",               category:"Bottoms",   emoji:"🩳", color:"#7EC8C8", wears:8  },
  { id:12, name:"Hoodie",               category:"Tops",      emoji:"🧥", color:"#6B7280", wears:19 },
  { id:13, name:"Oxford Shoes",          category:"Shoes",     emoji:"👞", color:"#8B4513", wears:6  },
  { id:14, name:"Loafers",              category:"Shoes",     emoji:"👞", color:"#C4A882", wears:10 },
  { id:15, name:"Dark Jeans",           category:"Bottoms",   emoji:"👖", color:"#1A237E", wears:15 },
  { id:16, name:"Trousers",             category:"Bottoms",   emoji:"👖", color:"#37474F", wears:8  },
  { id:17, name:"Dress Shirt",          category:"Tops",      emoji:"👔", color:"#FFFFFF", wears:6  },
  { id:18, name:"Canvas Sneakers",      category:"Shoes",     emoji:"👟", color:"#FFEB3B", wears:12 },
  { id:19, name:"Winter Coat",          category:"Outerwear", emoji:"🧥", color:"#4A4A4A", wears:12 },
  { id:20, name:"Bomber Jacket",        category:"Outerwear", emoji:"🫡", color:"#556B2F", wears:7  },
  { id:21, name:"Polo Shirt",           category:"Tops",      emoji:"👕", color:"#1B5E20", wears:9  },
  { id:22, name:"Cargo Pants",          category:"Bottoms",   emoji:"👖", color:"#8D6E63", wears:6  },
];

function AllItemsScreen({ onBack }) {
  const [items, setItems] = useState(allItemsData);
  const [cat, setCat] = useState("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [editForm, setEditForm] = useState({ name:"", category:"", emoji:"", wears:"" });
  const CATS = ["All","Tops","Bottoms","Outerwear","Shoes"];
  const EMOJIS = ["👕","👔","🧥","👗","👖","🩳","👟","🥾","👞","🧣","🧤","🎩","🩱","🧢","🫡","🌺","💼","👜"];
  const ITEM_CATS = ["Tops","Bottoms","Outerwear","Shoes","Accessories","Dresses","Activewear"];
  const filtered = items.filter(i=>(cat==="All"||i.category===cat)&&i.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
      <div style={{ background:C.white,padding:"16px 16px 0",borderBottom:`1px solid ${C.border}`,flexShrink:0 }}>
        <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:14 }}>
          <button onClick={onBack} style={{ width:36,height:36,borderRadius:12,border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={20} color={C.sage}/></button>
          <div><h1 style={{ fontSize:22,fontWeight:800,color:C.ink,margin:0 }}>All Items</h1><p style={{ fontSize:12,color:C.sub,margin:0 }}>{filtered.length} of {items.length}</p></div>
        </div>
        <div style={{ position:"relative",marginBottom:12 }}>
          <Search size={16} color={C.sub} style={{ position:"absolute",left:12,top:"50%",transform:"translateY(-50%)" }}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{ width:"100%",height:40,paddingLeft:36,paddingRight:12,borderRadius:12,border:`1.5px solid ${C.border}`,background:C.surface,fontSize:14,color:C.ink,outline:"none",boxSizing:"border-box",fontFamily:"inherit" }} onFocus={e=>e.target.style.borderColor=C.sage} onBlur={e=>e.target.style.borderColor=C.border}/>
        </div>
        <div style={{ display:"flex",gap:8,overflowX:"auto",paddingBottom:12,scrollbarWidth:"none" }}>
          {CATS.map(c=><button key={c} onClick={()=>setCat(c)} style={{ flexShrink:0,height:32,padding:"0 14px",borderRadius:999,border:cat===c?"none":`1.5px solid ${C.border}`,background:cat===c?C.sage:C.white,color:cat===c?"#fff":C.sub,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{c}</button>)}
        </div>
      </div>
      <div style={{ flex:1,overflowY:"auto",padding:14 }}>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10 }}>
          {filtered.map(item=>(
            <button key={item.id} onClick={()=>setSelected(item)} style={{ background:C.white,borderRadius:18,overflow:"hidden",border:`1px solid ${C.border}`,display:"flex",flexDirection:"column",cursor:"pointer",textAlign:"left",padding:0,fontFamily:"inherit" }}>
              <div style={{ height:90,background:`linear-gradient(145deg,${item.color}33,${item.color}99)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,position:"relative",width:"100%" }}>
                {item.emoji}
                <div style={{ position:"absolute",bottom:5,right:6,fontSize:10,fontWeight:700,color:C.sage,background:"rgba(255,255,255,.9)",borderRadius:6,padding:"2px 6px" }}>{item.wears}×</div>
              </div>
              <div style={{ padding:"8px 10px 10px" }}>
                <div style={{ fontSize:12,fontWeight:700,color:C.ink,lineHeight:1.3 }}>{item.name}</div>
                <div style={{ fontSize:10,color:C.sub }}>{item.category}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      {selected&&(
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",flexDirection:"column",justifyContent:"flex-end" }} onClick={()=>setSelected(null)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:"28px 28px 0 0",padding:"8px 16px 40px" }}>
            <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
            <div style={{ display:"flex",alignItems:"center",gap:14,padding:"0 4px 20px",borderBottom:`1px solid ${C.border}`,marginBottom:12 }}>
              <div style={{ width:56,height:56,borderRadius:16,background:`linear-gradient(145deg,${selected.color}33,${selected.color}99)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28 }}>{selected.emoji}</div>
              <div><div style={{ fontSize:17,fontWeight:800,color:C.ink }}>{selected.name}</div><div style={{ fontSize:13,color:C.sub }}>{selected.category} · {selected.wears} wears</div></div>
            </div>
            <button onClick={()=>{ setEditForm({ name:selected.name,category:selected.category,emoji:selected.emoji,wears:String(selected.wears) }); setEditItem(selected); setSelected(null); }} style={{ width:"100%",height:54,borderRadius:16,border:"none",background:C.sage+"14",color:C.sage,fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10 }}><Pencil size={18}/> Edit Item</button>
            <button onClick={()=>setDeleteItem(selected)} style={{ width:"100%",height:54,borderRadius:16,border:"none",background:"#FEF0EF",color:C.red,fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10 }}><Trash2 size={18}/> Delete Item</button>
            <button onClick={()=>setSelected(null)} style={{ width:"100%",height:54,borderRadius:16,border:"none",background:C.surface,color:C.sub,fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
          </div>
        </div>
      )}
      {editItem&&(
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"flex-end" }} onClick={()=>setEditItem(null)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:"28px 28px 0 0",width:"100%",padding:"8px 20px 40px",maxHeight:"92vh",overflowY:"auto" }}>
            <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
            <h2 style={{ fontSize:22,fontWeight:800,color:C.ink,marginBottom:16 }}>Edit Item</h2>
            <div style={{ display:"flex",flexWrap:"wrap",gap:8,marginBottom:20 }}>
              {EMOJIS.map(em=><button key={em} onClick={()=>setEditForm(p=>({...p,emoji:em}))} style={{ width:44,height:44,borderRadius:12,border:editForm.emoji===em?`2px solid ${C.sage}`:`1.5px solid ${C.border}`,background:editForm.emoji===em?C.sage+"14":C.surface,fontSize:22,cursor:"pointer" }}>{em}</button>)}
            </div>
            <input value={editForm.name} onChange={e=>setEditForm(p=>({...p,name:e.target.value}))} style={{ width:"100%",height:48,padding:"0 16px",borderRadius:14,border:`1.5px solid ${C.border}`,background:C.surface,fontSize:15,color:C.ink,outline:"none",boxSizing:"border-box",fontFamily:"inherit",marginBottom:16 }}/>
            <div style={{ display:"flex",flexWrap:"wrap",gap:8,marginBottom:20 }}>
              {ITEM_CATS.map(c=><button key={c} onClick={()=>setEditForm(p=>({...p,category:c}))} style={{ height:34,padding:"0 14px",borderRadius:999,border:editForm.category===c?"none":`1.5px solid ${C.border}`,background:editForm.category===c?C.sage:C.white,color:editForm.category===c?"#fff":C.sub,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{c}</button>)}
            </div>
            <button onClick={()=>{ setItems(prev=>prev.map(i=>i.id===editItem.id?{...i,...editForm,wears:parseInt(editForm.wears)||i.wears}:i)); setEditItem(null); }} style={{ width:"100%",height:52,borderRadius:16,border:"none",background:C.sage,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Save Changes</button>
          </div>
        </div>
      )}
      {deleteItem&&(
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:24 }} onClick={()=>setDeleteItem(null)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:28,padding:28,width:"100%" }}>
            <div style={{ fontSize:36,textAlign:"center",marginBottom:12 }}>🗑️</div>
            <h2 style={{ fontSize:20,fontWeight:800,color:C.ink,textAlign:"center",margin:"0 0 8px" }}>Delete "{deleteItem.name}"?</h2>
            <button onClick={()=>{ setItems(prev=>prev.filter(i=>i.id!==deleteItem.id)); setDeleteItem(null); setSelected(null); }} style={{ width:"100%",height:52,borderRadius:16,border:"none",background:C.red,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:10 }}>Delete</button>
            <button onClick={()=>setDeleteItem(null)} style={{ width:"100%",height:52,borderRadius:16,border:"none",background:C.surface,color:C.sub,fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBar({ active, onChange }) {
  const tabs=[{ id:"home",label:"Home",icon:Home },{ id:"wardrobe",label:"Wardrobe",icon:ShoppingBag },{ id:"calendar",label:"Calendar",icon:Calendar },{ id:"favorites",label:"Favorites",icon:Heart },{ id:"profile",label:"Profile",icon:User }];
  return (
    <div style={{ height:83,background:C.white,borderTop:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-around",paddingBottom:20,flexShrink:0 }}>
      {tabs.map(({ id,label,icon:Icon })=>{
        const a=active===id;
        return <button key={id} onClick={()=>onChange(id)} style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:3,minWidth:56,border:"none",background:"transparent",cursor:"pointer",padding:6,borderRadius:12 }}>
          <div style={{ width:32,height:32,borderRadius:10,background:a?C.sage+"18":"transparent",display:"flex",alignItems:"center",justifyContent:"center" }}><Icon size={20} color={a?C.sage:"#ABABAB"} strokeWidth={a?2.5:2}/></div>
          <span style={{ fontSize:10,fontWeight:a?700:500,color:a?C.sage:"#ABABAB" }}>{label}</span>
        </button>;
      })}
    </div>
  );
}

function HomeScreen({ photoData={}, onShowAllItems, onGoToFavorites, onAddItem }) {
  const recentOutfits=[{ id:1,name:"Casual Friday",emoji:"👕",date:"Feb 27",tag:"Casual" },{ id:2,name:"Date Night",emoji:"👗",date:"Feb 20",tag:"Evening" },{ id:3,name:"Weekend Brunch",emoji:"🧥",date:"Feb 18",tag:"Casual" }];
  const tagColors={ Casual:C.sage,Evening:"#7A6A9A" };
  const now=new Date();
  const dayName=now.toLocaleDateString("en-US",{weekday:"long"});
  const monthName=now.toLocaleDateString("en-US",{month:"short"});
  const dateLabel=`${dayName}, ${monthName} ${now.getDate()}`;

  // Compute most worn colour this month
  const curY=now.getFullYear(), curM=now.getMonth()+1;
  const monthItems=Object.entries(photoData)
    .filter(([key,e])=>{ if(!e?.logged) return false; const [y,m]=key.split("-").map(Number); return y===curY&&m===curM; })
    .flatMap(([,e])=>(e.items||[]).map(item=>typeof item==="object"?item:{ name:String(item||""),category:"Other" }).filter(item=>item&&item.name&&typeof item.name==="string"));
  const mColorCounts={};
  monthItems.forEach(item=>{ let col=null; if(item.color&&colorHex[item.color]) col=item.color; else { const n=item.name.toLowerCase(); for(const [c,kws] of Object.entries(colorKeywords)){ if(kws.some(kw=>n.includes(kw))){ col=c; break; } } } mColorCounts[col||"Other"]=(mColorCounts[col||"Other"]||0)+1; });
  const topColorEntry=Object.entries(mColorCounts).filter(([k])=>k!=="Other").sort((a,b)=>b[1]-a[1])[0];
  const topColorName=topColorEntry?topColorEntry[0]:null;
  const topColorHex=topColorName?colorHex[topColorName]:null;

  return (
    <div style={{ flex:1,overflowY:"auto",background:C.surface }}>
      <div style={{ background:`linear-gradient(145deg,${C.sage} 0%,${C.green} 100%)`,paddingTop:30,paddingBottom:20,paddingLeft:24,paddingRight:24,borderRadius:"0 0 32px 32px",position:"relative",overflow:"hidden" }}>
        <div style={{ position:"absolute",top:-40,right:-40,width:200,height:200,borderRadius:"50%",background:"rgba(255,255,255,.08)" }}/>
        <p style={{ fontSize:13,color:"rgba(255,255,255,.7)",fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6 }}>{dateLabel}</p>
        <h1 style={{ fontSize:34,fontWeight:800,color:"#fff",margin:"0 0 4px",lineHeight:1.15 }}>Good Morning ☀️</h1>
        <p style={{ fontSize:16,color:"rgba(255,255,255,.8)",margin:0 }}>Ready to plan today's look?</p>
      </div>
      <div style={{ padding:"16px 16px 0" }}>
        <div style={{ display:"flex",gap:10,marginBottom:20 }}>
          <div style={{ flex:1,background:C.white,borderRadius:20,padding:16,boxShadow:"0 1px 0 rgba(0,0,0,.06)",border:`1px solid ${C.border}` }}>
            <div style={{ width:38,height:38,borderRadius:12,background:topColorHex?(topColorHex+"28"):C.surface,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:10 }}>
              {topColorHex
                ? <div style={{ width:22,height:22,borderRadius:"50%",background:topColorHex,border:topColorName==="White"?`1.5px solid ${C.border}`:"none" }}/>
                : <Palette size={18} color={C.sub}/>}
            </div>
            <div style={{ fontSize:18,fontWeight:800,color:topColorName?C.ink:C.sub,lineHeight:1 }}>{topColorName||"None yet"}</div>
            <div style={{ fontSize:12,color:C.sub,marginTop:4 }}>Colour of the Month</div>
          </div>
          <StatCard icon="❤️" number="8" label="Favorites" accent="#C47A7A" onClick={onGoToFavorites}/>
        </div>
        <h2 style={{ fontSize:18,fontWeight:700,color:C.ink,marginBottom:12 }}>Quick Actions</h2>
        <div style={{ display:"flex",gap:10,marginBottom:20 }}>
          <button onClick={onAddItem} style={{ flex:1,height:56,borderRadius:16,border:"none",background:C.sage+"14",display:"flex",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer",fontFamily:"inherit" }}><span style={{ fontSize:20 }}>📸</span><span style={{ fontSize:14,fontWeight:700,color:C.ink }}>Add Item</span></button>
          <button onClick={onShowAllItems} style={{ flex:1,height:56,borderRadius:16,border:"none",background:C.green+"14",display:"flex",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer",fontFamily:"inherit" }}><span style={{ fontSize:20 }}>✨</span><span style={{ fontSize:14,fontWeight:700,color:C.ink }}>All Items</span></button>
        </div>
        <h2 style={{ fontSize:18,fontWeight:700,color:C.ink,marginBottom:12 }}>Recent Outfits</h2>
        {recentOutfits.map(o=>(
          <div key={o.id} style={{ background:C.white,borderRadius:18,padding:"12px 16px",marginBottom:10,display:"flex",alignItems:"center",gap:14,border:`1px solid ${C.border}` }}>
            <div style={{ width:46,height:46,borderRadius:14,background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0 }}>{o.emoji}</div>
            <div style={{ flex:1 }}><div style={{ fontSize:15,fontWeight:700,color:C.ink }}>{o.name}</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>{o.date}</div></div>
            <span style={{ fontSize:11,fontWeight:700,color:tagColors[o.tag],background:tagColors[o.tag]+"18",padding:"4px 10px",borderRadius:999 }}>{o.tag}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const initialCPWPrices = { "leather jacket":250,"sneakers":120 };

function WardrobeScreen({ photoData, onBack }) {
  const [view,setView]=useState("main");
  const [selectedPiece,setSelectedPiece]=useState(null);
  const [cpwPrices,setCpwPrices]=useState(initialCPWPrices);
  const [cpwAddModal,setCpwAddModal]=useState(null);
  const [cpwEditItem,setCpwEditItem]=useState(null);
  const [cpwDeleteItem,setCpwDeleteItem]=useState(null);
  const [cpwPriceInput,setCpwPriceInput]=useState("");

  const loggedOutfits=Object.values(photoData).filter(e=>e&&e.logged);
  const totalOutfits=loggedOutfits.length;
  // Total item instances across all outfits (any valid object counts)
  const totalItemsCount=loggedOutfits.reduce((sum,e)=>sum+(e.items||[]).filter(i=>i&&typeof i==="object").length,0);
  // Named items only — used for wear counts, color distribution, most/least worn
  const allLoggedObjs=loggedOutfits.flatMap(e=>(e.items||[]).map(item=>typeof item==="object"?item:{ name:String(item||""),category:"Other" }).filter(item=>item&&item.name&&typeof item.name==="string"));
  const wearCounts={};
  allLoggedObjs.forEach(item=>{ const k=(item.name||"").toLowerCase().trim(); if(!k) return; if(!wearCounts[k]) wearCounts[k]={ name:item.name,category:item.category||"Other",count:0 }; wearCounts[k].count+=1; });
  const wearArr=Object.values(wearCounts).sort((a,b)=>b.count-a.count);
  const totalWears=wearArr.reduce((s,p)=>s+p.count,0);
  const catEmoji=cat=>cat==="Top"?"👕":cat==="Bottom"?"👖":cat==="Shoes"?"👟":cat==="Outerwear"?"🧥":cat==="Accessories"?"💍":cat==="Dresses"?"👗":cat==="Swimwear"?"👙":"👔";
  const computedMostWorn=wearArr.slice(0,5).map(p=>({ name:p.name,wears:p.count,category:p.category,image:catEmoji(p.category) }));
  const computedLeastWorn=[...wearArr].reverse().slice(0,5).map(p=>({ name:p.name,wears:p.count,category:p.category,image:catEmoji(p.category) }));

  const colorCounts={};
  loggedOutfits.forEach(e=>{ (e.items||[]).forEach(item=>{ if(!item||typeof item!=="object") return; let col=null; if(item.color&&colorHex[item.color]) col=item.color; else if(item.name&&typeof item.name==="string"){ const n=item.name.toLowerCase(); for(const [c,kws] of Object.entries(colorKeywords)){ if(kws.some(kw=>n.includes(kw))){ col=c; break; } } } colorCounts[col||"Other"]=(colorCounts[col||"Other"]||0)+1; }); });
  const totalCI=Object.values(colorCounts).reduce((s,v)=>s+v,0)||1;
  const computedColorData=Object.entries(colorCounts).filter(([n])=>n!=="Other").sort((a,b)=>b[1]-a[1]).concat(colorCounts["Other"]?[["Other",colorCounts["Other"]]]:[]).map(([name,count])=>({ name,value:Math.round(count/totalCI*100),color:colorHex[name]||"#B0B0A8" }));

  const getStyle=items=>{ try { const names=(items||[]).map(i=>((typeof i==="object"?i.name:i)||"").toString().toLowerCase()).join(" "); const cats=(items||[]).map(i=>((typeof i==="object"?i.category:i)||"").toString().toLowerCase()).join(" "); if(cats.includes("activewear")||/gym|sport|athletic|yoga|running|workout|leggings|jogger/.test(names)) return "Activewear"; if(/blazer|suit|dress shirt|slacks|oxford|loafer|trousers|button-up|button up|formal|professional/.test(names)) return "Professional"; if(/dress|heels|jumpsuit|going out|club|evening|sequin|satin/.test(names)) return "Going Out"; return "Everyday"; } catch { return "Everyday"; } };
  const styleCounts={ Everyday:0,"Going Out":0,Activewear:0,Professional:0 };
  Object.values(photoData).forEach(entry=>{ if(entry?.logged){ const s=entry.style&&styleCounts.hasOwnProperty(entry.style)?entry.style:getStyle(entry.items); styleCounts[s]+=1; } });

  // Build item stats (wears + price) in a single pass over all logged outfits
  const itemStatsMap={};
  loggedOutfits.forEach(e=>{ (e.items||[]).forEach(item=>{ if(!item||typeof item!=="object") return; const name=(item.name||"").trim(); if(!name) return; const key=name.toLowerCase(); if(!itemStatsMap[key]) itemStatsMap[key]={name,category:item.category||"Other",wears:0,price:null}; itemStatsMap[key].wears+=1; if(item.category&&item.category!=="Other") itemStatsMap[key].category=item.category; const p=parseFloat(item.price); if(!isNaN(p)&&p>0) itemStatsMap[key].price=p; }); });
  // cpwPrices (set directly in wardrobe CPW section) override calendar prices
  const cpwList=Object.values(itemStatsMap).map(s=>{ const key=s.name.toLowerCase(); const price=cpwPrices[key]!=null?cpwPrices[key]:s.price; const cpw=price!=null&&s.wears>0?price/s.wears:null; return {name:s.name,category:s.category,wears:s.wears,price,cpw}; }).sort((a,b)=>b.wears-a.wears);
  const pricedItems=cpwList.filter(i=>i.price!==null);
  const avgCPW=pricedItems.length>0?(pricedItems.reduce((s,i)=>s+i.cpw,0)/pricedItems.length).toFixed(2):"—";

  const SectionHeader=({ title,back })=>(
    <div style={{ background:C.white,padding:"16px 20px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0 }}>
      {back&&<button onClick={back} style={{ width:36,height:36,borderRadius:12,border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={20} color={C.sage}/></button>}
      <h1 style={{ fontSize:22,fontWeight:800,color:C.ink,margin:0 }}>{title}</h1>
    </div>
  );

  if(view==="items"){
    const categories=[...new Set(wearArr.map(i=>i.category))].sort();
    return (
      <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
        <SectionHeader title="All Items" back={()=>setView("main")}/>
        <div style={{ flex:1,overflowY:"auto",padding:16,paddingBottom:32 }}>
          {wearArr.length===0
            ? <div style={{ textAlign:"center",padding:"48px 24px" }}><div style={{ fontSize:40,marginBottom:12 }}>👗</div><div style={{ fontSize:16,fontWeight:700,color:C.ink,marginBottom:6 }}>No items yet</div><div style={{ fontSize:13,color:C.sub }}>Log an outfit on the Calendar screen to see your items here.</div></div>
            : categories.map(cat=>(
                <div key={cat} style={{ marginBottom:20 }}>
                  <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",margin:"0 0 10px" }}>{cat}</p>
                  {wearArr.filter(i=>i.category===cat).map((item,idx)=>(
                    <div key={idx} style={{ background:C.white,borderRadius:16,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12,border:`1px solid ${C.border}` }}>
                      <div style={{ width:44,height:44,borderRadius:12,background:C.sage+"14",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0 }}>{catEmoji(item.category)}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:14,fontWeight:600,color:C.ink }}>{item.name}</div>
                        <div style={{ fontSize:12,color:C.sub,marginTop:2 }}>{item.count} {item.count===1?"wear":"wears"}</div>
                      </div>
                      <span style={{ fontSize:11,fontWeight:700,color:C.sage,background:C.sage+"14",padding:"3px 10px",borderRadius:999 }}>{cat}</span>
                    </div>
                  ))}
                </div>
              ))
          }
        </div>
      </div>
    );
  }

  if(view==="piece"&&selectedPiece){
    const pct=totalWears>0?((selectedPiece.wears/totalWears)*100).toFixed(1):0;
    return (
      <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
        <SectionHeader title={selectedPiece.name} back={()=>setView("main")}/>
        <div style={{ flex:1,overflowY:"auto",padding:16 }}>
          <div style={{ background:C.white,borderRadius:20,padding:20,marginBottom:12,display:"flex",alignItems:"center",gap:16 }}>
            <div style={{ fontSize:44 }}>{selectedPiece.image}</div>
            <div><div style={{ fontSize:26,fontWeight:800,color:C.ink }}>{selectedPiece.wears} wears</div><div style={{ fontSize:13,color:C.sub }}>{pct}% of outfit appearances</div></div>
          </div>
          <div style={{ background:C.white,borderRadius:20,padding:16,border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:13,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8 }}>Category</div>
            <span style={{ fontSize:14,fontWeight:700,color:C.sage,background:C.sage+"14",padding:"6px 14px",borderRadius:999 }}>{selectedPiece.category}</span>
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
            <div style={{ background:`linear-gradient(135deg,${C.sage},${C.green})`,borderRadius:20,padding:"16px 20px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:12,color:"rgba(255,255,255,.8)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em" }}>Average Cost / Wear</div>
                <div style={{ fontSize:36,fontWeight:900,color:"#fff",lineHeight:1.1,marginTop:4 }}>${avgCPW}</div>
                <div style={{ fontSize:12,color:"rgba(255,255,255,.7)",marginTop:2 }}>{pricedItems.length} items tracked</div>
              </div>
              <div style={{ fontSize:44 }}>💰</div>
            </div>
          )}
          {priced.length>0&&(
            <div style={{ marginBottom:16 }}>
              <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10 }}>Tracked Items</p>
              {priced.map((item,i)=>(
                <div key={i} style={{ background:C.white,borderRadius:18,padding:"14px 16px",marginBottom:10,border:`1px solid ${C.border}` }}>
                  <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:10 }}>
                    <div style={{ width:42,height:42,borderRadius:13,background:C.sage+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>{catEmoji(item.category)}</div>
                    <div style={{ flex:1 }}><div style={{ fontSize:14,fontWeight:700,color:C.ink }}>{item.name}</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>${item.price.toFixed(2)} · {item.wears} wear{item.wears!==1?"s":""}</div></div>
                    <div style={{ textAlign:"right" }}><div style={{ fontSize:20,fontWeight:800,color:C.sage }}>${item.cpw.toFixed(2)}</div><div style={{ fontSize:10,color:C.sub }}>per wear</div></div>
                  </div>
                  <div style={{ height:4,borderRadius:99,background:C.border,marginBottom:10,overflow:"hidden" }}><div style={{ height:"100%",width:`${Math.min((item.wears/maxWears)*100,100)}%`,background:C.sage,borderRadius:99 }}/></div>
                  <div style={{ display:"flex",gap:8 }}>
                    <button onClick={()=>{ setCpwEditItem(item); setCpwPriceInput(item.price.toString()); }} style={{ flex:1,height:34,borderRadius:10,border:`1px solid ${C.border}`,background:C.surface,color:C.sage,fontWeight:600,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6,fontFamily:"inherit" }}><Pencil size={13}/> Edit Price</button>
                    <button onClick={()=>setCpwDeleteItem(item.name)} style={{ flex:1,height:34,borderRadius:10,border:`1px solid ${C.border}`,background:C.surface,color:C.red,fontWeight:600,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6,fontFamily:"inherit" }}><Trash2 size={13}/> Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {unpriced.length>0&&(
            <div>
              <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10 }}>Add Price to Track ({unpriced.length} items)</p>
              {unpriced.map((item,i)=>(
                <button key={i} onClick={()=>{ setCpwAddModal(item); setCpwPriceInput(""); }} style={{ width:"100%",background:C.white,borderRadius:18,padding:"14px 16px",marginBottom:10,border:`1.5px dashed ${C.border}`,cursor:"pointer",textAlign:"left",fontFamily:"inherit",display:"flex",alignItems:"center",gap:12 }}>
                  <div style={{ width:42,height:42,borderRadius:13,background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>{catEmoji(item.category)}</div>
                  <div style={{ flex:1 }}><div style={{ fontSize:14,fontWeight:600,color:C.ink }}>{item.name}</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>{item.wears} wear{item.wears!==1?"s":""} · tap to add price</div></div>
                  <div style={{ width:28,height:28,borderRadius:"50%",background:C.sage+"18",display:"flex",alignItems:"center",justifyContent:"center" }}><Plus size={15} color={C.sage}/></div>
                </button>
              ))}
            </div>
          )}
          {cpwList.length===0&&<div style={{ textAlign:"center",padding:40,color:C.sub }}><div style={{ fontSize:40,marginBottom:12 }}>💸</div><p>Log outfits to track cost per wear</p></div>}
        </div>
        {cpwAddModal&&(
          <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"flex-end" }} onClick={()=>setCpwAddModal(null)}>
            <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:"28px 28px 0 0",width:"100%",padding:"8px 20px 44px" }}>
              <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
              <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:20 }}>
                <div style={{ width:46,height:46,borderRadius:14,background:C.sage+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22 }}>{catEmoji(cpwAddModal.category)}</div>
                <div><div style={{ fontSize:16,fontWeight:700,color:C.ink }}>{cpwAddModal.name}</div><div style={{ fontSize:13,color:C.sub }}>{cpwAddModal.wears} wears logged</div></div>
              </div>
              <label style={{ display:"block",fontSize:13,fontWeight:700,color:C.sub,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em" }}>Item Price ($)</label>
              <input type="number" value={cpwPriceInput} onChange={e=>setCpwPriceInput(e.target.value)} placeholder="0.00" style={{ width:"100%",height:52,padding:"0 16px",borderRadius:14,border:`1.5px solid ${C.border}`,background:C.surface,fontSize:18,fontWeight:700,color:C.ink,outline:"none",boxSizing:"border-box",fontFamily:"inherit",marginBottom:16 }} onFocus={e=>e.target.style.borderColor=C.sage} onBlur={e=>e.target.style.borderColor=C.border}/>
              {cpwPriceInput&&parseFloat(cpwPriceInput)>0&&<div style={{ background:C.sage+"14",borderRadius:14,padding:"10px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center" }}><span style={{ fontSize:13,color:C.sub }}>Cost per wear</span><span style={{ fontSize:22,fontWeight:800,color:C.sage }}>${(parseFloat(cpwPriceInput)/cpwAddModal.wears).toFixed(2)}</span></div>}
              <button onClick={()=>{ if(!cpwPriceInput||parseFloat(cpwPriceInput)<=0) return; setCpwPrices(p=>({...p,[cpwAddModal.name.toLowerCase().trim()]:parseFloat(cpwPriceInput)})); setCpwAddModal(null); }} style={{ width:"100%",height:52,borderRadius:16,border:"none",background:!cpwPriceInput||parseFloat(cpwPriceInput)<=0?C.border:C.sage,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Save Price</button>
            </div>
          </div>
        )}
        {cpwEditItem&&(
          <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"flex-end" }} onClick={()=>setCpwEditItem(null)}>
            <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:"28px 28px 0 0",width:"100%",padding:"8px 20px 44px" }}>
              <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
              <h2 style={{ fontSize:20,fontWeight:800,color:C.ink,marginBottom:6 }}>Edit Price</h2>
              <p style={{ fontSize:14,color:C.sub,marginBottom:20 }}>{cpwEditItem.name}</p>
              <input type="number" value={cpwPriceInput} onChange={e=>setCpwPriceInput(e.target.value)} style={{ width:"100%",height:52,padding:"0 16px",borderRadius:14,border:`1.5px solid ${C.border}`,background:C.surface,fontSize:18,fontWeight:700,color:C.ink,outline:"none",boxSizing:"border-box",fontFamily:"inherit",marginBottom:16 }} onFocus={e=>e.target.style.borderColor=C.sage} onBlur={e=>e.target.style.borderColor=C.border}/>
              {cpwPriceInput&&parseFloat(cpwPriceInput)>0&&<div style={{ background:C.sage+"14",borderRadius:14,padding:"10px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center" }}><span style={{ fontSize:13,color:C.sub }}>New cost per wear</span><span style={{ fontSize:22,fontWeight:800,color:C.sage }}>${(parseFloat(cpwPriceInput)/cpwEditItem.wears).toFixed(2)}</span></div>}
              <button onClick={()=>{ setCpwPrices(p=>({...p,[cpwEditItem.name.toLowerCase().trim()]:parseFloat(cpwPriceInput)})); setCpwEditItem(null); }} style={{ width:"100%",height:52,borderRadius:16,border:"none",background:C.sage,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Update Price</button>
            </div>
          </div>
        )}
        {cpwDeleteItem&&(
          <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:24 }} onClick={()=>setCpwDeleteItem(null)}>
            <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:28,padding:28,width:"100%",maxWidth:340 }}>
              <div style={{ fontSize:36,textAlign:"center",marginBottom:12 }}>🗑️</div>
              <h2 style={{ fontSize:18,fontWeight:800,color:C.ink,textAlign:"center",margin:"0 0 8px" }}>Remove price?</h2>
              <p style={{ fontSize:14,color:C.sub,textAlign:"center",margin:"0 0 24px" }}>Item stays in wardrobe but won't be cost-tracked.</p>
              <button onClick={()=>{ setCpwPrices(p=>{ const n={...p}; delete n[cpwDeleteItem.toLowerCase().trim()]; return n; }); setCpwDeleteItem(null); }} style={{ width:"100%",height:50,borderRadius:14,border:"none",background:C.red,color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:10 }}>Remove</button>
              <button onClick={()=>setCpwDeleteItem(null)} style={{ width:"100%",height:50,borderRadius:14,border:"none",background:C.surface,color:C.sub,fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
      <div style={{ background:C.white,padding:"56px 20px 16px",borderBottom:`1px solid ${C.border}`,flexShrink:0 }}>
        {onBack&&<button onClick={onBack} style={{ display:"flex",alignItems:"center",gap:6,border:"none",background:"transparent",color:C.sage,fontSize:14,fontWeight:600,cursor:"pointer",padding:"0 0 10px",fontFamily:"inherit" }}><ChevronLeft size={18} color={C.sage}/>Back</button>}
        <h1 style={{ fontSize:28,fontWeight:800,color:C.ink,margin:"0 0 4px" }}>Analytics</h1>
        <p style={{ fontSize:14,color:C.sub,margin:0 }}>Your wardrobe insights</p>
      </div>
      <div style={{ flex:1,overflowY:"auto",padding:16,paddingBottom:32 }}>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16 }}>
          <div style={{ background:C.white,borderRadius:20,padding:16,border:`1px solid ${C.border}` }}><div style={{ fontSize:22 }}>🗓️</div><div style={{ fontSize:24,fontWeight:800,color:C.ink,marginTop:8 }}>{String(totalOutfits)}</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>Total Outfits</div></div>
          <button onClick={()=>setView("items")} style={{ background:C.white,borderRadius:20,padding:16,border:`1px solid ${C.border}`,textAlign:"left",cursor:"pointer",fontFamily:"inherit",display:"flex",flexDirection:"column" }}><div style={{ fontSize:22 }}>👔</div><div style={{ fontSize:24,fontWeight:800,color:C.ink,marginTop:8 }}>{String(totalItemsCount)}</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>Total Items</div><div style={{ fontSize:10,color:C.sage,marginTop:4,fontWeight:600 }}>Tap to view →</div></button>
          <button onClick={()=>setView("cpw")} style={{ background:C.white,borderRadius:20,padding:16,border:`1px solid ${C.border}`,textAlign:"left",cursor:"pointer",fontFamily:"inherit",display:"flex",flexDirection:"column" }}>
            <div style={{ fontSize:22 }}>💰</div>
            <div style={{ fontSize:24,fontWeight:800,color:C.sage,marginTop:8 }}>{avgCPW==="—"?"—":`$${avgCPW}`}</div>
            <div style={{ fontSize:12,color:C.sub,marginTop:2 }}>Avg Cost/Wear</div>
            <div style={{ fontSize:10,color:C.sage,marginTop:4,fontWeight:600 }}>Tap to manage →</div>
          </button>
        </div>

        <div style={{ background:C.white,borderRadius:20,padding:16,marginBottom:12,border:`1px solid ${C.border}` }}>
          <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14 }}>
            <div style={{ width:36,height:36,borderRadius:12,background:C.sage+"18",display:"flex",alignItems:"center",justifyContent:"center" }}><TrendingUp size={18} color={C.sage}/></div>
            <span style={{ fontSize:17,fontWeight:700,color:C.ink }}>Most Worn Pieces</span>
          </div>
          {computedMostWorn.length>0?computedMostWorn.map((p,i)=>(
            <button key={i} onClick={()=>{ setSelectedPiece(p); setView("piece"); }} style={{ width:"100%",background:C.surface,borderRadius:14,padding:"10px 12px",display:"flex",alignItems:"center",gap:12,marginBottom:8,border:`1px solid ${C.border}`,cursor:"pointer",textAlign:"left" }}>
              <div style={{ width:44,height:44,borderRadius:12,background:C.white,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0 }}>{p.image}</div>
              <div style={{ flex:1 }}><div style={{ fontSize:14,fontWeight:600,color:C.ink }}>{p.name}</div><div style={{ display:"flex",alignItems:"center",gap:8,marginTop:3 }}><span style={{ fontSize:12,color:C.sub }}>{p.wears} wear{p.wears!==1?"s":""}</span>{totalWears>0&&<span style={{ fontSize:12,fontWeight:700,color:C.sage }}>{((p.wears/totalWears)*100).toFixed(0)}%</span>}</div></div>
              <ChevronRight size={16} color={C.border}/>
            </button>
          )):<div style={{ fontSize:13,color:C.sub,textAlign:"center",padding:16 }}>No outfits logged yet</div>}
        </div>

        <div style={{ background:C.white,borderRadius:20,padding:16,marginBottom:12,border:`1px solid ${C.border}` }}>
          <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14 }}>
            <div style={{ width:36,height:36,borderRadius:12,background:"#E5635A18",display:"flex",alignItems:"center",justifyContent:"center" }}><TrendingUp size={18} color="#E5635A" style={{ transform:"rotate(180deg)" }}/></div>
            <div style={{ flex:1 }}><span style={{ fontSize:17,fontWeight:700,color:C.ink }}>Least Worn Pieces</span><p style={{ fontSize:12,color:C.sub,margin:0 }}>Items that need more love</p></div>
          </div>
          {computedLeastWorn.length>0?computedLeastWorn.map((p,i)=>(
            <button key={i} onClick={()=>{ setSelectedPiece(p); setView("piece"); }} style={{ width:"100%",background:C.surface,borderRadius:14,padding:"10px 12px",display:"flex",alignItems:"center",gap:12,marginBottom:8,border:`1px solid ${C.border}`,cursor:"pointer",textAlign:"left" }}>
              <div style={{ width:44,height:44,borderRadius:12,background:C.white,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0 }}>{p.image}</div>
              <div style={{ flex:1 }}><div style={{ fontSize:14,fontWeight:600,color:C.ink }}>{p.name}</div><div style={{ display:"flex",alignItems:"center",gap:8,marginTop:3 }}><span style={{ fontSize:12,color:C.sub }}>{p.wears} wear{p.wears!==1?"s":""}</span>{totalWears>0&&<span style={{ fontSize:12,fontWeight:700,color:C.sage }}>{((p.wears/totalWears)*100).toFixed(0)}%</span>}</div></div>
              <ChevronRight size={16} color={C.border}/>
            </button>
          )):<div style={{ fontSize:13,color:C.sub,textAlign:"center",padding:16 }}>No outfits logged yet</div>}
        </div>

        <div style={{ background:C.white,borderRadius:20,padding:16,marginBottom:12,border:`1px solid ${C.border}` }}>
          <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14 }}>
            <div style={{ width:36,height:36,borderRadius:12,background:C.blush+"40",display:"flex",alignItems:"center",justifyContent:"center" }}><Palette size={18} color={C.sage}/></div>
            <span style={{ fontSize:17,fontWeight:700,color:C.ink }}>Color Distribution</span>
          </div>
          {computedColorData.length>0?(
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart><Pie data={computedColorData} cx="50%" cy="50%" innerRadius={55} outerRadius={82} paddingAngle={3} dataKey="value">{computedColorData.map((e,i)=><Cell key={i} fill={e.color} stroke={e.color==="#E8E8E8"||e.color==="#B0B0A8"?C.border:"none"}/>)}</Pie></PieChart>
              </ResponsiveContainer>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px 8px",marginTop:14 }}>
                {computedColorData.map((e,i)=>(
                  <div key={i} style={{ display:"flex",alignItems:"center",gap:8 }}>
                    <div style={{ width:14,height:14,borderRadius:"50%",background:e.color,border:e.color==="#E8E8E8"||e.color==="#B0B0A8"?`1px solid ${C.border}`:"none",flexShrink:0 }}/>
                    <span style={{ fontSize:13,color:C.ink,flex:1 }}>{e.name}</span>
                    <span style={{ fontSize:13,fontWeight:700,color:C.ink }}>{e.value}%</span>
                  </div>
                ))}
              </div>
            </>
          ):<div style={{ fontSize:13,color:C.sub,textAlign:"center",padding:16 }}>No outfits logged yet</div>}
        </div>

      </div>
    </div>
  );
}


function CalendarScreen({ photoData, setPhotoData, favourites=[], onToggleFavourite, onBack }) {
  const [selectedDate,setSelectedDate]=useState(null);
  const [showModal,setShowModal]=useState(false);
  const [showSourcePicker,setShowSourcePicker]=useState(false);
  const [editMode,setEditMode]=useState(false);
  const [editEntry,setEditEntry]=useState(null);
  const [selectedItemIdxs,setSelectedItemIdxs]=useState(new Set());
  const months=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const today=new Date();
  const toKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  // Build lookup of all previously logged items by name (latest entry wins for each field)
  const knownItems={};
  Object.values(photoData).forEach(e=>{ if(!e?.logged) return; (e.items||[]).forEach(item=>{ if(!item||typeof item!=="object") return; const name=(item.name||"").trim().toLowerCase(); if(!name) return; if(!knownItems[name]) knownItems[name]={category:item.category||"Top",color:item.color||"Black",price:null}; if(item.category&&item.category!=="Other") knownItems[name].category=item.category; if(item.color) knownItems[name].color=item.color; const p=parseFloat(item.price); if(!isNaN(p)&&p>0) knownItems[name].price=String(p); }); });

  const handlePhotoUpload=(file)=>{
    if(!file) return;
    setShowSourcePicker(false);
    const r=new FileReader();
    r.onload=async(ev)=>{
      const photoDataUrl=ev.target.result;
      const base64=photoDataUrl.split(",")[1];
      const dateKey=toKey(selectedDate);
      setPhotoData(p=>({...p,[dateKey]:{ logged:true,photo:photoDataUrl,items:[],style:null,analysing:true }}));
      setShowModal(true);
      const apiKey=getApiKey();
      if(!apiKey){
        setPhotoData(p=>({...p,[dateKey]:{...p[dateKey],analysing:false}}));
        setEditEntry({style:null,items:[]});
        setEditMode(true);
        return;
      }
      try{
        const knownList=Object.entries(knownItems).map(([name,v])=>`- "${name}" (${v.category}, ${v.color})`).join("\n");
        const schema=`{"style_category":"Everyday|Going Out|Activewear|Professional","formality_level":"Casual|Smart Casual|Formal|Sporty","season":"Spring|Summer|Autumn|Winter|All Season","color_palette":["dominant colour","secondary colour"],"clothing_items":[{"category":"Top|Bottom|Outerwear|Shoes|Accessories|Dresses|Swimwear","name":"item name","color":"Black|White|Blue|Gray|Brown|Green|Red|Yellow|Pink|Purple"}]}`;
        const prompt=knownList
          ?`Analyse this outfit image. Previously logged items are listed below — if any item in the photo is the same piece, use the EXACT name from the list (critical for wear tracking).\n\nPreviously logged items:\n${knownList}\n\nReturn ONLY valid JSON, no markdown:\n${schema}`
          :`Analyse this outfit image and return ONLY valid JSON, no markdown:\n${schema}`;
        const response=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:file.type,data:base64}},{type:"text",text:prompt}]}]})});
        const data=await response.json();
        const text=data.content?.map(b=>b.text||"").join("")||"{}";
        const parsed=JSON.parse(text.replace(/```json|```/g,"").trim());
        const rawItems=Array.isArray(parsed)?parsed:(parsed.clothing_items||parsed.items||[]);
        const items=rawItems.map(item=>{const key=(item.name||"").trim().toLowerCase();const known=knownItems[key];return known&&known.price?{...item,price:known.price}:item;});
        const style=parsed.style_category||parsed.style||null;
        const formalityLevel=parsed.formality_level||null;
        const season=parsed.season||null;
        const colorPalette=Array.isArray(parsed.color_palette)?parsed.color_palette:[];
        setPhotoData(p=>({...p,[dateKey]:{logged:true,photo:photoDataUrl,items,style,formalityLevel,season,colorPalette,analysing:false}}));
        setEditEntry({style,formalityLevel,season,items:items.map(item=>({...item}))});
        setEditMode(true);
      }catch{
        setPhotoData(p=>({...p,[dateKey]:{...p[dateKey],analysing:false}}));
        setEditEntry({style:null,formalityLevel:null,season:null,items:[]});
        setEditMode(true);
      }
    };
    r.readAsDataURL(file);
  };

  const renderMonth=(mIdx)=>{
    const year=today.getFullYear(),days=new Date(year,mIdx+1,0).getDate(),first=new Date(year,mIdx,1).getDay();
    const cells=[];
    for(let i=0;i<first;i++) cells.push(<div key={`e${i}`}/>);
    for(let d=1;d<=days;d++){
      const date=new Date(today.getFullYear(),mIdx,d),key=toKey(date);
      const isToday=date.toDateString()===today.toDateString(),hasPhoto=!!(photoData[key]?.logged);
      cells.push(<button key={d} onClick={()=>{ setSelectedDate(date); setShowModal(true); setEditMode(false); setEditEntry(null); setSelectedItemIdxs(new Set()); }} style={{ aspectRatio:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",border:"none",background:"transparent",cursor:"pointer",padding:0,gap:2 }}>
        <span style={{ width:30,height:30,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:isToday?700:hasPhoto?600:400,background:isToday?C.sage:"transparent",color:isToday?"#fff":hasPhoto?C.ink:C.sub }}>{d}</span>
        {hasPhoto&&!isToday&&<div style={{ width:5,height:5,borderRadius:"50%",background:C.green }}/>}
      </button>);
    }
    return cells;
  };

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
      <div style={{ background:`linear-gradient(145deg,${C.sage},${C.green})`,padding:"56px 20px 20px",flexShrink:0,borderRadius:"0 0 28px 28px",position:"relative" }}>
        {onBack&&<button onClick={onBack} style={{ position:"absolute",top:56,left:16,width:36,height:36,borderRadius:12,border:"none",background:"rgba(255,255,255,.2)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={20} color="#fff"/></button>}
        <h1 style={{ fontSize:28,fontWeight:800,color:"#fff",margin:"0 0 4px",paddingLeft:onBack?44:0 }}>Outfit Calendar</h1>
        <p style={{ fontSize:14,color:"rgba(255,255,255,.8)",margin:0 }}>Track your daily outfits</p>
      </div>
      <div style={{ flex:1,overflowY:"auto",padding:16,paddingBottom:32 }}>
        {months.map((name,mIdx)=>(
          <div key={mIdx} style={{ background:C.white,borderRadius:20,padding:16,marginBottom:14,border:`1px solid ${C.border}` }}>
            <h2 style={{ fontSize:17,fontWeight:700,color:C.ink,marginBottom:12 }}>{name} 2026</h2>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4 }}>
              {["S","M","T","W","T","F","S"].map((d,i)=><div key={i} style={{ display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:C.sub,height:24 }}>{d}</div>)}
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2 }}>{renderMonth(mIdx)}</div>
          </div>
        ))}
      </div>
      <Modal isOpen={showModal&&!!selectedDate} onClose={()=>{ setShowModal(false); setShowSourcePicker(false); setEditMode(false); setEditEntry(null); setSelectedItemIdxs(new Set()); }} title={selectedDate?selectedDate.toLocaleDateString("en-US",{ weekday:"long",month:"long",day:"numeric" }):""}>
        {selectedDate&&(()=>{
          const entry=photoData[toKey(selectedDate)];
          if(entry?.logged){
            const STYLES=["Everyday","Going Out","Activewear","Professional"];
            const FORMALITY=["Casual","Smart Casual","Formal","Sporty"];
            const SEASONS=["Spring","Summer","Autumn","Winter","All Season"];
            const CATS=["Top","Bottom","Outerwear","Shoes","Accessories","Dresses","Swimwear"];
            const COLORS=["Black","White","Blue","Gray","Brown","Green","Red","Yellow","Pink","Purple"];
            const catEmojis={ Top:"👕",Bottom:"👖",Outerwear:"🧥",Shoes:"👟",Accessories:"💍",Dresses:"👗",Swimwear:"👙",Other:"👔" };
            const ORDER=["Top","Bottom","Outerwear","Shoes","Accessories","Dresses","Swimwear"];

            // ── Edit mode ──
            if(editMode&&editEntry) {
              const updateItem=(i,key,val)=>setEditEntry(e=>{ const items=[...e.items]; items[i]={...items[i],[key]:val}; return {...e,items}; });
              const removeItem=(i)=>setEditEntry(e=>({...e,items:e.items.filter((_,idx)=>idx!==i)}));
              const addItem=()=>setEditEntry(e=>({...e,items:[...e.items,{category:"Top",name:"",color:"Black",_isNew:true}]}));
              const applyKnown=(i,nameVal)=>{ const key=nameVal.trim().toLowerCase(); if(!key||!knownItems[key]) return; setEditEntry(prev=>{ const items=[...prev.items]; const cur=items[i]; if(!cur._isNew) return prev; const known=knownItems[key]; items[i]={...cur,category:known.category,color:known.color,price:known.price!=null?known.price:cur.price,_isNew:false,_recognized:true}; return {...prev,items}; }); };
              const saveEdit=()=>{ const cleanItems=editEntry.items.map(({_isNew,_recognized,...rest})=>rest); setPhotoData(p=>({...p,[toKey(selectedDate)]:{...p[toKey(selectedDate)],style:editEntry.style,formalityLevel:editEntry.formalityLevel,season:editEntry.season,items:cleanItems}})); setEditMode(false); setEditEntry(null); };
              return (<>
                <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10 }}>Style</p>
                <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:16 }}>
                  {STYLES.map(s=><button key={s} onClick={()=>setEditEntry(e=>({...e,style:s}))} style={{ padding:"6px 14px",borderRadius:999,border:editEntry.style===s?"none":`1.5px solid ${C.border}`,background:editEntry.style===s?C.sage:C.white,color:editEntry.style===s?"#fff":C.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{s}</button>)}
                </div>
                <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10 }}>Formality</p>
                <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:16 }}>
                  {FORMALITY.map(f=><button key={f} onClick={()=>setEditEntry(e=>({...e,formalityLevel:f}))} style={{ padding:"6px 14px",borderRadius:999,border:editEntry.formalityLevel===f?"none":`1.5px solid ${C.border}`,background:editEntry.formalityLevel===f?"#7A6A9A":C.white,color:editEntry.formalityLevel===f?"#fff":C.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{f}</button>)}
                </div>
                <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10 }}>Season</p>
                <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:20 }}>
                  {SEASONS.map(s=><button key={s} onClick={()=>setEditEntry(e=>({...e,season:s}))} style={{ padding:"6px 14px",borderRadius:999,border:editEntry.season===s?"none":`1.5px solid ${C.border}`,background:editEntry.season===s?"#5A85C4":C.white,color:editEntry.season===s?"#fff":C.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{s}</button>)}
                </div>
                <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10 }}>Items</p>
                {editEntry.items.map((item,i)=>(
                  <div key={i} style={{ background:C.surface,borderRadius:14,padding:12,marginBottom:10,border:`1px solid ${C.border}` }}>
                    <div style={{ display:"flex",alignItems:"center",marginBottom:8,gap:8 }}>
                      <input value={item.name} onChange={e=>updateItem(i,"name",e.target.value)} onBlur={e=>applyKnown(i,e.target.value)} placeholder="Item name" style={{ flex:1,height:36,padding:"0 10px",borderRadius:10,border:`1.5px solid ${item._recognized?C.sage:C.border}`,background:C.white,fontSize:13,color:C.ink,outline:"none",fontFamily:"inherit" }}/>
                      <button onClick={()=>removeItem(i)} style={{ width:32,height:32,borderRadius:10,border:"none",background:"#FEF0EF",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0 }}><Trash2 size={14} color={C.red}/></button>
                    </div>
                    {item._recognized&&<div style={{ display:"flex",alignItems:"center",gap:4,marginBottom:8 }}><span style={{ fontSize:11,fontWeight:700,color:C.sage }}>✓ Recognised — details filled from previous log</span></div>}
                    <div style={{ display:"flex",gap:5,flexWrap:"wrap",marginBottom:8 }}>
                      {CATS.map(c=><button key={c} onClick={()=>updateItem(i,"category",c)} style={{ height:24,padding:"0 8px",borderRadius:999,border:"none",background:item.category===c?C.sage+"28":"transparent",color:item.category===c?C.sage:C.sub,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>{catEmojis[c]} {c}</button>)}
                    </div>
                    <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginBottom:8 }}>
                      {COLORS.map(col=><button key={col} onClick={()=>updateItem(i,"color",col)} title={col} style={{ width:22,height:22,borderRadius:"50%",border:item.color===col?`2.5px solid ${C.sage}`:col==="White"?`1.5px solid ${C.border}`:"none",background:colorHex[col],cursor:"pointer",padding:0,flexShrink:0 }}/>)}
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                      <span style={{ fontSize:12,fontWeight:700,color:C.sub }}>Price</span>
                      <div style={{ display:"flex",alignItems:"center",flex:1,height:34,borderRadius:10,border:`1.5px solid ${C.border}`,background:C.white,overflow:"hidden" }}>
                        <span style={{ padding:"0 8px",fontSize:13,color:C.sub,borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center" }}>£</span>
                        <input type="number" min="0" step="0.01" value={item.price||""} onChange={e=>updateItem(i,"price",e.target.value)} placeholder="0.00" style={{ flex:1,height:"100%",padding:"0 10px",border:"none",background:"transparent",fontSize:13,color:C.ink,outline:"none",fontFamily:"inherit" }}/>
                      </div>
                    </div>
                  </div>
                ))}
                <button onClick={addItem} style={{ width:"100%",height:44,borderRadius:14,border:`1.5px dashed ${C.border}`,background:"transparent",color:C.sub,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:16 }}><Plus size={16}/>Add Item</button>
                <PrimaryBtn onClick={saveEdit} style={{ marginBottom:10 }}>Save Changes</PrimaryBtn>
                <button onClick={()=>{ setEditMode(false); setEditEntry(null); }} style={{ width:"100%",height:48,borderRadius:16,border:"none",background:C.surface,color:C.sub,fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
              </>);
            }

            // ── View mode ──
            const grouped={};
            (entry.items||[]).forEach((item,idx)=>{ const obj=typeof item==="object"&&item?item:{ name:String(item||""),category:"Other" }; const cat=obj.category||"Other"; if(!grouped[cat]) grouped[cat]=[]; grouped[cat].push({...obj,_idx:idx}); });
            const cats=[...ORDER.filter(c=>grouped[c]),...Object.keys(grouped).filter(c=>!ORDER.includes(c))];
            const toggleItem=(idx)=>setSelectedItemIdxs(prev=>{ const next=new Set(prev); if(next.has(idx)) next.delete(idx); else next.add(idx); return next; });
            const removeSelected=()=>{ const newItems=(entry.items||[]).filter((_,i)=>!selectedItemIdxs.has(i)); setPhotoData(p=>({...p,[toKey(selectedDate)]:{...p[toKey(selectedDate)],items:newItems}})); setSelectedItemIdxs(new Set()); };
            return (<>
              {entry.photo?<div style={{ width:"100%",borderRadius:18,overflow:"hidden",marginBottom:entry.style?10:14,aspectRatio:"9/16" }}><img src={entry.photo} alt="Outfit" style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }}/></div>:<div style={{ background:C.sage+"14",borderRadius:16,padding:16,textAlign:"center",marginBottom:entry.style?10:14 }}><div style={{ fontSize:32 }}>👔</div><div style={{ fontSize:13,fontWeight:600,color:C.sage,marginTop:4 }}>Outfit logged</div></div>}
              {(entry.style||entry.formalityLevel||entry.season)&&<div style={{ display:"flex",justifyContent:"center",flexWrap:"wrap",gap:6,marginBottom:14 }}>{entry.style&&<span style={{ fontSize:12,fontWeight:700,color:C.sage,background:C.sage+"18",padding:"5px 14px",borderRadius:999,border:`1px solid ${C.sage}30` }}>{entry.style}</span>}{entry.formalityLevel&&<span style={{ fontSize:12,fontWeight:700,color:"#fff",background:"#7A6A9A",padding:"5px 14px",borderRadius:999 }}>{entry.formalityLevel}</span>}{entry.season&&<span style={{ fontSize:12,fontWeight:700,color:"#fff",background:"#5A85C4",padding:"5px 14px",borderRadius:999 }}>{entry.season}</span>}</div>}
              <div style={{ marginBottom:16 }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
                  <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",margin:0 }}>What I wore</p>
                  {selectedItemIdxs.size>0&&<button onClick={removeSelected} style={{ fontSize:12,fontWeight:700,color:C.red,background:"#FEF0EF",border:"none",borderRadius:999,padding:"4px 12px",cursor:"pointer",fontFamily:"inherit" }}>Remove {selectedItemIdxs.size} selected</button>}
                </div>
                {entry.analysing?(<div style={{background:C.surface,borderRadius:14,padding:20,display:"flex",flexDirection:"column",alignItems:"center",gap:10,border:`1px solid ${C.border}`}}><div style={{width:24,height:24,borderRadius:"50%",border:`2.5px solid ${C.sage}`,borderTopColor:"transparent",animation:"spin .7s linear infinite"}}/><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style><span style={{fontSize:13,color:C.sub,fontWeight:600}}>Analysing outfit with AI…</span></div>):cats.length>0?<div style={{ display:"flex",flexDirection:"column",gap:12 }}>{cats.map(cat=>(<div key={cat}><div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:6 }}><span style={{ fontSize:14 }}>{catEmojis[cat]||"👔"}</span><span style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em" }}>{cat}</span></div>{grouped[cat].map((item,i)=>{ const hex=item.color&&colorHex[item.color]?colorHex[item.color]:null; const isSel=selectedItemIdxs.has(item._idx); const isFav=favourites.some(f=>(f.name||"").trim().toLowerCase()===(item.name||"").trim().toLowerCase()); return <div key={i} style={{ width:"100%",background:isSel?C.sage+"14":C.surface,borderRadius:12,padding:"9px 12px",marginBottom:4,border:isSel?`1.5px solid ${C.sage}`:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:8 }}><div onClick={()=>toggleItem(item._idx)} style={{ width:18,height:18,borderRadius:"50%",border:isSel?"none":`1.5px solid ${C.border}`,background:isSel?C.sage:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer" }}>{isSel&&<span style={{ color:"#fff",fontSize:11,lineHeight:1 }}>✓</span>}</div>{hex&&<div style={{ width:12,height:12,borderRadius:"50%",background:hex,flexShrink:0,border:item.color==="White"?`1px solid ${C.border}`:"none" }}/>}<span onClick={()=>toggleItem(item._idx)} style={{ fontSize:13,color:C.ink,fontWeight:500,flex:1,cursor:"pointer" }}>{item.name||String(item)}</span>{item.color&&<span style={{ fontSize:11,color:C.sub }}>{item.color}</span>}<button onClick={e=>{ e.stopPropagation(); onToggleFavourite&&onToggleFavourite(item); }} style={{ background:"none",border:"none",cursor:"pointer",padding:4,flexShrink:0,display:"flex",alignItems:"center" }}><Heart size={16} color={isFav?C.red:"#ccc"} fill={isFav?C.red:"none"}/></button></div>; })}</div>))}</div>:<div style={{ background:C.surface,borderRadius:12,padding:"10px 14px",border:`1px solid ${C.border}` }}><span style={{ fontSize:13,color:C.sub }}>No items added yet — tap Edit Outfit to add what you wore</span></div>}
              </div>
              <button onClick={()=>{ setEditEntry({ style:entry.style||null, formalityLevel:entry.formalityLevel||null, season:entry.season||null, items:(entry.items||[]).map(item=>typeof item==="object"&&item?{...item}:{ name:String(item||""),category:"Other",color:null }) }); setEditMode(true); setSelectedItemIdxs(new Set()); }} style={{ width:"100%",height:50,borderRadius:16,border:`1.5px solid ${C.border}`,background:C.white,color:C.ink,fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:10 }}><Pencil size={16} color={C.sage}/>Edit Outfit</button>
              <DangerBtn onClick={()=>{ setPhotoData(p=>{ const n={...p}; delete n[toKey(selectedDate)]; return n; }); setShowModal(false); }}>Remove Outfit Log</DangerBtn>
            </>);
          }
          return (<>
            <div style={{ background:C.surface,borderRadius:16,padding:20,textAlign:"center",marginBottom:16 }}><Camera size={32} color={C.sub}/><div style={{ fontSize:14,color:C.sub,marginTop:8 }}>No outfit logged for this day</div></div>
            <PrimaryBtn onClick={()=>setShowSourcePicker(true)}><Camera size={16}/> Log Outfit</PrimaryBtn>
            {showSourcePicker&&<div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",flexDirection:"column",justifyContent:"flex-end" }} onClick={()=>setShowSourcePicker(false)}>
              <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:"28px 28px 0 0",padding:"8px 16px 40px" }}>
                <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
                <p style={{ fontSize:13,fontWeight:700,color:C.sub,textAlign:"center",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:16 }}>Add Outfit Photo</p>
                <label style={{ display:"block",cursor:"pointer" }}><input type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={e=>handlePhotoUpload(e.target.files[0])}/><div style={{ width:"100%",height:56,borderRadius:16,background:C.sage+"14",display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:10 }}><Camera size={20} color={C.sage}/><span style={{ fontSize:16,fontWeight:700,color:C.sage }}>Camera</span></div></label>
                <label style={{ display:"block",cursor:"pointer" }}><input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>handlePhotoUpload(e.target.files[0])}/><div style={{ width:"100%",height:56,borderRadius:16,background:C.surface,border:`1.5px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:10 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span style={{ fontSize:16,fontWeight:700,color:C.ink }}>Camera Roll</span></div></label>
                <button onClick={()=>setShowSourcePicker(false)} style={{ width:"100%",height:52,borderRadius:16,border:"none",background:C.surface,color:C.sub,fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
              </div>
            </div>}
          </>);
        })()}
      </Modal>
    </div>
  );
}

function FavoritesScreen({ onBack, favourites=[], setFavourites }) {
  const catEmoji=cat=>cat==="Top"?"👕":cat==="Bottom"?"👖":cat==="Shoes"?"👟":cat==="Outerwear"?"🧥":cat==="Accessories"?"💍":cat==="Dresses"?"👗":cat==="Swimwear"?"👙":"👔";
  const removeFav=(name)=>setFavourites(prev=>prev.filter(f=>(f.name||"").trim().toLowerCase()!==(name||"").trim().toLowerCase()));
  if(favourites.length===0) return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",background:C.surface }}>
      <div style={{ background:C.white,padding:"16px 20px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0 }}>
        {onBack&&<button onClick={onBack} style={{ width:36,height:36,borderRadius:12,border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={20} color={C.sage}/></button>}
        <h1 style={{ fontSize:22,fontWeight:800,color:C.ink,margin:0 }}>Favourites</h1>
      </div>
      <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24 }}>
        <div style={{ fontSize:52,marginBottom:16 }}>🤍</div>
        <h2 style={{ fontSize:20,fontWeight:700,color:C.ink,margin:"0 0 8px" }}>No Favourites Yet</h2>
        <p style={{ fontSize:14,color:C.sub,textAlign:"center",margin:0 }}>Tap the heart on any item in your calendar outfit log to save it here.</p>
      </div>
    </div>
  );
  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
      <div style={{ background:C.white,padding:"16px 20px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0 }}>
        {onBack&&<button onClick={onBack} style={{ width:36,height:36,borderRadius:12,border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={20} color={C.sage}/></button>}
        <h1 style={{ fontSize:22,fontWeight:800,color:C.ink,margin:0 }}>Favourites</h1>
        <span style={{ marginLeft:"auto",fontSize:13,fontWeight:700,color:C.sage,background:C.sage+"14",padding:"3px 10px",borderRadius:999 }}>{favourites.length} item{favourites.length!==1?"s":""}</span>
      </div>
      <div style={{ flex:1,overflowY:"auto",padding:16,paddingBottom:32 }}>
        {favourites.map((fav,i)=>{
          const hex=fav.color&&colorHex[fav.color]?colorHex[fav.color]:null;
          return (
            <div key={i} style={{ background:C.white,borderRadius:16,padding:"14px 16px",marginBottom:10,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12 }}>
              <div style={{ width:46,height:46,borderRadius:13,background:C.sage+"14",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0 }}>{catEmoji(fav.category)}</div>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ fontSize:15,fontWeight:700,color:C.ink,marginBottom:3 }}>{fav.name}</div>
                <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
                  <span style={{ fontSize:11,fontWeight:700,color:C.sage,background:C.sage+"14",padding:"2px 8px",borderRadius:999 }}>{fav.category}</span>
                  {hex&&<div style={{ display:"flex",alignItems:"center",gap:4 }}><div style={{ width:10,height:10,borderRadius:"50%",background:hex,border:fav.color==="White"?`1px solid ${C.border}`:"none" }}/><span style={{ fontSize:11,color:C.sub }}>{fav.color}</span></div>}
                  {fav.price&&<span style={{ fontSize:11,color:C.sub }}>£{fav.price}</span>}
                </div>
              </div>
              <button onClick={()=>removeFav(fav.name)} style={{ background:"none",border:"none",cursor:"pointer",padding:6,flexShrink:0 }}><Heart size={20} color={C.red} fill={C.red}/></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── helpers for localStorage user store ──────────────────────────────────
function getUsers() {
  try { return JSON.parse(localStorage.getItem("alfa_users") || "{}"); } catch { return {}; }
}
function saveUsers(users) {
  localStorage.setItem("alfa_users", JSON.stringify(users));
}
function getApiKey() { return localStorage.getItem("alfa_api_key")||""; }
function saveApiKey(key) { localStorage.setItem("alfa_api_key", key); }

function AuthScreen({ onAuth }) {
  const [view, setView] = useState("landing"); // "landing" | "signin" | "signup" | "forgot" | "forgot-sent"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoverEmail, setRecoverEmail] = useState("");
  const [error, setError] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  const inputStyle = { width:"100%",height:52,padding:"0 16px",borderRadius:14,border:`1.5px solid ${C.border}`,background:C.white,fontSize:15,color:C.ink,outline:"none",boxSizing:"border-box",fontFamily:"inherit" };
  const focusStyle = (e) => e.target.style.borderColor = C.sage;
  const blurStyle  = (e) => e.target.style.borderColor = C.border;

  const Logo = () => (
    <div style={{ width:72,height:72,borderRadius:24,background:`linear-gradient(145deg,${C.sage},${C.green})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,margin:"0 auto 20px",boxShadow:"0 8px 24px rgba(154,155,122,.35)" }}>👗</div>
  );

  const ErrorMsg = () => error ? (
    <div style={{ background:"#FEF0EF",border:"1px solid #F4C5C0",borderRadius:12,padding:"10px 14px",fontSize:13,color:"#C0392B",marginBottom:16,textAlign:"center" }}>{error}</div>
  ) : null;

  const handleSignIn = () => {
    setError("");
    if (!email || !password) { setError("Please fill in all fields."); return; }
    const users = getUsers();
    if (!users[email] || users[email].password !== password) {
      setError("Incorrect email or password."); return;
    }
    if (rememberMe) { localStorage.setItem("alfa_remember", email); } else { localStorage.removeItem("alfa_remember"); }
    onAuth(email, users[email].photoData||{}, users[email].favourites||[]);
  };

  const handleSignUp = () => {
    setError("");
    if (!email || !password || !confirmPassword) { setError("Please fill in all fields."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    const users = getUsers();
    if (users[email]) { setError("An account with this email already exists."); return; }
    users[email] = { password, photoData: {} };
    saveUsers(users);
    onAuth(email, {}, []);
  };

  // ── Landing ──────────────────────────────────────────────────────────────
  if (view === "landing") return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:C.surface,padding:32 }}>
      <Logo/>
      <h1 style={{ fontSize:28,fontWeight:800,color:C.ink,margin:"0 0 8px",textAlign:"center" }}>Outfit App</h1>
      <p style={{ fontSize:15,color:C.sub,margin:"0 0 40px",textAlign:"center" }}>Your personal style companion</p>
      <button onClick={()=>{ setError(""); setEmail(""); setPassword(""); setView("signin"); }} style={{ width:"100%",height:54,borderRadius:16,border:"none",background:`linear-gradient(135deg,${C.sage},${C.green})`,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:12,boxShadow:"0 4px 16px rgba(154,155,122,.4)" }}>Sign In</button>
      <button onClick={()=>{ setError(""); setEmail(""); setPassword(""); setConfirmPassword(""); setView("signup"); }} style={{ width:"100%",height:54,borderRadius:16,border:`2px solid ${C.sage}`,background:"transparent",color:C.sage,fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Sign Up</button>
    </div>
  );

  // ── Sign Up form ──────────────────────────────────────────────────────────
  if (view === "signup") return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",background:C.surface,padding:32,overflowY:"auto" }}>
      <button onClick={()=>setView("landing")} style={{ alignSelf:"flex-start",width:36,height:36,borderRadius:12,border:`1px solid ${C.border}`,background:C.white,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",marginBottom:28 }}><ChevronLeft size={20} color={C.ink}/></button>
      <Logo/>
      <h2 style={{ fontSize:24,fontWeight:800,color:C.ink,margin:"0 0 6px",textAlign:"center" }}>Create account</h2>
      <p style={{ fontSize:14,color:C.sub,margin:"0 0 24px",textAlign:"center" }}>Start tracking your outfits</p>

      <ErrorMsg/>

      <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",margin:"0 0 8px" }}>Email Address</p>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle}/>

      <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",margin:"18px 0 8px" }}>Password</p>
      <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle}/>

      <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",margin:"18px 0 8px" }}>Confirm Password</p>
      <input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="••••••••" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} onKeyDown={e=>e.key==="Enter"&&handleSignUp()}/>

      <button onClick={handleSignUp} style={{ width:"100%",height:54,borderRadius:16,border:"none",background:`linear-gradient(135deg,${C.sage},${C.green})`,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginTop:28,boxShadow:"0 4px 16px rgba(154,155,122,.4)" }}>Create Account</button>

      <p style={{ textAlign:"center",fontSize:14,color:C.sub,marginTop:20 }}>Already have an account? <button onClick={()=>{ setError(""); setView("signin"); }} style={{ background:"none",border:"none",color:C.sage,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"inherit" }}>Sign In</button></p>
    </div>
  );

  // ── Sign In form ──────────────────────────────────────────────────────────
  if (view === "signin") return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",background:C.surface,padding:32,overflowY:"auto" }}>
      <button onClick={()=>setView("landing")} style={{ alignSelf:"flex-start",width:36,height:36,borderRadius:12,border:`1px solid ${C.border}`,background:C.white,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",marginBottom:28,boxShadow:"0 1px 0 rgba(0,0,0,.06)" }}><ChevronLeft size={20} color={C.ink}/></button>
      <Logo/>
      <h2 style={{ fontSize:24,fontWeight:800,color:C.ink,margin:"0 0 6px",textAlign:"center" }}>Welcome back</h2>
      <p style={{ fontSize:14,color:C.sub,margin:"0 0 24px",textAlign:"center" }}>Sign in to your account</p>

      <ErrorMsg/>

      <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",margin:"0 0 8px" }}>Email Address</p>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle}/>

      <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",margin:"18px 0 8px" }}>Password</p>
      <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} onKeyDown={e=>e.key==="Enter"&&handleSignIn()}/>

      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:14,marginBottom:4 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10,cursor:"pointer" }} onClick={()=>setRememberMe(r=>!r)}>
          <div style={{ width:20,height:20,borderRadius:5,border:`2px solid ${rememberMe?C.sage:C.border}`,background:rememberMe?C.sage:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .15s" }}>
            {rememberMe&&<Check size={12} color="#fff" strokeWidth={3}/>}
          </div>
          <span style={{ fontSize:14,color:C.ink,fontWeight:500 }}>Remember Me</span>
        </div>
        <button onClick={()=>setView("forgot")} style={{ background:"none",border:"none",color:C.sage,fontSize:13,fontWeight:600,cursor:"pointer",padding:"8px 0",fontFamily:"inherit" }}>Forgot password?</button>
      </div>

      <button onClick={handleSignIn} style={{ width:"100%",height:54,borderRadius:16,border:"none",background:`linear-gradient(135deg,${C.sage},${C.green})`,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 16px rgba(154,155,122,.4)" }}>Sign In</button>

      <p style={{ textAlign:"center",fontSize:14,color:C.sub,marginTop:20 }}>Don't have an account? <button onClick={()=>{ setError(""); setEmail(""); setPassword(""); setConfirmPassword(""); setView("signup"); }} style={{ background:"none",border:"none",color:C.sage,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"inherit" }}>Sign Up</button></p>
    </div>
  );

  // ── Forgot password ───────────────────────────────────────────────────────
  if (view === "forgot") return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",background:C.surface,padding:32,overflowY:"auto" }}>
      <button onClick={()=>setView("signin")} style={{ alignSelf:"flex-start",width:36,height:36,borderRadius:12,border:`1px solid ${C.border}`,background:C.white,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",marginBottom:28 }}><ChevronLeft size={20} color={C.ink}/></button>
      <div style={{ width:72,height:72,borderRadius:24,background:"#FEF0EF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 20px" }}>🔑</div>
      <h2 style={{ fontSize:24,fontWeight:800,color:C.ink,margin:"0 0 6px",textAlign:"center" }}>Forgot Password?</h2>
      <p style={{ fontSize:14,color:C.sub,margin:"0 0 28px",textAlign:"center" }}>Enter your email and we'll send you a link to reset your password.</p>

      <p style={{ fontSize:12,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",margin:"0 0 8px" }}>Email Address</p>
      <input type="email" value={recoverEmail} onChange={e=>setRecoverEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle}/>

      <button onClick={()=>{ if(recoverEmail) setView("forgot-sent"); }} style={{ width:"100%",height:54,borderRadius:16,border:"none",background:recoverEmail?`linear-gradient(135deg,${C.sage},${C.green})`:C.border,color:recoverEmail?"#fff":C.sub,fontSize:16,fontWeight:700,cursor:recoverEmail?"pointer":"not-allowed",fontFamily:"inherit",marginTop:24,boxShadow:recoverEmail?"0 4px 16px rgba(154,155,122,.4)":"none" }}>Recover Password</button>
    </div>
  );

  // ── Forgot password — sent confirmation ───────────────────────────────────
  if (view === "forgot-sent") return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:C.surface,padding:32 }}>
      <div style={{ width:80,height:80,borderRadius:28,background:`${C.sage}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:40,marginBottom:24 }}>📬</div>
      <h2 style={{ fontSize:24,fontWeight:800,color:C.ink,margin:"0 0 10px",textAlign:"center" }}>Check your email</h2>
      <p style={{ fontSize:15,color:C.sub,margin:"0 0 8px",textAlign:"center" }}>We sent a password reset link to</p>
      <p style={{ fontSize:15,fontWeight:700,color:C.ink,margin:"0 0 36px",textAlign:"center" }}>{recoverEmail}</p>
      <button onClick={()=>setView("signin")} style={{ width:"100%",height:54,borderRadius:16,border:"none",background:`linear-gradient(135deg,${C.sage},${C.green})`,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 16px rgba(154,155,122,.4)" }}>Back to Sign In</button>
    </div>
  );
}

function ProfileScreen({ onSettings, onNotifications, onBack, onSignOut }) {
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
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
      {/* Hidden file inputs */}
      <input ref={galleryRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e=>handleImageFile(e.target.files[0])}/>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={e=>handleImageFile(e.target.files[0])}/>

      {/* Sign out confirmation bottom sheet */}
      {showSignOutConfirm && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"flex-end" }} onClick={()=>setShowSignOutConfirm(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:"28px 28px 0 0",width:"100%",padding:"8px 20px 44px" }}>
            <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
            <div style={{ textAlign:"center",marginBottom:24 }}>
              <div style={{ width:56,height:56,borderRadius:20,background:"#FEF0EF",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px" }}><LogOut size={24} color={C.red}/></div>
              <h2 style={{ fontSize:20,fontWeight:800,color:C.ink,margin:"0 0 6px" }}>Are you sure?</h2>
              <p style={{ fontSize:14,color:C.sub,margin:0 }}>You will be signed out of your account.</p>
            </div>
            <button onClick={onSignOut} style={{ width:"100%",height:54,borderRadius:16,border:"none",background:C.red,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}><LogOut size={18}/>Sign Out</button>
            <button onClick={()=>setShowSignOutConfirm(false)} style={{ width:"100%",height:54,borderRadius:16,border:`1.5px solid ${C.border}`,background:"transparent",color:C.ink,fontSize:16,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Image source picker bottom sheet */}
      {showPicker && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"flex-end" }} onClick={()=>setShowPicker(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:"28px 28px 0 0",width:"100%",padding:"8px 20px 44px" }}>
            <div style={{ width:36,height:4,borderRadius:99,background:C.border,margin:"8px auto 20px" }}/>
            <h2 style={{ fontSize:20,fontWeight:800,color:C.ink,margin:"0 0 20px" }}>Change Profile Photo</h2>
            <button onClick={()=>{ setShowPicker(false); setTimeout(()=>galleryRef.current?.click(),100); }} style={{ width:"100%",height:56,borderRadius:16,border:`1px solid ${C.border}`,background:C.surface,color:C.ink,fontSize:16,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:14,padding:"0 18px",fontFamily:"inherit",marginBottom:12 }}>
              <div style={{ width:40,height:40,borderRadius:12,background:C.sage+"18",display:"flex",alignItems:"center",justifyContent:"center" }}><Camera size={20} color={C.sage}/></div>
              Camera Roll
            </button>
            <button onClick={()=>{ setShowPicker(false); setTimeout(()=>cameraRef.current?.click(),100); }} style={{ width:"100%",height:56,borderRadius:16,border:`1px solid ${C.border}`,background:C.surface,color:C.ink,fontSize:16,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:14,padding:"0 18px",fontFamily:"inherit",marginBottom:12 }}>
              <div style={{ width:40,height:40,borderRadius:12,background:C.green+"18",display:"flex",alignItems:"center",justifyContent:"center" }}><Camera size={20} color={C.green}/></div>
              Camera
            </button>
            <button onClick={()=>setShowPicker(false)} style={{ width:"100%",height:52,borderRadius:16,border:"none",background:C.border,color:C.sub,fontSize:16,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ background:`linear-gradient(145deg,${C.sage},${C.green})`,padding:"56px 20px 24px",flexShrink:0,borderRadius:"0 0 28px 28px",textAlign:"center",position:"relative" }}>
        {onBack&&<button onClick={onBack} style={{ position:"absolute",top:56,left:16,width:36,height:36,borderRadius:12,border:"none",background:"rgba(255,255,255,.2)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={20} color="#fff"/></button>}
        {/* Tappable profile photo */}
        <button onClick={()=>setShowPicker(true)} style={{ width:80,height:80,borderRadius:"50%",background:"rgba(255,255,255,.2)",margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,border:"3px solid rgba(255,255,255,.5)",cursor:"pointer",padding:0,overflow:"hidden",position:"relative" }}>
          {profileImage
            ? <img src={profileImage} alt="Profile" style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }}/>
            : <span>👤</span>
          }
          {/* Camera badge */}
          <div style={{ position:"absolute",bottom:0,right:0,width:24,height:24,borderRadius:"50%",background:C.white,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 1px 4px rgba(0,0,0,.2)" }}>
            <Camera size={12} color={C.sage}/>
          </div>
        </button>
        <h1 style={{ fontSize:22,fontWeight:800,color:"#fff",margin:"0 0 4px" }}>My Wardrobe</h1>
        <p style={{ fontSize:14,color:"rgba(255,255,255,.8)",margin:0 }}>Style enthusiast</p>
      </div>
      <div style={{ flex:1,overflowY:"auto",padding:16,paddingBottom:32 }}>
        {[{ icon:<Bell size={18} color={C.sage}/>,label:"Notifications",sub:"Push alerts",action:onNotifications },{ icon:<Shield size={18} color={C.sage}/>,label:"Privacy",sub:"Data & permissions" },{ icon:<Phone size={18} color={C.sage}/>,label:"Settings",sub:"App preferences",action:onSettings }].map((item,i)=>(
          <button key={i} onClick={item.action} style={{ width:"100%",background:C.white,borderRadius:18,padding:"14px 16px",marginBottom:10,border:`1px solid ${C.border}`,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,fontFamily:"inherit" }}>
            <div style={{ width:40,height:40,borderRadius:12,background:C.sage+"14",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>{item.icon}</div>
            <div style={{ flex:1 }}><div style={{ fontSize:15,fontWeight:600,color:C.ink }}>{item.label}</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>{item.sub}</div></div>
            <ChevronRight size={18} color={C.border}/>
          </button>
        ))}
        <button onClick={()=>setShowSignOutConfirm(true)} style={{ width:"100%",height:52,borderRadius:16,border:"none",background:"#FEF0EF",color:C.red,fontSize:15,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"inherit",marginTop:8 }}><LogOut size={18}/> Sign Out</button>
      </div>
    </div>
  );
}

function SettingsScreen({ onBack }) {
  const [apiKey,setApiKey]=useState(getApiKey());
  const [saved,setSaved]=useState(false);
  const handleSave=()=>{ saveApiKey(apiKey.trim()); setSaved(true); setTimeout(()=>setSaved(false),2000); };
  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
      <div style={{ background:C.white,padding:"16px 20px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0 }}><button onClick={onBack} style={{ width:36,height:36,borderRadius:12,border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={20} color={C.sage}/></button><h1 style={{ fontSize:22,fontWeight:800,color:C.ink,margin:0 }}>Settings</h1></div>
      <div style={{ flex:1,overflowY:"auto",padding:16 }}>
        <div style={{ background:C.white,borderRadius:16,padding:16,marginBottom:16,border:`1px solid ${C.border}` }}>
          <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",margin:"0 0 6px" }}>AI Photo Analysis</p>
          <p style={{ fontSize:12,color:C.sub,margin:"0 0 12px",lineHeight:1.5 }}>Enter your Anthropic API key to enable automatic outfit detection when you upload photos. Get a free key at console.anthropic.com</p>
          <input value={apiKey} onChange={e=>{ setApiKey(e.target.value); setSaved(false); }} placeholder="sk-ant-..." type="password" style={{ width:"100%",height:40,padding:"0 12px",borderRadius:10,border:`1.5px solid ${C.border}`,background:C.surface,fontSize:13,color:C.ink,outline:"none",fontFamily:"inherit",boxSizing:"border-box",marginBottom:10 }}/>
          <button onClick={handleSave} style={{ width:"100%",height:42,borderRadius:12,border:"none",background:saved?C.sage:C.ink,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>{saved?"✓ Saved":"Save API Key"}</button>
        </div>
      </div>
    </div>
  );
}

function NotificationsScreen({ onBack }) {
  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
      <div style={{ background:C.white,padding:"16px 20px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0 }}><button onClick={onBack} style={{ width:36,height:36,borderRadius:12,border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={20} color={C.sage}/></button><h1 style={{ fontSize:22,fontWeight:800,color:C.ink,margin:0 }}>Notifications</h1></div>
      <div style={{ flex:1,overflowY:"auto",padding:16 }}>
        {["Outfit of the Day","Weekly Insights","New Features","Seasonal Trends"].map((n,i)=>(
          <div key={i} style={{ background:C.white,borderRadius:16,padding:"14px 16px",marginBottom:10,display:"flex",alignItems:"center",justifyContent:"space-between",border:`1px solid ${C.border}` }}>
            <div><div style={{ fontSize:15,fontWeight:600,color:C.ink }}>{n}</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>Push notification</div></div>
            <div style={{ width:44,height:26,borderRadius:999,background:i<2?C.sage:C.border,position:"relative" }}><div style={{ position:"absolute",top:3,left:i<2?21:3,width:20,height:20,borderRadius:"50%",background:"#fff" }}/></div>
          </div>
        ))}
      </div>
    </div>
  );
}


function AddItemScreen({ onBack, photoData={}, setPhotoData }) {
  const [step,setStep]=useState("pick"); // pick | analysing | edit | done
  const [photo,setPhoto]=useState(null);
  const [editEntry,setEditEntry]=useState({style:null,formalityLevel:null,season:null,items:[]});
  const today=new Date();
  const todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const STYLES=["Everyday","Going Out","Activewear","Professional"];
  const FORMALITY=["Casual","Smart Casual","Formal","Sporty"];
  const SEASONS=["Spring","Summer","Autumn","Winter","All Season"];
  const CATS=["Top","Bottom","Outerwear","Shoes","Accessories","Dresses","Swimwear"];
  const COLORS=["Black","White","Blue","Gray","Brown","Green","Red","Yellow","Pink","Purple"];
  const catEmojis={Top:"👕",Bottom:"👖",Outerwear:"🧥",Shoes:"👟",Accessories:"💍",Dresses:"👗",Swimwear:"👙",Other:"👔"};

  // Build known items from all previously logged outfits
  const knownItems={};
  Object.values(photoData).forEach(e=>{ if(!e?.logged) return; (e.items||[]).forEach(item=>{ if(!item||typeof item!=="object") return; const name=(item.name||"").trim().toLowerCase(); if(!name) return; if(!knownItems[name]) knownItems[name]={category:item.category||"Top",color:item.color||"Black",price:null}; if(item.category&&item.category!=="Other") knownItems[name].category=item.category; if(item.color) knownItems[name].color=item.color; const p=parseFloat(item.price); if(!isNaN(p)&&p>0) knownItems[name].price=String(p); }); });

  const handleFile=(file)=>{
    if(!file) return;
    const r=new FileReader();
    r.onload=async(ev)=>{
      const photoDataUrl=ev.target.result;
      const base64=photoDataUrl.split(",")[1];
      setPhoto(photoDataUrl);
      setStep("analysing");
      const apiKey=getApiKey();
      if(!apiKey){ setEditEntry({style:null,formalityLevel:null,season:null,items:[]}); setStep("edit"); return; }
      try{
        const knownList=Object.entries(knownItems).map(([name,v])=>`- "${name}" (${v.category}, ${v.color})`).join("\n");
        const schema=`{"style_category":"Everyday|Going Out|Activewear|Professional","formality_level":"Casual|Smart Casual|Formal|Sporty","season":"Spring|Summer|Autumn|Winter|All Season","color_palette":["dominant colour","secondary colour"],"clothing_items":[{"category":"Top|Bottom|Outerwear|Shoes|Accessories|Dresses|Swimwear","name":"item name","color":"Black|White|Blue|Gray|Brown|Green|Red|Yellow|Pink|Purple"}]}`;
        const prompt=knownList
          ?`Analyse this outfit image. Previously logged items:\n${knownList}\n\nIf any item is the same piece, use EXACT name.\n\nReturn ONLY valid JSON, no markdown:\n${schema}`
          :`Analyse this outfit image and return ONLY valid JSON, no markdown:\n${schema}`;
        const response=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:file.type,data:base64}},{type:"text",text:prompt}]}]})});
        const data=await response.json();
        const text=data.content?.map(b=>b.text||"").join("")||"{}";
        const parsed=JSON.parse(text.replace(/```json|```/g,"").trim());
        const rawItems=Array.isArray(parsed)?parsed:(parsed.clothing_items||parsed.items||[]);
        const items=rawItems.map(item=>{ const key=(item.name||"").trim().toLowerCase(); const known=knownItems[key]; return known&&known.price?{...item,price:known.price}:item; });
        const style=parsed.style_category||parsed.style||null;
        const formalityLevel=parsed.formality_level||null;
        const season=parsed.season||null;
        setEditEntry({style,formalityLevel,season,items});
      }catch{ setEditEntry({style:null,formalityLevel:null,season:null,items:[]}); }
      setStep("edit");
    };
    r.readAsDataURL(file);
  };

  const updateItem=(i,key,val)=>setEditEntry(e=>{ const items=[...e.items]; items[i]={...items[i],[key]:val}; return {...e,items}; });
  const removeItem=(i)=>setEditEntry(e=>({...e,items:e.items.filter((_,idx)=>idx!==i)}));
  const addItem=()=>setEditEntry(e=>({...e,items:[...e.items,{category:"Top",name:"",color:"Black",_isNew:true}]}));
  const applyKnown=(i,nameVal)=>{ const key=nameVal.trim().toLowerCase(); if(!key||!knownItems[key]) return; setEditEntry(prev=>{ const items=[...prev.items]; const cur=items[i]; if(!cur._isNew) return prev; const known=knownItems[key]; items[i]={...cur,category:known.category,color:known.color,price:known.price!=null?known.price:cur.price,_isNew:false,_recognized:true}; return {...prev,items}; }); };
  const handleSave=()=>{ const cleanItems=editEntry.items.map(({_isNew,_recognized,...rest})=>rest); setPhotoData(p=>({...p,[todayKey]:{logged:true,photo,items:cleanItems,style:editEntry.style,formalityLevel:editEntry.formalityLevel,season:editEntry.season}})); setStep("done"); };

  return (
    <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.surface }}>
      <div style={{ background:C.white,padding:"16px 20px 14px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0 }}>
        <button onClick={step==="done"?onBack:step==="edit"?()=>setStep("pick"):onBack} style={{ width:36,height:36,borderRadius:12,border:"none",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><ChevronLeft size={20} color={C.sage}/></button>
        <div>
          <h1 style={{ fontSize:20,fontWeight:800,color:C.ink,margin:0 }}>Log Today's Outfit</h1>
          <p style={{ fontSize:11,color:C.sub,margin:0 }}>{step==="pick"?"Upload a photo to get started":step==="analysing"?"Analysing with AI…":step==="edit"?"Review and edit detected items":"Outfit logged!"}</p>
        </div>
      </div>
      <div style={{ flex:1,overflowY:"auto",padding:16,paddingBottom:32 }}>

        {step==="pick"&&(
          <div style={{ background:C.white,borderRadius:20,overflow:"hidden",border:`1px solid ${C.border}` }}>
            <div style={{ height:140,background:`linear-gradient(145deg,${C.sage}22,${C.green}44)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:56 }}>📸</div>
            <div style={{ padding:16 }}>
              <h3 style={{ fontSize:16,fontWeight:700,color:C.ink,margin:"0 0 6px" }}>Upload outfit photo</h3>
              <p style={{ fontSize:13,color:C.sub,margin:"0 0 14px" }}>AI detects items, colours and style — and recognises pieces you've worn before</p>
              <label style={{ display:"block",cursor:"pointer",marginBottom:10 }}><input type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={e=>handleFile(e.target.files[0])}/><div style={{ width:"100%",height:48,borderRadius:14,background:C.sage,display:"flex",alignItems:"center",justifyContent:"center",gap:10 }}><Camera size={18} color="#fff"/><span style={{ fontSize:14,fontWeight:700,color:"#fff" }}>Open Camera</span></div></label>
              <label style={{ display:"block",cursor:"pointer" }}><input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>handleFile(e.target.files[0])}/><div style={{ width:"100%",height:48,borderRadius:14,border:`1.5px solid ${C.border}`,background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",gap:10 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span style={{ fontSize:14,fontWeight:700,color:C.ink }}>Choose from Library</span></div></label>
            </div>
          </div>
        )}

        {step==="analysing"&&(
          <>
            {photo&&<div style={{ width:"100%",borderRadius:18,overflow:"hidden",marginBottom:14,aspectRatio:"9/16" }}><img src={photo} alt="Outfit" style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }}/></div>}
            <div style={{ background:C.white,borderRadius:18,padding:20,display:"flex",alignItems:"center",gap:14,border:`1px solid ${C.border}` }}>
              <div style={{ width:24,height:24,borderRadius:"50%",border:`3px solid ${C.sage}`,borderTopColor:"transparent",animation:"spin .7s linear infinite",flexShrink:0 }}/><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              <div><div style={{ fontSize:14,fontWeight:700,color:C.ink }}>Analysing with AI…</div><div style={{ fontSize:12,color:C.sub,marginTop:2 }}>Detecting items and matching your wardrobe</div></div>
            </div>
          </>
        )}

        {step==="edit"&&(
          <>
            {photo&&<div style={{ width:"100%",borderRadius:18,overflow:"hidden",marginBottom:16,aspectRatio:"9/16" }}><img src={photo} alt="Outfit" style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }}/></div>}
            <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10 }}>Style</p>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:20 }}>
              {STYLES.map(s=><button key={s} onClick={()=>setEditEntry(e=>({...e,style:s}))} style={{ padding:"6px 14px",borderRadius:999,border:editEntry.style===s?"none":`1.5px solid ${C.border}`,background:editEntry.style===s?C.sage:C.white,color:editEntry.style===s?"#fff":C.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{s}</button>)}
            </div>
            <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10 }}>Formality</p>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:20 }}>
              {FORMALITY.map(f=><button key={f} onClick={()=>setEditEntry(e=>({...e,formalityLevel:f}))} style={{ padding:"6px 14px",borderRadius:999,border:editEntry.formalityLevel===f?"none":`1.5px solid ${C.border}`,background:editEntry.formalityLevel===f?"#7A6A9A":C.white,color:editEntry.formalityLevel===f?"#fff":C.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{f}</button>)}
            </div>
            <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10 }}>Season</p>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:20 }}>
              {SEASONS.map(s=><button key={s} onClick={()=>setEditEntry(e=>({...e,season:s}))} style={{ padding:"6px 14px",borderRadius:999,border:editEntry.season===s?"none":`1.5px solid ${C.border}`,background:editEntry.season===s?"#5A85C4":C.white,color:editEntry.season===s?"#fff":C.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>{s}</button>)}
            </div>
            <p style={{ fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10 }}>Items</p>
            {editEntry.items.map((item,i)=>(
              <div key={i} style={{ background:C.surface,borderRadius:14,padding:12,marginBottom:10,border:`1px solid ${C.border}` }}>
                <div style={{ display:"flex",alignItems:"center",marginBottom:8,gap:8 }}>
                  <input value={item.name} onChange={e=>updateItem(i,"name",e.target.value)} onBlur={e=>applyKnown(i,e.target.value)} placeholder="Item name" style={{ flex:1,height:36,padding:"0 10px",borderRadius:10,border:`1.5px solid ${item._recognized?C.sage:C.border}`,background:C.white,fontSize:13,color:C.ink,outline:"none",fontFamily:"inherit" }}/>
                  <button onClick={()=>removeItem(i)} style={{ width:32,height:32,borderRadius:10,border:"none",background:"#FEF0EF",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0 }}><Trash2 size={14} color={C.red}/></button>
                </div>
                {item._recognized&&<div style={{ marginBottom:8 }}><span style={{ fontSize:11,fontWeight:700,color:C.sage }}>✓ Recognised — details filled from previous log</span></div>}
                <div style={{ display:"flex",gap:5,flexWrap:"wrap",marginBottom:8 }}>{CATS.map(c=><button key={c} onClick={()=>updateItem(i,"category",c)} style={{ height:24,padding:"0 8px",borderRadius:999,border:"none",background:item.category===c?C.sage+"28":"transparent",color:item.category===c?C.sage:C.sub,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>{catEmojis[c]} {c}</button>)}</div>
                <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginBottom:8 }}>{COLORS.map(col=><button key={col} onClick={()=>updateItem(i,"color",col)} title={col} style={{ width:22,height:22,borderRadius:"50%",border:item.color===col?`2.5px solid ${C.sage}`:col==="White"?`1.5px solid ${C.border}`:"none",background:colorHex[col],cursor:"pointer",padding:0,flexShrink:0 }}/>)}</div>
                <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                  <span style={{ fontSize:12,fontWeight:700,color:C.sub }}>Price</span>
                  <div style={{ display:"flex",alignItems:"center",flex:1,height:34,borderRadius:10,border:`1.5px solid ${C.border}`,background:C.white,overflow:"hidden" }}>
                    <span style={{ padding:"0 8px",fontSize:13,color:C.sub,borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center" }}>£</span>
                    <input type="number" min="0" step="0.01" value={item.price||""} onChange={e=>updateItem(i,"price",e.target.value)} placeholder="0.00" style={{ flex:1,height:"100%",padding:"0 10px",border:"none",background:"transparent",fontSize:13,color:C.ink,outline:"none",fontFamily:"inherit" }}/>
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addItem} style={{ width:"100%",height:44,borderRadius:14,border:`1.5px dashed ${C.border}`,background:"transparent",color:C.sub,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:16 }}><Plus size={16}/>Add Item</button>
            <button onClick={handleSave} style={{ width:"100%",height:52,borderRadius:16,border:"none",background:C.sage,color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}><Check size={18}/>Save to Today</button>
          </>
        )}

        {step==="done"&&(
          <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:16,paddingTop:60 }}>
            <div style={{ width:80,height:80,borderRadius:"50%",background:C.sage+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:40 }}>✅</div>
            <h2 style={{ fontSize:22,fontWeight:800,color:C.ink,margin:0,textAlign:"center" }}>Outfit Logged!</h2>
            <p style={{ fontSize:14,color:C.sub,margin:0,textAlign:"center" }}>Saved to today on the calendar. All wardrobe analytics updated.</p>
            <button onClick={()=>{ setStep("pick"); setPhoto(null); setEditEntry({style:null,formalityLevel:null,season:null,items:[]}); }} style={{ marginTop:8,height:48,padding:"0 28px",borderRadius:16,border:"none",background:C.sage,color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>Log Another</button>
            <button onClick={onBack} style={{ height:48,padding:"0 28px",borderRadius:16,border:`1.5px solid ${C.border}`,background:"transparent",color:C.sub,fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>Back to Home</button>
          </div>
        )}

      </div>
    </div>
  );
}

export default function App() {
  const [isSignedIn,setIsSignedIn]=useState(()=>{ const e=localStorage.getItem("alfa_remember"); if(!e) return false; return !!getUsers()[e]; });
  const [currentUser,setCurrentUser]=useState(()=>{ const e=localStorage.getItem("alfa_remember"); if(!e) return null; return getUsers()[e]?e:null; });
  const [tab,setTab]=useState("home");
  const [subScreen,setSubScreen]=useState(null);
  const [photoData,setPhotoData]=useState(()=>{ const e=localStorage.getItem("alfa_remember"); if(!e) return {}; return getUsers()[e]?.photoData||{}; });
  const [favourites,setFavourites]=useState(()=>{ const e=localStorage.getItem("alfa_remember"); if(!e) return []; return getUsers()[e]?.favourites||[]; });
  const [tabHistory,setTabHistory]=useState([]);

  // Auto-save photoData and favourites to localStorage whenever they change
  useEffect(()=>{
    if(!currentUser) return;
    const users=getUsers();
    if(users[currentUser]){
      users[currentUser].photoData=photoData;
      saveUsers(users);
    }
  },[photoData,currentUser]);
  useEffect(()=>{
    if(!currentUser) return;
    const users=getUsers();
    if(users[currentUser]){
      users[currentUser].favourites=favourites;
      saveUsers(users);
    }
  },[favourites,currentUser]);

  const toggleFavourite=(item)=>{
    const key=(item.name||"").trim().toLowerCase();
    setFavourites(prev=>{
      const exists=prev.some(f=>(f.name||"").trim().toLowerCase()===key);
      if(exists) return prev.filter(f=>(f.name||"").trim().toLowerCase()!==key);
      return [...prev,{name:item.name,category:item.category||"Other",color:item.color||null,price:item.price||null}];
    });
  };

  const navigateTo=(newTab)=>{
    setTabHistory(h=>[...h,tab]);
    setTab(newTab);
    setSubScreen(null);
  };
  const goBack=()=>{
    if(subScreen){ setSubScreen(null); return; }
    if(tabHistory.length>0){
      const prev=tabHistory[tabHistory.length-1];
      setTabHistory(h=>h.slice(0,-1));
      setTab(prev);
    }
  };
  const canGoBack = subScreen!==null || tabHistory.length>0;

  const renderContent=()=>{
    if(subScreen==="addItem") return <AddItemScreen onBack={goBack} photoData={photoData} setPhotoData={setPhotoData}/>;
    if(subScreen==="settings") return <SettingsScreen onBack={goBack}/>;
    if(subScreen==="allItems") return <AllItemsScreen onBack={goBack}/>;
    if(subScreen==="notifications") return <NotificationsScreen onBack={goBack}/>;
    switch(tab){
      case "home":      return <HomeScreen photoData={photoData} onShowAllItems={()=>setSubScreen("allItems")} onGoToFavorites={()=>navigateTo("favorites")} onAddItem={()=>setSubScreen("addItem")}/>;
      case "wardrobe":  return <WardrobeScreen photoData={photoData} onBack={canGoBack?goBack:null}/>;
      case "calendar":  return <CalendarScreen photoData={photoData} setPhotoData={setPhotoData} favourites={favourites} onToggleFavourite={toggleFavourite} onBack={canGoBack?goBack:null}/>;
      case "favorites": return <FavoritesScreen favourites={favourites} setFavourites={setFavourites} onBack={canGoBack?goBack:null}/>;
      case "profile":   return <ProfileScreen onSettings={()=>setSubScreen("settings")} onNotifications={()=>setSubScreen("notifications")} onBack={canGoBack?goBack:null} onSignOut={()=>{ localStorage.removeItem("alfa_remember"); setIsSignedIn(false); setCurrentUser(null); setPhotoData({}); setFavourites([]); setTab("home"); setSubScreen(null); setTabHistory([]); }}/>;
      default:          return <HomeScreen photoData={photoData} onShowAllItems={()=>setSubScreen("allItems")} onGoToFavorites={()=>navigateTo("favorites")} onAddItem={()=>setSubScreen("addItem")}/>;
    }
  };

  return (
    <>
      <style>{`*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',system-ui,sans-serif;background:#1a1a2e;min-height:100vh;display:flex;align-items:center;justify-content:center}@keyframes slideUp{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}::-webkit-scrollbar{display:none}`}</style>
      <div style={{ position:"fixed",inset:0,zIndex:0,background:"linear-gradient(135deg,#1a1a2e 0%,#2d2d44 40%,#1e3a2f 100%)" }}>
        <div style={{ position:"absolute",inset:0,backgroundImage:"radial-gradient(circle,rgba(154,155,122,.15) 1px,transparent 1px)",backgroundSize:"32px 32px" }}/>
      </div>
      <div style={{ position:"relative",zIndex:1,width:281,height:640,flexShrink:0 }}>
      <div style={{ position:"absolute",top:0,left:0,width:390,background:"#0a0a0a",borderRadius:55,padding:"12px 5px",boxShadow:"0 0 0 1px #333,0 0 0 3px #1a1a1a,0 24px 80px rgba(0,0,0,.8),inset 0 0 0 1px rgba(255,255,255,.08)",transform:"scale(0.72)",transformOrigin:"top left" }}>
        <div style={{ position:"absolute",left:-3,top:140,width:3,height:36,background:"#222",borderRadius:"3px 0 0 3px" }}/>
        <div style={{ position:"absolute",left:-3,top:185,width:3,height:68,background:"#222",borderRadius:"3px 0 0 3px" }}/>
        <div style={{ position:"absolute",left:-3,top:265,width:3,height:68,background:"#222",borderRadius:"3px 0 0 3px" }}/>
        <div style={{ position:"absolute",right:-3,top:194,width:3,height:82,background:"#222",borderRadius:"0 3px 3px 0" }}/>
        <div style={{ borderRadius:50,overflow:"hidden",height:844,position:"relative",background:C.surface }}>
          <div style={{ position:"absolute",top:12,left:"50%",transform:"translateX(-50%)",width:120,height:34,background:"#0a0a0a",borderRadius:999,zIndex:100 }}/>
          <div style={{ position:"absolute",top:0,left:0,right:0,height:54,display:"flex",alignItems:"flex-end",justifyContent:"space-between",padding:"0 28px 6px",zIndex:99,pointerEvents:"none" }}>
            <span style={{ fontSize:15,fontWeight:700,color:C.ink }}>9:41</span>
            <div style={{ display:"flex",alignItems:"center",gap:6 }}>
              <div style={{ display:"flex",alignItems:"flex-end",gap:2 }}>{[6,9,12,15].map((h,i)=><div key={i} style={{ width:3,height:h,background:C.ink,borderRadius:1,opacity:i<3?1:.3 }}/>)}</div>
              <svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 9.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0-4a5.5 5.5 0 014.243 1.757l-1.414 1.414A3.5 3.5 0 008 7.5a3.5 3.5 0 00-2.829 1.171L3.757 7.257A5.5 5.5 0 018 5.5zm0-4a9.5 9.5 0 017.07 3.101L13.657 6.01A7.5 7.5 0 008 3.5a7.5 7.5 0 00-5.657 2.51L.93 4.601A9.5 9.5 0 018 1.5z" fill={C.ink}/></svg>
              <div style={{ display:"flex",alignItems:"center",gap:1 }}>
                <div style={{ width:24,height:12,borderRadius:3,border:`1.5px solid ${C.ink}`,display:"flex",alignItems:"center",padding:"1px 2px" }}><div style={{ width:"75%",height:"100%",background:C.ink,borderRadius:1 }}/></div>
                <div style={{ width:2,height:5,background:C.ink,borderRadius:"0 1px 1px 0" }}/>
              </div>
            </div>
          </div>
          <div style={{ position:"absolute",inset:0,top:0,display:"flex",flexDirection:"column",paddingTop:54 }}>
            {!isSignedIn
              ? <AuthScreen onAuth={(email,data,favs)=>{ setCurrentUser(email); setPhotoData(data||{}); setFavourites(favs||[]); setIsSignedIn(true); }}/>
              : <>
                  <div style={{ flex:1,overflow:"hidden",display:"flex",flexDirection:"column" }}><ErrorBoundary>{renderContent()}</ErrorBoundary></div>
                  {!subScreen&&<TabBar active={tab} onChange={t=>{ setTab(t); setSubScreen(null); }}/>}
                </>
            }
          </div>
          <div style={{ position:"absolute",bottom:8,left:"50%",transform:"translateX(-50%)",width:134,height:5,background:C.ink,borderRadius:999,opacity:.2 }}/>
        </div>
      </div>
      </div>
    </>
  );
}
