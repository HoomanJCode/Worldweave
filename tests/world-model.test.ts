import { describe, expect, it } from "vitest";
import { applyCommand } from "../lib/world/commands";
import { applyMatrix, invertMatrix, pointInPolygon, screenToWorld, splitCubic, transformPoint, worldToScreen, zoomAt, type Matrix } from "../lib/world/geometry";
import { createBlankMap, createSampleMap, newShape, validateMapData } from "../lib/world/model";
import { isCharacterBlocked } from "../lib/world/collision";
import { convertProceduralRegion } from "../lib/world/convert-region";
import { generateRegion } from "../lib/world/regions";
import { ShapeSpatialIndex } from "../lib/world/spatial-index";
import { descendantShapeIds, isShapeLocked, isShapeVisible } from "../lib/world/groups";
import { applyMapOperations, canRebaseOperations, diffMaps } from "../lib/sync/patches";
import { samplePath } from "../lib/world/curves";

describe("camera geometry",()=>{
  it("round trips between world and screen coordinates",()=>{
    const camera={x:145,y:-80,zoom:1.7},size={width:1280,height:720},world={x:-93.5,y:228};
    const screen=worldToScreen(world,camera,size),result=screenToWorld(screen,camera,size);
    expect(result.x).toBeCloseTo(world.x,10);expect(result.y).toBeCloseTo(world.y,10);
  });
  it("keeps the world point under the cursor fixed while zooming",()=>{
    const camera={x:40,y:-25,zoom:.8},size={width:900,height:700},cursor={x:312,y:481};
    const before=screenToWorld(cursor,camera,size),after=zoomAt(camera,cursor,size,2.1),afterPoint=screenToWorld(cursor,after,size);
    expect(afterPoint.x).toBeCloseTo(before.x,10);expect(afterPoint.y).toBeCloseTo(before.y,10);
  });
});

describe("transforms and paths",()=>{
  it("inverts and restores an affine transform",()=>{
    const matrix:Matrix=[1.4,.2,-.35,.9,24,-80],inverse=invertMatrix(matrix)!;const point={x:13,y:-7};
    const restored=applyMatrix(inverse,applyMatrix(matrix,point));expect(restored.x).toBeCloseTo(point.x,10);expect(restored.y).toBeCloseTo(point.y,10);
  });
  it("scales and rotates a single selected shape around its opposite anchor",()=>{
    expect(transformPoint({x:4,y:0},{x:0,y:0},2,1,Math.PI/2).x).toBeCloseTo(0);
    expect(transformPoint({x:4,y:0},{x:0,y:0},2,1,Math.PI/2).y).toBeCloseTo(8);
  });
  it("splits a cubic bezier without moving the shared point",()=>{
    const points=[{x:0,y:0},{x:20,y:40},{x:70,y:-10},{x:100,y:30}] as const;const [left,right]=splitCubic(...points,.37);
    expect(left[3]).toEqual(right[0]);expect(left[0]).toEqual(points[0]);expect(right[3]).toEqual(points[3]);
  });
  it("classifies solid interiors and measures thin wall segments",()=>{
    const polygon=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
    expect(pointInPolygon({x:50,y:50},polygon)).toBe(true);expect(pointInPolygon({x:120,y:50},polygon)).toBe(false);
    expect(pointInPolygon({x:51,y:3},polygon)).toBe(true);
  });
});

describe("deterministic region generation",()=>{
  const polygon=[{x:0,y:0},{x:150,y:0},{x:160,y:100},{x:0,y:100}];
  const recipe={kind:"forest" as const,density:.45,spacing:12,rotation:0,randomness:1,seed:6732,scale:1,edgePadding:3,cluster:.8};
  it("repeats exactly for a pinned recipe and seed",()=>{expect(generateRegion(polygon,recipe,5)).toEqual(generateRegion(polygon,recipe,5));});
  it("keeps complete proxy bounds inside the region",()=>{
    const points=generateRegion(polygon,recipe,7);
    expect(points.length).toBeGreaterThan(0);
    for(const point of points){expect(pointInPolygon({x:point.x-7,y:point.y},polygon)).toBe(true);expect(pointInPolygon({x:point.x+7,y:point.y},polygon)).toBe(true);expect(pointInPolygon({x:point.x,y:point.y-7},polygon)).toBe(true);expect(pointInPolygon({x:point.x,y:point.y+7},polygon)).toBe(true);}
  });
  it("changes row alignment with pattern direction while keeping each result deterministic",()=>{
    const recipe={...({kind:"wheat" as const,density:.8,spacing:18,rotation:0,patternDirection:0,randomness:0,seed:88,scale:1,edgePadding:0,cluster:1})};
    const horizontal=generateRegion(polygon,recipe,0),angled=generateRegion(polygon,{...recipe,patternDirection:Math.PI/2},0);
    expect(horizontal).toEqual(generateRegion(polygon,recipe,0));
    expect(horizontal).not.toEqual(angled);
    expect(horizontal.length).toBeGreaterThan(0);
  });
});

