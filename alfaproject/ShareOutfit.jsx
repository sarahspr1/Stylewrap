// ShareOutfit.jsx — share screen with three story-sized card styles: Editorial, Receipt and Annotated.

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import "./ShareOutfit.css";

const BRAND = "Insyte Studio";
const APP_URL = "https://stylewrap.vercel.app";
const CARD_W = 360;
const CARD_H = 640;

// Convert a photoData entry into the shape the cards expect.
// Entries can have no style/season, and legacy items can be plain strings.
export function toShareOutfit(entry, dateKey, slot = 1) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return {
    id: dateKey.replace(/-/g, "") + (slot > 1 ? `-${slot}` : ""),
    photoUrl: entry.photo,
    occasion: entry.style || "",
    season: entry.season || "",
    date: new Date(y, m - 1, d),
    items: (entry.items || [])
      .map((it) => (typeof it === "object" && it ? it : { name: String(it || "") }))
      .filter((it) => it.name)
      .map((it) => ({ category: it.category || "Other", name: it.name, brand: it.brand || null })),
  };
}

/* ---------- icons ---------- */
const Icon = {
  close: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
  ),
  story: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" /></svg>
  ),
  save: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 19h14" /></svg>
  ),
  link: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
  ),
  more: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></svg>
  ),
  share: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5M5 14v5h14v-5" /></svg>
  ),
};

const CategoryIcon = ({ category }) => {
  const c = category.toLowerCase();
  const common = { width: 30, height: 30, viewBox: "0 0 40 40", fill: "none", stroke: "#1C1C1A", strokeWidth: 1.4, strokeLinejoin: "round", "aria-hidden": true };
  if (c.includes("bottom") || c.includes("trouser") || c.includes("pant"))
    return <svg {...common}><path d="M11 5h18l3 30h-9l-3-21-3 21H8z" /><path d="M11 9h18" /></svg>;
  if (c.includes("shoe") || c.includes("flat") || c.includes("boot"))
    return <svg {...common}><path d="M5 27c0-5 4-7 9-7l10 1c6 1 10 3 11 7v2H7c-1 0-2-1-2-3z" /><path d="M16 20.5l3 6" /></svg>;
  return <svg {...common}><path d="M15 5v6c0 3 10 3 10 0V5" /><path d="M15 11c-2 2-4 4-4 8v15h18V19c0-4-2-6-4-8" /></svg>;
};

/* ---------- helpers ---------- */
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtShort = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;

const BARS = [2,1,1,3,1,2,2,1,3,1,1,2,1,1,2,3,1,1,2,1,2,1,3,2,1,1,1,3,2,1,1,2,1,3,1,1,2,2,1,1,3,1,2,1,1,2];

/* ---------- card: editorial ---------- */
function EditorialCard({ outfit }) {
  const items = outfit.items.slice(0, 4);
  return (
    <div className="sw-card sw-editorial">
      <div className="sw-e-tags">
        {outfit.occasion && <strong>{outfit.occasion}</strong>}
        {outfit.season && <span>{outfit.season}</span>}
      </div>
      <img src={outfit.photoUrl} alt="Outfit" className="sw-e-photo" crossOrigin="anonymous" />
      {items.length > 0 && (
        <p className="sw-e-caption">
          {items.map((it, i) => {
            const name = i === 0 ? it.name[0].toUpperCase() + it.name.slice(1) : it.name.toLowerCase();
            return (
              <Fragment key={i}>
                {i % 2 === 1 ? <span className="sw-e-accent">{name}{i < items.length - 1 ? "," : ""}</span> : name + (i < items.length - 1 ? "," : "")}
                {i < items.length - 1 ? " " : "."}
              </Fragment>
            );
          })}
        </p>
      )}
    </div>
  );
}

