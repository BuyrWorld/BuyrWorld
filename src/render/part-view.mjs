/* Display geometry only. Exact volume/mass stay in src/studio/geometry.mjs.
 * SVG projections are illustrations, never a CAD interchange format. */
const esc = value => String(value).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function partView(model, { angle = 28, view = "iso", selected = "" } = {}) {
  const dim = value => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("Dimensions exceed the supported preview range.");
    return n / 1000;
  };
  const W = dim(model.widthUm), L = dim(model.lengthUm), T = dim(model.thicknessUm);
  if (!(W > 0 && L > 0 && T > 0)) throw new RangeError("Preview needs positive dimensions.");
  const a = view === "top" || view === "front" ? 0 : angle * Math.PI / 180;
  const e = view === "top" ? Math.PI / 2 : view === "front" ? 0 : 0.68;
  const raw = (x, y, z) => [Math.cos(a)*x - Math.sin(a)*y,
    -Math.sin(e)*(Math.sin(a)*x + Math.cos(a)*y) + Math.cos(e)*z];
  const corners = [0,W].flatMap(x => [0,L].flatMap(y => [0,T].map(z => raw(x,y,z))));
  const xs = corners.map(p=>p[0]), ys = corners.map(p=>p[1]);
  const xmin=Math.min(...xs), xmax=Math.max(...xs), ymin=Math.min(...ys), ymax=Math.max(...ys);
  const scale=Math.min(480/Math.max(xmax-xmin,0.001),240/Math.max(ymax-ymin,0.001));
  const p=(x,y,z=0)=>{ const q=raw(x,y,z); return [
    310+(q[0]-(xmin+xmax)/2)*scale, 170+(q[1]-(ymin+ymax)/2)*scale]; };
  const path=points=>points.map((q,i)=>(i?"L":"M")+p(...q).map(n=>n.toFixed(3)).join(",")).join(" ")+" Z";
  const face=(points,fill,extra="")=>'<path d="'+path(points)+'" fill="'+fill+'" stroke="var(--bw-border-strong)" stroke-width="1" '+extra+'/>';
  const outer=[[0,0,0],[W,0,0],[W,L,0],[0,L,0]];
  let sides="";
  if (view !== "top") {
    if (Math.sin(a) >= 0) sides+=face([[0,0,0],[W,0,0],[W,0,T],[0,0,T]],"var(--bw-muted)");
    else sides+=face([[0,L,0],[W,L,0],[W,L,T],[0,L,T]],"var(--bw-muted)");
    if (Math.cos(a) >= 0) sides+=face([[0,0,0],[0,L,0],[0,L,T],[0,0,T]],"var(--bw-subtle)");
    else sides+=face([[W,0,0],[W,L,0],[W,L,T],[W,0,T]],"var(--bw-subtle)");
  }
  const loops=[];
  let wells="", outlines="";
  for(const f of model.features) {
    const x=dim(f.xUm), y=dim(f.yUm);
    let top, depth;
    if(f.kind==="through-hole") {
      const r=dim(f.diameterUm)/2;
      top=Array.from({length:64},(_,i)=>[x+r*Math.cos(i*Math.PI/32),y+r*Math.sin(i*Math.PI/32),0]);
      depth=T;
    } else if(f.kind==="rectangular-pocket") {
      const w=dim(f.widthUm), l=dim(f.lengthUm);
      top=[[x,y,0],[x+w,y,0],[x+w,y+l,0],[x,y+l,0]];
      depth=dim(f.depthUm);
    } else throw new RangeError("Unsupported feature in preview.");
    loops.push(path(top));
    const floor=top.map(q=>[q[0],q[1],depth]);
    wells+=face(floor,f.kind==="through-hole"?"var(--bw-bg)":"var(--bw-subtle)");
    for(let i=0;i<top.length;i++) {
      const j=(i+1)%top.length;
      wells+=face([top[i],top[j],floor[j],floor[i]],"var(--bw-surface-2)");
    }
    outlines+='<path d="'+path(top)+'" fill="transparent" stroke="'+
      (f.id===selected?"var(--bw-accent)":"var(--bw-border-strong)")+
      '" stroke-width="'+(f.id===selected?3:1.2)+'" data-feature="'+esc(f.id)+'"><title>'+esc(f.id)+'</title></path>';
  }
  const top=view==="front"?"":'<path d="'+path(outer)+" "+loops.join(" ")+'" fill-rule="evenodd" fill="var(--bw-body)" stroke="var(--bw-border-strong)" stroke-width="1.2"/>';
  const origin=p(0,0,0);
  return '<svg class="bw-part-svg" viewBox="0 0 620 340" role="img" aria-label="'+
    esc(view+" preview, "+W+" by "+L+" by "+T+" mm. "+model.features.length+" features.")+'">'+
    '<defs><pattern id="bw-preview-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.7" fill="var(--bw-border-strong)"/></pattern></defs>'+
    '<rect width="620" height="340" fill="url(#bw-preview-grid)"/>'+
    (view==="front"?sides:sides+wells+top+outlines)+
    '<circle cx="'+origin[0]+'" cy="'+origin[1]+'" r="4" fill="var(--bw-accent)"/>'+
    '<text x="22" y="28" fill="var(--bw-muted)" font-size="11" font-family="monospace">mm · Z down into material</text>'+
    '<text x="22" y="319" fill="var(--bw-accent)" font-size="12" font-family="monospace">X →  Y ↑   • origin on top face</text>'+
    '<text x="598" y="319" text-anchor="end" fill="var(--bw-text)" font-size="12" font-family="monospace">'+W+' × '+L+' × '+T+' mm</text></svg>';
}
