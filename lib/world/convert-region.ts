import { samplePath } from "./curves";
import { transformPoint } from "./geometry";
import type { MapGroup, MapTemplate, Point, Shape, WorldMap } from "./model";
import { newShape } from "./model";
import { generateRegion } from "./regions";

export type RegionConversionResult =
  | { ok: true; map: WorldMap; instanceCount: number; shapeCount: number }
  | { ok: false; reason: "missing_region" | "empty" | "too_many_shapes" | "too_large" };

export function convertProceduralRegion(map: WorldMap, regionId: string, templates: MapTemplate[], maxBytes = 330_000): RegionConversionResult {
  const region=map.shapes.find(shape=>shape.id===regionId);
  if(!region?.generator||!region.closed||region.points.length<3)return{ok:false,reason:"missing_region"};
  const recipe=region.generator,instances=generateRegion(samplePath(region,12),recipe,5);
  if(!instances.length)return{ok:false,reason:"empty"};
  const outerGroupId=crypto.randomUUID(),template=templates.find(item=>item.id===recipe.templateId),groups:MapGroup[]=[{id:outerGroupId,name:`${recipe.kind} instances`,parentId:null,visible:true,locked:false}],made:Shape[]=[];
  instances.forEach((instance,index)=>{
    if(template?.shapes.length){
      const groupIds=new Map((template.groups??[]).map(group=>[group.id,crypto.randomUUID()]));
      for(const group of template.groups??[])groups.push({...group,id:groupIds.get(group.id)!,name:`${group.name} ${index+1}`,parentId:group.parentId?groupIds.get(group.parentId)??outerGroupId:outerGroupId});
      const place=(point:Point)=>{const local=transformPoint(point,{x:0,y:0},instance.scale,instance.scale,instance.rotation);return{x:local.x+instance.x,y:local.y+instance.y}};
      for(const vector of template.shapes)made.push({...structuredClone(vector),id:crypto.randomUUID(),name:`${vector.name} ${index+1}`,points:vector.points.map(place),handles:vector.handles?.map(handle=>handle?{incoming:handle.incoming?place(handle.incoming):undefined,outgoing:handle.outgoing?place(handle.outgoing):undefined}:null),parentId:vector.parentId?groupIds.get(vector.parentId)??outerGroupId:outerGroupId,revision:1,createdAt:Date.now()});
    }else{
      const radius=Math.max(2.5,4*instance.scale),color=recipe.kind==="wheat"?"#dfbd64":recipe.kind==="corn"?"#9dbb68":recipe.kind==="forest"?"#76945c":"#76a36e",shape=newShape("ellipse",[{x:instance.x-radius,y:instance.y-radius},{x:instance.x+radius,y:instance.y+radius}],`${recipe.kind} instance ${index+1}`,true);
      made.push({...shape,parentId:outerGroupId,style:{...shape.style,stroke:color,fill:color,opacity:.82}});
    }
  });
  const nextMap:WorldMap={...map,groups:[...(map.groups??[]),...groups],shapes:[...map.shapes.map(shape=>shape.id===region.id?{...shape,generator:undefined,revision:shape.revision+1}:shape),...made],updatedAt:Date.now()};
  if(nextMap.shapes.length>5000)return{ok:false,reason:"too_many_shapes"};
  if(new TextEncoder().encode(JSON.stringify(nextMap)).length>maxBytes)return{ok:false,reason:"too_large"};
  return{ok:true,map:nextMap,instanceCount:instances.length,shapeCount:made.length};
}