describe("shared editing helpers",()=>{
  it("indexes nearby shapes and ignores distant ones",()=>{
    const map=createSampleMap(),index=new ShapeSpatialIndex(map.shapes,128),near=map.shapes[0];
    expect(index.queryPoint(near.points[0],5).some(shape=>shape.id===near.id)).toBe(true);
    expect(index.queryPoint({x:100_000,y:100_000}).length).toBe(0);
  });
  it("applies inherited visibility and locking to nested groups",()=>{
    const map=createSampleMap(),shape=map.shapes[0];
    const nested={...map,groups:[{id:"root",name:"Root",parentId:null,visible:false,locked:false},{id:"child",name:"Child",parentId:"root",visible:true,locked:true}],shapes:map.shapes.map((item,index)=>index===0?{...item,parentId:"child"}:item)};
    expect(descendantShapeIds(nested,"root")).toContain(shape.id);
    expect(isShapeVisible(nested,nested.shapes[0])).toBe(false);
    expect(isShapeLocked(nested,nested.shapes[0])).toBe(true);
  });
  it("rebases edits to separate shapes but detects edits to the same shape",()=>{
    const map=createSampleMap(),first=map.shapes[0],second=map.shapes[1];
    const local={...map,shapes:map.shapes.map(shape=>shape.id===first.id?{...shape,name:"Local change",revision:shape.revision+1}:shape)};
    const remote={...map,shapes:map.shapes.map(shape=>shape.id===second.id?{...shape,name:"Remote change",revision:shape.revision+1}:shape)};
    const ops=diffMaps(map,local);
    expect(canRebaseOperations(remote,map,ops)).toBe(true);
    expect(applyMapOperations(remote,ops).shapes.find(shape=>shape.id===first.id)?.name).toBe("Local change");
    const sameObject={...map,shapes:map.shapes.map(shape=>shape.id===first.id?{...shape,name:"Remote conflict",revision:shape.revision+1}:shape)};
    expect(canRebaseOperations(sameObject,map,ops)).toBe(false);
  });
  it("rebases independent map settings and rejects overlapping setting edits",()=>{
    const base=createSampleMap(),local={...base,grid:32},remote={...base,backgroundColor:"#334455"},ops=diffMaps(base,local);
    expect(canRebaseOperations(remote,base,ops)).toBe(true);
    expect(applyMapOperations(remote,ops)).toMatchObject({grid:32,backgroundColor:"#334455"});
    expect(canRebaseOperations({...base,grid:48},base,ops)).toBe(false);
  });
  it("samples cubic handles into points that can be used by region and collision logic",()=>{
    const points=[{x:0,y:0},{x:100,y:0}],shape={kind:"path" as const,points,closed:false,handles:[{outgoing:{x:0,y:100}},{incoming:{x:100,y:100}}]};
    const sampled=samplePath(shape,12);
    expect(sampled.length).toBe(13);expect(sampled[6].y).toBeGreaterThan(60);
  });
  it("syncs grid and finite-character-bound settings as map patches",()=>{
    const base=createBlankMap(),next={...base,grid:32,restrictCharacterToBounds:true},ops=diffMaps(base,next);
    expect(ops).toHaveLength(1);
    expect(applyMapOperations(base,ops)).toMatchObject({grid:32,restrictCharacterToBounds:true});
  });
});