/* ---------- card: receipt ---------- */
function ReceiptCard({ outfit }) {
  return (
    <div className="sw-card sw-receipt">
      <div className="sw-slot"><div className="sw-slot-line" /></div>
      <div className="sw-paper-wrap">
        <div className="sw-paper">
          <header className="sw-r-head">
            <div className="sw-r-brand">{BRAND.toUpperCase()}</div>
            <div className="sw-r-title">OUTFIT RECEIPT</div>
            <div className="sw-r-meta">No. {outfit.id} · {fmtDate(outfit.date)}</div>
          </header>
          <hr className="sw-dash" />
          <div className="sw-r-visual">
            <img src={outfit.photoUrl} alt="Outfit" className="sw-r-photo" crossOrigin="anonymous" />
            <div className="sw-r-icons">
              {outfit.items.slice(0, 3).map((it, i) => (
                <div className="sw-r-icon-row" key={i}>
                  <div className="sw-r-icon-box"><CategoryIcon category={it.category} /></div>
                  <span>{pad(i + 1)} {it.category.toUpperCase()}</span>
                </div>
              ))}
            </div>
          </div>
          <hr className="sw-dash" />
          <dl className="sw-r-items">
            {outfit.items.slice(0, 6).map((it, i) => (
              <div key={i} className="sw-r-item">
                <dt>{it.category.toUpperCase()}</dt>
                <dd>{it.name}{it.brand ? <span className="sw-r-brandname"> · {it.brand}</span> : null}</dd>
              </div>
            ))}
          </dl>
          <hr className="sw-dash" />
          <div className="sw-r-totals">
            {outfit.occasion && <><span className="sw-muted">OCCASION</span><span className="sw-right">{outfit.occasion.toUpperCase()}</span></>}
            {outfit.season && <><span className="sw-muted">SEASON</span><span className="sw-right">{outfit.season.toUpperCase()}</span></>}
            <strong>ITEMS</strong><strong className="sw-right">{outfit.items.length}</strong>
          </div>
          <div className="sw-r-barcode">
            <div className="sw-bars" aria-hidden="true">
              {BARS.map((w, i) => <i key={i} style={{ width: w, marginRight: ((i * 7) % 3) + 1 }} />)}
            </div>
            <div className="sw-r-url">{APP_URL.replace("https://", "").toUpperCase()}</div>
          </div>
        </div>
        <div className="sw-zig" />
      </div>
    </div>
  );
}

/* ---------- card: annotated ---------- */
// Label positions are tuned for a full-body cutout ~200x470px placed at left 38 / top 120.
const ANNOTATIONS = [
  { label: { left: 240, top: 172 }, path: "M268 222 C 262 236, 250 240, 234 240", head: "M241 235 L 234 240 L 241 245" },
  { label: { left: 238, top: 318 }, path: "M266 384 C 258 400, 244 408, 226 410", head: "M233 404 L 226 410 L 233 415" },
  { label: { left: 242, top: 584 }, path: "M236 596 C 222 596, 206 588, 194 574", head: "M195 582 L 194 574 L 202 576" },
];

function AnnotatedCard({ outfit, accent = "#C2412D" }) {
  const items = outfit.items.slice(0, 3);
  return (
    <div className="sw-card sw-annotated">
      <img src={outfit.photoUrl} alt="Outfit" className="sw-a-photo" crossOrigin="anonymous" />
      {outfit.occasion && <div className="sw-a-script sw-a-script-1" style={{ color: accent }}>{outfit.occasion}</div>}
      {outfit.season && <div className="sw-a-script sw-a-script-2" style={{ color: accent }}>{outfit.season.toLowerCase()}</div>}
      <svg className="sw-a-arrows" width={CARD_W} height={CARD_H} viewBox={`0 0 ${CARD_W} ${CARD_H}`} fill="none" stroke="#2A2724" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {items.map((_, i) => (
          <g key={i}><path d={ANNOTATIONS[i].path} /><path d={ANNOTATIONS[i].head} /></g>
        ))}
      </svg>
      {items.map((it, i) => (
        <div key={i} className="sw-a-label" style={ANNOTATIONS[i].label}>{it.name.toLowerCase()}</div>
      ))}
      <div className="sw-a-footer">{BRAND.toUpperCase()} · {fmtShort(outfit.date)}</div>
    </div>
  );
}

