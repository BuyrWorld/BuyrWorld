import { partView } from "./part-view.mjs";

let committed=null, shown=null, selected="", angle=28, view="iso", pending=false;
const el=id=>document.getElementById(id);
const value=id=>el(id)?.value?.trim() || "";
function button(label, action) {
  const b=document.createElement("button");
  b.type="button"; b.className="bw-act bw-act-text bw-act--sm";
  b.textContent=label; b.addEventListener("click",action); return b;
}
function render() {
  const host=el("studio-canvas");
  if(!host) return;
  el("studio-model-state").textContent= pending ? "Preview · not applied" :
    committed ? "• Model revision "+committed.revision : "• No model yet";
  el("studio-export-hint").textContent=committed
    ? "Prepare a review package below to download this model and its requirements."
    : "Enter dimensions on the left, then select Set the block.";
  if(!shown) {
    host.replaceChildren();
    const empty=document.createElement("div"); empty.className="bw-preview-empty";
    const title=document.createElement("strong"); title.textContent="See the part as you build it";
    const note=document.createElement("p"); note.textContent="Your dimensions become a live view here. A model is optional: manual costing still works without one.";
    empty.append(title,note); host.append(empty);
    el("studio-feature-picks").replaceChildren();
    el("studio-selection").textContent="Select a feature to see its coordinates.";
    return;
  }
  try { host.innerHTML=partView(shown,{angle,view,selected}); }
  catch(error) { host.textContent=error.message; }
  const picks=el("studio-feature-picks"); picks.replaceChildren();
  for(const feature of shown.features) {
    const b=button(feature.id,()=>select(feature.id));
    b.setAttribute("aria-pressed",String(feature.id===selected)); picks.append(b);
  }
  const f=shown.features.find(f=>f.id===selected);
  const mm=v=>String(Number(v)/1000);
  el("studio-selection").textContent=f ? f.id+" · X "+mm(f.xUm)+" / Y "+mm(f.yUm)+" mm · "+
    (f.kind==="through-hole" ? "Ø "+mm(f.diameterUm)+" mm · through" :
      mm(f.widthUm)+" × "+mm(f.lengthUm)+" mm · depth "+mm(f.depthUm)+" mm") :
    "Select a hole or pocket in the view, or use its button below.";
}
function select(id) { selected=id; render(); }
export function updateStudio(model) {
  committed=model; shown=model; pending=false;
  if(!model || !model.features.some(f=>f.id===selected)) selected="";
  render();
}
export function initStudio() {
  const host=el("studio-viewport"); if(!host) return;
  document.getElementById("page-shouldcost").classList.add("bw-studio-enhanced");
  host.innerHTML='<div class="bw-panel-head"><div><div class="bw-viewport-eyebrow">SHOULD-COST STUDIO</div><h3 class="bw-panel-title">Your part, in view</h3></div><span id="studio-model-state" class="bw-preview-state"></span></div>'+
    '<div id="studio-view-buttons" class="bw-view-buttons" role="group" aria-label="Part view"></div>'+
    '<div id="studio-canvas" class="bw-canvas"></div>'+
    '<label class="bw-orbit">Rotate view<input id="studio-angle" type="range" min="-180" max="180" value="28" step="1" aria-label="Rotate part view"></label>'+
    '<div id="studio-feature-picks" class="bw-feature-picks" role="group" aria-label="Select a part feature"></div>'+
    '<p id="studio-selection" class="bw-selection" role="status"></p>'+
    '<p id="studio-export-hint" class="bw-view-note"></p>'+
    '<p class="bw-view-note">Visual preview of supported primitives. Costing uses the separate blank and route inputs.</p>';
  for(const [key,label] of [["iso","3D view"],["top","Top"],["front","Front"]]) {
    const b=button(label,()=>{
      view=key;
      for(const child of el("studio-view-buttons").children) child.setAttribute("aria-pressed",String(child===b));
      el("studio-angle").disabled=view!=="iso"; render();
    });
    b.setAttribute("aria-pressed",String(key===view)); el("studio-view-buttons").append(b);
  }
  el("studio-angle").addEventListener("input",event=>{angle=Number(event.target.value);render();});
  el("studio-canvas").addEventListener("click",event=>{
    const id=event.target.closest("[data-feature]")?.dataset.feature;
    if(shown?.features.some(f=>f.id===id)) select(id);
  });
  for(const id of ["pb-w","pb-l","pb-t"]) el(id).addEventListener("input",()=>{
    if(!committed) return;
    const dims=["pb-w","pb-l","pb-t"].map(value);
    if(!dims.every(v=>/^\d+(\.\d{1,3})?$/.test(v))) {
      shown=committed; pending=false; render();
      el("studio-selection").textContent="Enter all three dimensions to preview a resize. The existing model is unchanged."; return;
    }
    const um=v=>{const [w,f=""]=v.split(".");return BigInt(w)*1000n+BigInt(f.padEnd(3,"0"));};
    try {
      const result=window.BW.resize(committed,{widthUm:um(dims[0]),lengthUm:um(dims[1]),thicknessUm:um(dims[2])});
      if(result.error) throw new Error(result.error);
      shown=result.model; pending=true; render();
      el("studio-export-hint").textContent="Dimensions previewed only. Select Set the block to apply, or restore the previous values.";
    } catch(error) {
      shown=committed; pending=false; render();
      el("studio-selection").textContent=error.message+" The existing model is unchanged.";
    }
  });
  // Long teaching copy is one click away; the original controls and labels stay in place.
  const page=el("page-shouldcost");
  const introPanel=page.querySelector(".wrap > .bw-panel");
  if(introPanel) {
    const details=document.createElement("details"); details.className="bw-studio-help";
    const summary=document.createElement("summary"); summary.textContent="How this studio works · local processing · supported shapes";
    introPanel.before(details); details.append(summary,introPanel);
  }
  const builder=el("pb-w").closest(".bw-panel");
  const paragraph=builder?.querySelector(":scope > p");
  if(paragraph) {
    const details=document.createElement("details");details.className="bw-studio-help";
    const summary=document.createElement("summary");summary.textContent="What can I model?";
    paragraph.before(details); details.append(summary,paragraph);
  }
  const bar=document.createElement("nav");bar.className="bw-studio-steps";bar.setAttribute("aria-label","Studio steps");
  for(const [label,id] of [["01  Define the part","pb-w"],["02  Plan the route","sc-stages"],["03  Record requirements","req-kind"],["04  Technical review","rev-partrev"]]) {
    bar.append(button(label,()=>{
      const target=el(id);
      if(target){target.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"center"});target.focus({preventScroll:true});}
    }));
  }
  el("sc-mode-material").prepend(bar);
  render();
}