describe("character collision",()=>{
  it("respects curved walls, filled solids, and opt-in finite bounds",()=>{
    const map=createBlankMap();map.width=100;map.height=100;
    const curve=newShape("path",[{x:-40,y:0},{x:40,y:0}],"Curved wall");curve.collision="wall";curve.collisionThickness=8;curve.handles=[{outgoing:{x:-20,y:50}},{incoming:{x:20,y:50}}];
    const solid=newShape("path",[{x:-10,y:-10},{x:10,y:-10},{x:10,y:10},{x:-10,y:10}],"Solid",true);solid.collision="solid";
    map.shapes=[curve,solid];
    expect(isCharacterBlocked({x:0,y:37},map)).toBe(true);
    expect(isCharacterBlocked({x:0,y:0},map)).toBe(true);
    expect(isCharacterBlocked({x:55,y:0},map)).toBe(false);
    map.restrictCharacterToBounds=true;
    expect(isCharacterBlocked({x:45,y:0},map)).toBe(true);
    map.restrictCharacterToBounds=false;
    expect(isCharacterBlocked({x:70,y:0},map)).toBe(false);
  });
});

describe("procedural conversion",()=>{
  it("turns deterministic template instances into editable shapes with their collisions",()=>{
    const map=createBlankMap(),region=newShape("path",[{x:0,y:0},{x:400,y:0},{x:400,y:400},{x:0,y:400}],"Forest patch",true);
    region.generator={kind:"vegetation",density:.8,spacing:28,rotation:0,randomness:0,seed:42,scale:1,edgePadding:2,cluster:1,templateId:"tree"};map.shapes=[region];
    const template={id:"tree",name:"Tree",groups:[{id:"parts",name:"Tree parts",parentId:null,visible:true,locked:false}],shapes:[
      {...newShape("rectangle",[{x:-2,y:0},{x:2,y:10}],"Trunk",true),parentId:"parts",collision:"solid" as const},
      {...newShape("ellipse",[{x:-8,y:-10},{x:8,y:2}],"Canopy",true),parentId:"parts",collision:"none" as const},
    ]};
    const result=convertProceduralRegion(map,region.id,[template]);
    expect(result.ok).toBe(true);
    if(!result.ok)return;
    expect(result.instanceCount).toBeGreaterThan(0);
    expect(result.shapeCount).toBe(result.instanceCount*2);
    expect(result.map.shapes.find(shape=>shape.id===region.id)?.generator).toBeUndefined();
    expect(result.map.shapes.filter(shape=>shape.name.startsWith("Trunk ")).every(shape=>shape.collision==="solid")).toBe(true);
    expect(result.map.shapes.filter(shape=>shape.name.startsWith("Canopy ")).every(shape=>shape.collision==="none")).toBe(true);
    expect(new Set(result.map.shapes.slice(1).map(shape=>shape.parentId)).size).toBeGreaterThan(1);
  });
  it("rejects unsafe exports without changing the input map",()=>{
    const map=createBlankMap(),region=newShape("path",[{x:0,y:0},{x:400,y:0},{x:400,y:400},{x:0,y:400}],"Field",true);
    region.generator={kind:"wheat",density:.8,spacing:28,rotation:0,randomness:0,seed:42,scale:1,edgePadding:2,cluster:1};map.shapes=[region];
    expect(convertProceduralRegion(map,region.id,[],1)).toMatchObject({ok:false,reason:"too_large"});
    expect(map.shapes[0].generator).toBeDefined();
  });
});

describe("transactional local commands",()=>{
  it("rejects stale revisions explicitly and ignores duplicate command ids",()=>{
    const map=createSampleMap(),shape=map.shapes[0];
    const first=applyCommand(map,{id:"command-1",type:"shape.update",shapeId:shape.id,expectedRevision:shape.revision,changes:{name:"Renamed"}});
    expect(first.applied).toBe(true);
    const stale=applyCommand(first.map,{id:"command-2",type:"shape.update",shapeId:shape.id,expectedRevision:shape.revision,changes:{name:"Lost update"}});
    expect(stale.conflict?.actual).toBe(shape.revision+1);expect(stale.map.shapes[0].name).toBe("Renamed");
    const duplicate=applyCommand(first.map,{id:"command-1",type:"shape.update",shapeId:shape.id,expectedRevision:shape.revision,changes:{name:"Again"}},new Set(["command-1"]));
    expect(duplicate.applied).toBe(false);expect(duplicate.map.shapes[0].name).toBe("Renamed");
  });
  it("validates and remaps imported shape IDs",()=>{
    const map=createSampleMap(),copy=validateMapData(map);
    expect(copy.id).not.toBe(map.id);expect(copy.shapes[0].id).not.toBe(map.shapes[0].id);expect(copy.shapes[0].points).toEqual(map.shapes[0].points);
    expect(()=>validateMapData({...map,formatVersion:99})).toThrow(/format version/);
  });
});