const CARDS = { editorial: EditorialCard, receipt: ReceiptCard, annotated: AnnotatedCard };

/* ---------- screen ---------- */
export default function ShareOutfit({ outfit, onClose }) {
  const [tpl, setTpl] = useState("editorial");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [scale, setScale] = useState(0.7);
  const cardRef = useRef(null);
  const areaRef = useRef(null);
  const Card = CARDS[tpl];

  // Fit the fixed-size card into whatever height the screen has left
  useLayoutEffect(() => {
    const fit = () => {
      const el = areaRef.current;
      if (el) setScale(Math.min(el.clientWidth / CARD_W, el.clientHeight / CARD_H, 1));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 1800); };

  // 360x640 card × 3 = 1080x1920 (Instagram Story size)
  const renderPng = async () => {
    await document.fonts.ready;
    const opts = { pixelRatio: 3, cacheBust: true, backgroundColor: "#FFFFFF" };
    // iOS Safari can leave images out of the first render, so the second one is the keeper
    await toPng(cardRef.current, opts);
    return toPng(cardRef.current, opts);
  };

  const download = (dataUrl) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `insyte-studio-${outfit.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const shareImage = async () => {
    if (busy) return;
    setBusy(true);
    let dataUrl = null;
    try {
      dataUrl = await renderPng();
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `insyte-studio-${outfit.id}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "My outfit" });
      } else {
        download(dataUrl);
        flash("Image saved");
      }
    } catch (e) {
      if (e?.name === "AbortError") return;
      // Browsers can refuse the share sheet after a slow render; the image is still usable
      if (dataUrl) { download(dataUrl); flash("Image saved"); }
      else flash("Couldn't create image");
    } finally {
      setBusy(false);
    }
  };

  const saveImage = async () => {
    if (busy) return;
    setBusy(true);
    try { download(await renderPng()); flash("Image saved"); }
    catch { flash("Couldn't create image"); }
    finally { setBusy(false); }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(APP_URL); flash("Link copied"); }
    catch { flash("Couldn't copy link"); }
  };

  const more = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: BRAND, url: APP_URL }); } catch {}
    } else copyLink();
  };

  return (
    <div className="sw-share">
      <div className="sw-topbar">
        <button className="sw-iconbtn" aria-label="Close" onClick={onClose}>{Icon.close}</button>
        <div className="sw-topbar-title">Share outfit</div>
        <div className="sw-iconbtn-spacer" />
      </div>

      <div role="tablist" aria-label="Card style" className="sw-tabs">
        {[["editorial", "Editorial"], ["receipt", "Receipt"], ["annotated", "Annotated"]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tpl === id} className={`sw-tab ${tpl === id ? "is-on" : ""}`} onClick={() => setTpl(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="sw-preview-area" ref={areaRef}>
        <div className="sw-preview-frame" style={{ width: CARD_W * scale, height: CARD_H * scale }}>
          <div className="sw-preview-scale" style={{ transform: `scale(${scale})` }}>
            <div ref={cardRef}>
              <Card outfit={outfit} />
            </div>
          </div>
        </div>
      </div>

      <div className="sw-actions">
        <button className="sw-action" onClick={shareImage} disabled={busy}><span className="sw-action-circle">{Icon.story}</span>Story</button>
        <button className="sw-action" onClick={saveImage} disabled={busy}><span className="sw-action-circle">{Icon.save}</span>Save image</button>
        <button className="sw-action" onClick={copyLink}><span className="sw-action-circle">{Icon.link}</span>Copy link</button>
        <button className="sw-action" onClick={more}><span className="sw-action-circle">{Icon.more}</span>More</button>
      </div>

      <button className="sw-primary" onClick={shareImage} disabled={busy}>
        {Icon.share}{busy ? "Preparing…" : "Share outfit"}
      </button>

      {toast && <div className="sw-toast" role="status">{toast}</div>}
    </div>
  );
}
