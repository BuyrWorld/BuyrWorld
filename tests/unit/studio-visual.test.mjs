import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { block, addHole, addPocket, featureIds } from "../../src/studio/geometry.mjs";
import { snapshot, buildPackage, verifyPackage } from "../../src/studio/review-export.mjs";
import { requirement, tolerance, KIND, SCOPE } from "../../src/studio/requirements.mjs";
import { partView } from "../../src/render/part-view.mjs";
import { fnSource } from "../helpers/page.mjs";

function model() {
  let m=block({widthUm:100000n,lengthUm:60000n,thicknessUm:10000n});
  m=addHole(m,{xUm:15000n,yUm:20000n,diameterUm:8000n}).model;
  return addPocket(m,{xUm:40000n,yUm:10000n,widthUm:20000n,lengthUm:20000n,depthUm:3000n}).model;
}
function req() {return requirement({id:"req-test",kind:KIND.DIMENSIONAL,
  scope:{type:SCOPE.FEATURE,featureId:"hole-1"},
  tolerance:tolerance({nominal:"8",plusMinus:"0.1",unit:"mm"}),
  source:"Synthetic enquiry"});}
test("review bytes preserve exact geometry, feature attachment and the same revision",async()=>{
  const m=model();
  const pkg=await buildPackage(snapshot({part:"Synthetic bracket",partRevision:"B",
    model:m,modelRevision:m.revision,features:featureIds(m),requirements:[req()],
    material:{name:"Fictional grade FG-300"},at:"2026-09-15T12:00:00Z"}));
  const exported=JSON.parse(pkg.files["part-model.json"]);
  assert.equal(exported.model.widthUm,"100000");
  assert.equal(exported.model.features[0].diameterUm,"8000");
  assert.equal(exported.modelRevision,exported.requirementSchedule.modelRevision);
  assert.equal(exported.exportedAt,exported.requirementSchedule.exportedAt);
  assert.equal(exported.requirementSchedule.summary.awaitingModel.length,0);
  assert.equal(exported.requirementSchedule.summary.detached.length,0);
  assert.equal(exported.displayRows.length,1);
  assert.equal((await verifyPackage(pkg)).ok,true);
});
test("a draft without a model never invents a model artifact",async()=>{
  const pkg=await buildPackage(snapshot({part:"Manual-only part",requirements:[]}));
  assert.equal(pkg.files["part-model.json"],undefined);
  assert.ok(pkg.manifest.notIncluded.some(f=>f.name==="model.step"));
});
test("the page export passes the live model and feature ids to the exporter",async()=>{
  const m=model(), values={"sc-grade":"Synthetic bracket","sc-unit":"in"};
  let sent;
  /* The export carries the commercial basis too now. Nothing has been
     calculated in this context, so it returns null — which is the honest
     answer and the one the package prints as "no costing accompanies this". */
  const context={_scModel:m,_scReqs:[req()],_scPackage:null,
    scCommercialBasis:()=>null,
    scVal:id=>values[id]||"",scErr:String,scRenderPackage(){},
    document:{getElementById:()=>({innerHTML:""})},
    window:{BW:{reviewSnapshot:input=>{sent=input;return snapshot(input);},buildReviewPackage:buildPackage}}};
  vm.createContext(context);
  vm.runInContext(fnSource("scExportReview",readFileSync("app.js","utf8")),context);
  await vm.runInContext("scExportReview()",context);
  assert.equal(sent.model,m);
  assert.deepEqual(Array.from(sent.features),["hole-1","pocket-1"]);
  assert.equal(sent.modelRevision,m.revision);
  assert.equal(JSON.parse(context._scPackage.files["part-model.json"]).geometryUnits,"um",
    "geometry units do not change when the costing form uses inches");
});
test("every view renders finite coordinates and never changes the exact model",()=>{
  const m=model(), before=JSON.stringify(m,(_,v)=>typeof v==="bigint"?String(v):v);
  for(const view of ["iso","top","front"]) for(const angle of [-180,-90,0,90,180]) {
    const svg=partView(m,{view,angle,selected:"hole-1"});
    assert.doesNotMatch(svg,/NaN|Infinity|undefined/);
    assert.match(svg,/100 × 60 × 10 mm/);
    assert.match(svg,/role="img"/);
  }
  assert.equal(JSON.stringify(m,(_,v)=>typeof v==="bigint"?String(v):v),before);
});
test("feature ids cannot inject SVG attributes",()=>{
  const m={...model(),features:[{...model().features[0],id:'"><script>alert(1)</script>'}]};
  assert.doesNotMatch(partView(m),/<script>/);
  assert.match(partView(m),/&lt;script&gt;/);
});
test("the preview refuses dimensions it cannot represent safely",()=>{
  assert.throws(()=>partView({...model(),widthUm:9007199254740992n}),/supported preview range/);
});
